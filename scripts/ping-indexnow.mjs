// Tells search engines the site changed, the moment it changes, instead of
// waiting for them to come and look.
//
// IndexNow (https://www.indexnow.org/): one submission fans out to every
// participating engine — Bing, Yandex, Seznam.cz, Naver and others. Bing's
// index also backs Bing Copilot and is one of the sources AI answer engines
// (ChatGPT's web search, Perplexity) draw on, so this speeds up how quickly
// those surfaces see new work too.
//
// What this deliberately does NOT claim to do:
//   - Google does not participate in IndexNow. It finds changes through
//     sitemap.xml on its own schedule (already in place, linked from robots.txt).
//   - There is no ping protocol for AI training crawlers (GPTBot, ClaudeBot,
//     CCBot, …). They crawl when they crawl; robots.txt already allows them
//     everything, and llms.txt / llms-full.txt hand them the text directly.
//   - The old Bing sitemap ping endpoint (bing.com/ping?sitemap=) is retired —
//     it answers 410 Gone, so it isn't called here.
//
// By default only URLs whose sitemap lastmod changed since the previous run are
// submitted, which is what the protocol asks for. State lives in
// .indexnow-state.json (gitignored, local to this machine).
//
// Usage:
//   npm run notify-search-engines            # submit what changed
//   node scripts/ping-indexnow.mjs --all     # submit every URL
//   node scripts/ping-indexnow.mjs --dry-run # show what would be sent
//
// Runs automatically at the end of `npm run deploy` (production only).

import fs from "node:fs";

// Since Oct 2026 the site lives on andrada.one and its subdomains (louis. / han. / odi.), and the
// sitemap lists every page at its own address. IndexNow takes one host per submission, so changed
// URLs are grouped by host; the key file is part of the site, so every host serves it.
const KEY = "90c777ff5e46432f81a0138dec0a2ed0";
const keyLocation = (host) => `https://${host}/${KEY}.txt`;
const SITEMAP_PATH = "public/sitemap.xml";
const STATE_PATH = ".indexnow-state.json";
const BATCH_LIMIT = 10000; // IndexNow caps a single submission at 10,000 URLs

const DRY_RUN = process.argv.includes("--dry-run");
const SUBMIT_ALL = process.argv.includes("--all");

// Each <url> block carries a <loc> and usually a <lastmod>; the pair is what
// lets us tell "this page actually changed" from "this page still exists".
function parseSitemap(xml) {
  const entries = new Map();
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block[1].match(/<loc>(.*?)<\/loc>/)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = block[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1]?.trim() ?? "";
    entries.set(loc, lastmod);
  }
  return entries;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

// The key file has to be live and contain exactly the key, or every submission
// is rejected — and IndexNow rejects quietly enough that it's worth checking.
async function keyFileIsLive(host) {
  try {
    const res = await fetch(keyLocation(host), { cache: "no-store" });
    if (!res.ok) return `responded ${res.status}`;
    const body = (await res.text()).trim();
    return body === KEY ? true : "served different contents than the key";
  } catch (err) {
    return `could not be fetched (${err.message})`;
  }
}

async function submit(host, urlList) {
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key: KEY, keyLocation: keyLocation(host), urlList }),
  });
  return res.status;
}

async function main() {
  if (!fs.existsSync(SITEMAP_PATH)) {
    console.error(`✗ ${SITEMAP_PATH} not found — run \`npm run build\` first.`);
    process.exitCode = 1;
    return;
  }

  const current = parseSitemap(fs.readFileSync(SITEMAP_PATH, "utf-8"));
  if (!current.size) {
    console.error("✗ No <url> entries found in sitemap.xml — nothing to submit.");
    process.exitCode = 1;
    return;
  }

  const previous = SUBMIT_ALL ? {} : readState();
  const isFirstRun = Object.keys(previous).length === 0;
  const changed = [...current.entries()]
    .filter(([loc, lastmod]) => previous[loc] !== lastmod)
    .map(([loc]) => loc);

  console.log(`sitemap: ${current.size} URLs`);
  if (SUBMIT_ALL) console.log("--all: submitting every URL");
  else if (isFirstRun) console.log("no previous run recorded — submitting every URL once");
  else console.log(`changed since last run: ${changed.length}`);

  if (!changed.length) {
    console.log("✓ Nothing changed — no submission needed.");
    return;
  }

  if (DRY_RUN) {
    console.log("--dry-run: not submitting. Would send:");
    console.log(changed.slice(0, 5).map((u) => `  ${u}`).join("\n"));
    if (changed.length > 5) console.log(`  … and ${changed.length - 5} more`);
    return;
  }

  const byHost = new Map();
  for (const u of changed) {
    const host = new URL(u).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(u);
  }

  let allOk = true;
  for (const [host, urls] of byHost) {
    const keyCheck = await keyFileIsLive(host);
    if (keyCheck !== true) {
      allOk = false;
      console.error(`✗ Key file ${keyLocation(host)} ${keyCheck}.`);
      console.error("  IndexNow will reject this host's URLs — deploy the site (and connect the domain) first, then retry.");
      continue;
    }
    console.log(`✓ Key file verified at ${keyLocation(host)}`);
    for (let i = 0; i < urls.length; i += BATCH_LIMIT) {
      const batch = urls.slice(i, i + BATCH_LIMIT);
      try {
        const status = await submit(host, batch);
        if (status === 200 || status === 202) {
          console.log(`✓ IndexNow accepted ${batch.length} URLs on ${host} (status ${status})`);
        } else {
          allOk = false;
          console.error(`✗ IndexNow returned status ${status} for ${batch.length} URLs on ${host}`);
        }
      } catch (err) {
        allOk = false;
        console.error(`✗ IndexNow request failed for ${host} — ${err.message}`);
      }
    }
  }

  // Only remember this run if it actually landed, so a failure retries next time.
  if (allOk) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(Object.fromEntries(current), null, 1));
    console.log(`✓ Recorded ${current.size} URLs in ${STATE_PATH}`);
  } else {
    process.exitCode = 1;
  }
}

main();
