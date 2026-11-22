Warning: truncated output (original token count: 43220)
Total output lines: 2400

// Live test suite — drives the site through a real headless browser
// against the ALREADY-RUNNING local dev server (hugo server -D), rather
// than doing its own build. Meant to run continuously alongside
// development via `npm run rev:test`.
//
// Safety: any form on this site that submits somewhere real (inquiry's
// purchase/commission/contact forms, the footer
// newsletter signup, unsubscribe) POSTs to window.APP_CONFIG.googleScriptUrl
// (a Google Apps Script webhook) and/or /.netlify/functions/verifyRecaptcha.
// Every test that exercises a form intercepts BOTH at the network layer
// (Chrome DevTools Protocol's Fetch domain) and fulfills them locally —
// the real endpoints are never contacted, so no real inquiry/subscriber/
// notification is ever created by running this suite.
//
// Doesn't stop at the first failure — every check runs, and everything
// that failed is listed at the end so it's clear what to go fix.
//
// Run with: npm run test:live  (or as part of: npm run rev:test)

import fs from "node:fs";
import { Browser } from "./lib/browser.mjs";

const BASE_URL = process.env.SITE_URL || "http://localhost:1313";
// --always-pass: used by `npm run rev:test` so a test failure never makes
// `concurrently` tear down the sibling dev-server/tailwind-watch panes —
// the pass/fail summary still prints in full either way. Plain
// `npm run test:live` (no flag) still exits non-zero on failure.
const ALWAYS_EXIT_0 = process.argv.includes("--always-pass");
const GOOGLE_SCRIPT_STUB_PATTERNS = ["script.google.com"];
// The exact Content-Security-Policy Netlify serves in production, read from netlify.toml,
// so form tests run under the same rules real visitors get. upgrade-insecure-requests is
// dropped only because the local dev server is plain http.
const PROD_CSP = (() => {
  const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf-8");
  const open = 'Content-Security-Policy = """';
  const at = toml.indexOf(open);
  if (at < 0) throw new Error("Could not find Content-Security-Policy in netlify.toml");
  const raw = toml.slice(at + open.length, toml.indexOf('"""', at + open.length));
  return raw.split("\\").join(" ").replace(/\s+/g, " ").replace(/upgrade-insecure-requests/, "").replace(/;\s*$/, "").trim();
})();
const NETLIFY_FN_STUB_PATTERNS = ["/.netlify/functions/"];

let passes = 0;
let failures = 0;
const failedLabels = [];

function ok(label) {
  passes++;
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}
function fail(label, detail) {
  failures++;
  failedLabels.push(label);
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  if (detail) console.log(`      ${String(detail).slice(0, 300)}`);
}
function section(title) {
  console.log(`\n${title}`);
}
// el.click() in headless Chrome dispatches with clientX/clientY at (0,0)
// rather than the element's center — fine for most buttons, but wrong for
// the book viewer, which reads click X position against the element's own
// bounding box to decide forward vs. back. Builds a page.evaluate() string
// that dispatches a real positioned MouseEvent instead.
function clickRightHalfOf(selector) {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    var r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', {
      clientX: r.left + r.width * 0.8,
      clientY: r.top + r.height / 2,
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    return true;
  })()`;
}
// The first-visit intro door sits full-screen and interactive for ~3.5-4s
// (its own new/old/ha logo sequence) before it dissolves — a click aimed
// at page content during that window actually lands on the door instead
// (real hit-testing, not a race in the test). Any test that clicks
// something right after page load needs to wait this out first.
async function waitForIntroDoorGone(page, timeout = 8000) {
  return page.waitFor(
    `(function(){ var d = document.getElementById('intro-door'); return !d || getComputedStyle(d).display === 'none'; })()`,
    { timeout }
  );
}
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).toLowerCase();
// Music still playing when a test closes its page would follow into the next test: music-player.js carries it
// from page to page through the mp-now cookie, and every tab here shares one browser. Each check starts without it.
let musicBrowser = null; // main()'s browser, once launched
async function forgetMusic() {
  const browser = musicBrowser;
  if (!browser) return;
  try {
    const { cookies } = await browser.send("Storage.getCookies", {});
    if (!cookies.some((c) => c.name === "mp-now")) return;
    await browser.send("Storage.clearCookies", {});
    const keep = cookies.filter((c) => c.name !== "mp-now").map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
      ...(c.sameSite ? { sameSite: c.sameSite } : {}), ...(c.session ? {} : { expires: c.expires }),
    }));
    if (keep.length) await browser.send("Storage.setCookies", { cookies: keep });
  } catch {}
}

async function check(label, fn) {
  if (ONLY && !label.toLowerCase().includes(ONLY)) return; // quick reruns: --only=text
  await forgetMusic();
  try {
    const detail = await fn();
    if (detail === false) fail(label);
    else ok(label);
  } catch (e) {
    fail(label, e.message || String(e));
  }
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Wires up the standard safety stubs on a page: any request to the Google
// Apps Script webhook or a Netlify function is faked locally. Returns the
// two rule objects so callers can assert on `.hits` afterward.
async function withSafetyStubs(page, verifyReply = { success: true, score: 0.9 }, replyBody = "OK") {
  await page.enforceCsp(PROD_CSP, new URL(BASE_URL).origin);
  // Behaves like the real Apps Script: the POST is answered with a 302 to
  // script.googleusercontent.com, and the "OK" is read from there. Stubbing a
  // plain 200 hid a real outage: the site's CSP blocked that redirect host, so
  // every form errored in production while these tests stayed green.
  const webhookRule = await page.interceptAndStub(GOOGLE_SCRIPT_STUB_PATTERNS, {
    status: 302,
    headers: { Location: "https://script.googleusercontent.com/macros/echo?user_content_key=test-stub", "Access-Control-Allow-Origin": "*" },
    body: "",
  });
  const replyRule = await page.interceptAndStub(["script.googleusercontent.com"], {
    status: 200,
    headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
    body: replyBody,
  });
  const netlifyFnRule = await page.interceptAndStub(NETLIFY_FN_STUB_PATTERNS, {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verifyReply),
  });
  return { webhookRule, netlifyFnRule, replyRule };
}

async function main() {
  section("Startup");
  const serverUp = await waitForServer(BASE_URL, 30000);
  if (!serverUp) {
    console.log(`\n\x1b[31mLocal dev server not reachable at ${BASE_URL} after 30s.\x1b[0m`);
    console.log("Make sure `npm run hugo` (or `npm run rev`) is running, or set SITE_URL.");
    process.exit(1);
  }
  ok(`Dev server reachable at ${BASE_URL}`);

  let browser;
  try {
    browser = await Browser.launch({ headless: true });
    musicBrowser = browser;
    // This suite tests the underlying site, not the door game. Start as a
    // visitor who has already unlocked it; door behavior has separate checks.
    await browser.send("Storage.setCookies", { cookies: [{ name: "door-session", value: "open", url: BASE_URL }] });
    ok("Headless browser launched");
  } catch (e) {
    fail("Headless browser launched", e.message);
    console.log("\nCan't run the live suite without a browser — skipping remaining checks.");
    console.log(`\n${passes} passed, ${failures} failed\n`);
    process.exit(1);
  }

  // ── 1. Page loads + console errors across the site ────────────────────
  section("Page loads (no console errors, real DOM renders)");
  const pages = [
    ["/", "Home"],
    ["/about/", "About"],
    ["/archive/", "Archive"],
    ["/oeuvre/", "Books/Oeuvre"],
    ["/photography/", "Photography"],
    ["/vestments/", "Vestments"],
    ["/vestments/vestment1/", "Vestment single"],
    ["/production/", "Production"],
    ["/production/ritual-annihilation-a/", "Track single"],
    ["/inquiry/", "Inquiry"],
    ["/links/", "Links"],
    ["/unsubscribe/", "Unsubscribe"],
    ["/docs/", "Docs"],
    ["/privacy/", "Privacy"],
  ];
  for (const [path, label] of pages) {
    await check(`${label} page loads with no console errors`, async () => {
      const page = await browser.newPage();
      await page.goto(BASE_URL + path);
      const title = await page.evaluate("document.title");
      const errors = page.consoleErrors;
      await page.close();
      if (!title) throw new Error("page has no <title>");
      if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);
      return true;
    });
  }

  // Sample a handful of individual artwork pages too (there are ~148；
  // checking all of them here would make this slow to run on every save,
  // so this is a bounded sample — the static build check in `npm test`
  // covers structural checks across all of them instead).
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    const sampleHrefs = await page.evaluate(
      `Array.from(document.querySelectorAll('#artworkGallery a')).slice(0, 4).map(a => a.getAttribute('href'))`
    );
    await page.close();
    for (const href of sampleHrefs || []) {
      await check(`Artwork page ${href} loads with no console errors`, async () => {
        const p = await browser.newPage();
        await p.goto(BASE_URL + href);
        const hasImage = await p.evaluate(`!!document.querySelector('.sp-img, img')`);
        const errors = p.consoleErrors;
        await p.close();
        if (!hasImage) throw new Error("no image found on artwork page");
        if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);
        return true;
      });
    }
  }

  // ── 2. Images actually load (not just present in markup) ──────────────
  section("Images actually load (catches broken/dead image URLs)");
  await check("Home page: all visible <img> tags load successfully", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    // Give lazy-loaded-but-in-viewport images a moment, and force any
    // lazy ones to resolve by checking .complete/.naturalWidth directly
    // rather than relying on scroll position.
    await new Promise((r) => setTimeout(r, 1500));
    const result = await page.evaluate(`(function(){
      var imgs = Array.from(document.querySelectorAll('img'));
      var broken = imgs.filter(function(img){
        return img.getAttribute('src') && img.complete && img.naturalWidth === 0;
      }).map(function(img){ return img.src; });
      return JSON.stringify({ total: imgs.length, broken: broken });
    })()`);
    const { total, broken } = JSON.parse(result);
    await page.close();
    if (broken.length) throw new Error(`${broken.length}/${total} broken: ${broken.slice(0, 5).join(", ")}`);
    return true;
  });

  await check("Archive page: all visible <img> tags load successfully", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/archive/");
    await new Promise((r) => setTimeout(r, 1500));
    const result = await page.evaluate(`(function(){
      var imgs = Array.from(document.querySelectorAll('img'));
      var broken = imgs.filter(function(img){
        return img.getAttribute('src') && img.complete && img.naturalWidth === 0;
      }).map(function(img){ return img.src; });
      return JSON.stringify({ total: imgs.length, broken: broken });
    })()`);
    const { total, broken } = JSON.parse(result);
    await page.close();
    if (broken.length) throw new Error(`${broken.length}/${total} broken: ${broken.slice(0, 5).join(", ")}`);
    return true;
  });

  // Books' cover images are hosted externally (raw.githubusercontent.com,
  // via each book's own `imageBase`) rather than shipped with this site —
  // this is the check that would have caught the "images not loading
  // because the GitHub repo only had the old/wrong files" incident.
  await check("Books/Oeuvre page: all visible <img> tags load successfully", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/oeuvre/");
    await new Promise((r) => setTimeout(r, 2000));
    const result = await page.evaluate(`(function(){
      var imgs = Array.from(document.querySelectorAll('img'));
      var broken = imgs.filter(function(img){
        return img.getAttribute('src') && img.complete && img.naturalWidth === 0;
      }).map(function(img){ return img.src; });
      return JSON.stringify({ total: imgs.length, broken: broken });
    })()`);
    const { total, broken } = JSON.parse(result);
    await page.close();
    if (total === 0) throw new Error("no <img> tags found on the Books page — grid may not have rendered");
    if (broken.length) throw new Error(`${broken.length}/${total} broken: ${broken.slice(0, 5).join(", ")}`);
    return true;
  });

  // ── 3. Interactive UI ───────────────────────────────────────────────
  section("Interactive UI");
  // Oct 2026: the site is dark-only (params.light_mode = false). The light theme's code is kept, but no
  // visitor can reach it: no toggle, and an old saved "light" choice is ignored.
  await check("Dark mode only: no theme toggle, and dark even for a visitor who once picked light", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    await page.evaluate(`localStorage.setItem('theme', 'light')`);
    await page.goto(BASE_URL + "/about/");
    const r = await page.evaluate(`({ dark: document.documentElement.classList.contains('dark'), toggle: !!document.getElementById('darkModeToggle') })`);
    await page.evaluate(`localStorage.removeItem('theme')`);
    await page.close();
    if (!r.dark) throw new Error("a saved light choice still turned the site light");
    if (r.toggle) throw new Error("the light/dark toggle is still on the page");
    return true;
  });

  await check("Header logo: every page load shows the page's own logo (Louis / Han / Odi Andrada / L' / Ny / Andrada), then turns into Jera Ansuz", async () => {
    const page = await browser.newPage();
    const active = `document.getElementById('logoMorphWrap')?.getAttribute('data-active')`;
    // Locally there are no subdomains, so the page's section decides (Artworks home = Louis "old",
    // Oeuvre = Han "ha", Photography = Odi Andrada "odi", Links and shared pages = Andrada "andrada";
    // Vestments = L' "l"; Production = Ny "ny").
    // The first stop can include the intro door (~4s) + entrance (900ms) + hold (3200ms): poll.
    for (const [path, logo, wait] of [["/", "old", 15000], ["/oeuvre/", "ha", 8000], ["/photography/photo3/", "odi", 8000], ["/vestments/vestment1/", "l", 8000], ["/production/omnipulse/", "ny", 8000], ["/links/", "andrada", 8000], ["/about/", "andrada", 8000]]) {
      await page.goto(BASE_URL + path);
      const shown = await page.evaluate(active);
      if (shown !== logo) throw new Error(`${path} opened on "${shown}", not its own logo "${logo}"`);
      if (!(await page.waitFor(`${active} === 'new'`, { timeout: wait }))) {
        throw new Error(`${path} never turned into Jera Ansuz ("new"); still "${await page.evaluate(active)}"`);
      }
    }
    await page.close();
    return true;
  });

  // Artworks, Oeuvre and Photography share one layout: the title, the search box and Filters pinned
  // in .book-page-header; on the Artworks home it waits while the hero is on screen.
  await check("Artworks uses the Oeuvre/Photography cluster: pinned title + search + Filters, hidden on the hero, search filters the grid", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1')`);
    await page.goto(BASE_URL + "/");
    await new Promise((r) => setTimeout(r, 1500));
    const cluster = `document.querySelector('body > main #artworks-section .book-page-header')`;
    const top = await page.evaluate(`(function(){ var c = ${cluster}; return c && { pos: getComputedStyle(c).position, vis: getComputedStyle(c).visibility,
      parts: !!(c.querySelector('h1') && c.querySelector('#artworksSearchInput') && c.querySelector('#filterToggle')) }; })()`);
    if (!top) throw new Error("no .book-page-header in the Artworks section");
    if (!top.parts) throw new Error("the cluster lacks the title, the search box or Filters");
    if (top.pos !== "fixed") throw new Error(`cluster is position:${top.pos}, not pinned like Oeuvre/Photography`);
    if (top.vis !== "hidden") throw new Error("cluster shows over the hero");
    await page.evaluate(`document.getElementById('artworks-section').scrollIntoView()`);
    const shown = await page.waitFor(`getComputedStyle(${cluster}).visibility === 'visible'`, { timeout: 4000 });
    if (!shown) throw new Error("cluster never appeared at the grid");
    const counts = await page.evaluate(`(function(){ var vis = function(){ return Array.from(document.querySelectorAll('body > main #artworkGallery .artwork-item')).filter(function(e){ return e.style.display !== 'none'; }).length; };
      var before = vis(), i = document.querySelector('body > main #artworksSearchInput'); i.value = 'untitled'; i.dispatchEvent(new Event('input'));
      var after = vis(); i.value = ''; i.dispatchEvent(new Event('input')); return { before: before, after: after, reset: vis() }; })()`);
    await page.close();
    if (!(counts.after > 0 && counts.after < counts.before)) throw new Error(`search didn't filter the grid (${counts.before} -> ${counts.after})`);
    if (counts.reset !== counts.before) throw new Error(`clearing the search didn't bring every artwork back (${counts.reset}/${counts.before})`);
    return true;
  });

  // The menus open each face at its grid with a hash (louis.andrada.one/#artworks-section, han./#oeuvre,
  // odi./#photography, l./#vestments, ny./#production). The page must scroll to the grid and drop the hash: the address bar shows the bare face.
  // Vestments (L', Oct 2026): Filters by Category / Type / Sleeves, built from the pages' own values.
  await check("Vestments: Filters narrow the grid by Type and Sleeves, show the choice, and Deselect all brings everything back", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/vestments/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
    await page.goto(BASE_URL + "/vestments/");
    await new Promise((r) => setTimeout(r, 1500));
    const shown = `[].filter.call(document.querySelectorAll('body > main #bookGallery .aw-item'), function (i) { return i.style.display !== 'none'; }).length`;
    const pick = (key, value) => page.evaluate(`document.querySelector('body > main #bookFilterOverlay [data-filter="${key}"][data-value="${value}"]').click(); true`);
    const problems = [];
    const all = await page.evaluate(shown);
    if (all < 2) problems.push(`only ${all} vestment(s) on the page`);
    const groups = await page.evaluate(`[].map.call(document.querySelectorAll('body > main #bookFilterOverlay .artwork-filter-group-label'), function (g) { return g.textContent.trim(); }).join(",")`);
    if (groups !== "Category,Type,Sleeves") problems.push(`filter groups read "${groups}"`);
    await page.evaluate(`document.querySelector('body > main #bookFilterToggle').click(); true`);
    if (!(await page.evaluate(`document.querySelector('body > main #bookFilterOverlay').classList.contains('open')`))) problems.push("Filters didn't open");
    await pick("garment", "t-shirt");
    const tees = await page.evaluate(shown);
    const wanted = await page.evaluate(`document.querySelectorAll('body > main #bookGallery .aw-item[data-garment="T-shirt"]').length`);
    if (tees !== wanted || tees === 0) problems.push(`Type T-shirt shows ${tees}, expected ${wanted}`);
    const tag = await page.evaluate(`document.querySelector('body > main #activeBookFilterTags').textContent`);
    if (!/Type\s*T-shirt/.test(tag)) problems.push(`the active tag reads "${tag}"`);
    await pick("sleeve", "long");
    const both = await page.evaluate(shown);
    const wantedBoth = await page.evaluate(`document.querySelectorAll('body > main #bookGallery .aw-item[data-garment="T-shirt"][data-sleeve="Long"]').length`);
    if (both !== wantedBoth) problems.push(`T-shirt + Long shows ${both}, expected ${wantedBoth}`);
    await page.evaluate(`document.querySelector('body > main #bookFilterResetBtn').click(); true`);
    const back = await page.evaluate(shown);
    if (back !== all) problems.push(`Deselect all shows ${back} of ${all}`);
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  // Production (Ny, Oct 2026): Ny's tracks. A cover click opens the popup AND starts that track; the popup's
  // arrows change track; closing it leaves the music in a now-playing bar; a track's end starts the next one.
  // Real mouse clicks (browsers only let sound start inside a visitor's own gesture), under the production CSP:
  // the MP3s must come from the site's own /audio/ (the CSP has no media-src).
  await check("Production: a cover click opens its popup and plays it; arrows change track; closing keeps the music in the now-playing bar", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900);
    await page.enforceCsp(PROD_CSP, new URL(BASE_URL).origin);
    await page.goto(BASE_URL + "/production/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
    await page.goto(BASE_URL + "/production/");
    await new Promise((r) => setTimeout(r, 1500));
    const click = async (sel, i = 0) => {
      await page.evaluate(`document.querySelectorAll(${JSON.stringify(sel)})[${i}].scrollIntoView({ block: 'center' }); true`);
      await new Promise((r) => setTimeout(r, 200));
      const p = await page.evaluate(`(function () { var b = document.querySelectorAll(${JSON.stringify(sel)})[${i}].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await page.browser.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
    };
    const st = `(function () { var s = window.musicPlayer.state(), a = window.musicPlayer.audio; return { id: s.track && s.track.id, playing: s.playing, t: a.currentTime, src: a.currentSrc,
      open: document.getElementById('photoModal').classList.contains('open'), mini: !!document.querySelector('.mp-mini.show'), title: document.getElementById('photoModalTitle').textContent }; })()`;
    const problems = [];
    const ids = await page.evaluate(`[].map.call(document.querySelectorAll('body > main #bookGallery .aw-item'), function (a) { return a.dataset.id; })`);
    if (ids.length < 3) problems.push(`only ${ids.length} record(s) on the page`);
    const titleOf = (id) => page.evaluate(`JSON.parse(document.getElementById('mpTracksData').textContent).find(function (t) { return t.id === ${JSON.stringify(id)}; }).title`);
    await click("body > main #bookGallery .aw-item", 1);
    if (!(await page.waitFor(`window.musicPlayer.audio.currentTime > 0.3`, { timeout: 10000 }))) problems.push("the clicked track never started playing");
    let s = await page.evaluate(st);
    if (!s.open || s.id !== ids[1] || !s.playing) problems.push(`after the cover click: ${JSON.stringify(s)}`);
    if (!/^http:\/\/[^/]+\/audio\/[^/]+\.mp3$/.test(s.src || "")) problems.push(`the MP3 isn't served from the site's own /audio/ (${s.src})`);
    const q = await page.evaluate(`window.musicPlayer.queue()`);
    const next1 = q[q.indexOf(ids[1]) + 1], next2 = q[q.indexOf(ids[1]) + 2];
    await click("#photoNextBtn");
    if (!(await page.waitFor(`window.musicPlayer.state().track.id === ${JSON.stringify(next1)} && window.musicPlayer.audio.currentTime > 0.3`, { timeout: 10000 }))) problems.push(`the next arrow didn't play ${next1}`);
    s = await page.evaluate(st);
    if (s.title !== (await titleOf(next1))) problems.push(`the popup shows "${s.title}", not the playing track`);
    await click("#photoModalClose");
    await new Promise((r) => setTimeout(r, 700));
    s = await page.evaluate(st);
    if (s.open || !s.playing || !s.mini) problems.push(`after closing: ${JSON.stringify(s)} (expected: closed, still playing, bar shown)`);
    await page.evaluate(`window.musicPlayer.seek(window.musicPlayer.state().duration - 1.2); true`);
    if (!(await page.waitFor(`window.musicPlayer.state().track && window.musicPlayer.state().track.id === ${JSON.stringify(next2)} && window.musicPlayer.state().playing`, { timeout: 8000 }))) problems.push(`a track's end didn't start the next one (${next2})`);
    await click(".mp-mini-x");
    await new Promise((r) => setTimeout(r, 500));
    s = await page.evaluate(st);
    if (s.id || s.mini) problems.push(`the bar's X didn't stop the music: ${JSON.stringify(s)}`);
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  // The player under the hero's cover (Louis, Oct 2026): before anything plays it shows the newest release,
  // ready; Side A · Side B switch sides; whatever plays (a grid cover, the arrows, the bar) shows there too.
  await check("Production: the hero's player starts the newest release, switches sides, and follows whatever plays", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900);
    await page.goto(BASE_URL + "/production/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
    await page.goto(BASE_URL + "/production/");
    await new Promise((r) => setTimeout(r, 1500));
    const click = async (sel, i = 0) => {
      await page.evaluate(`document.querySelectorAll(${JSON.stringify(sel)})[${i}].scrollIntoView({ block: 'center' }); true`);
      await new Promise((r) => setTimeout(r, 250));
      const p = await page.evaluate(`(function () { var b = document.querySelectorAll(${JSON.stringify(sel)})[${i}].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await page.browser.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
    };
    const hero = `(function () { var b = document.querySelector('body > main .face-hero-player'); return { name: b.querySelector('.fh-name').textContent,
      sides: [].map.call(b.querySelectorAll('.mp-side'), function (x) { return x.textContent + (x.classList.contains('active') ? '*' : ''); }).join(','),
      img: document.querySelector('body > main .face-hero .hp-image').getAttribute('src'), hint: !!b.querySelector('.mp-hint'),
      id: window.musicPlayer.state().track && window.musicPlayer.state().track.id }; })()`;
    const problems = [];
    let h = await page.evaluate(hero);
    if (h.name !== "Ritual Annihilation" || h.sides !== "Side A*,Side B" || h.id) problems.push(`before playing, the hero shows ${JSON.stringify(h)}`);
    if (h.hint) problems.push("the line is back under the hero's player (Louis took it out; it belongs at the top of the grid only)");
    if (!(await page.evaluate(`/click any of the musics/.test(document.querySelector('body > main .mp-hint-grid').textContent)`))) problems.push("no line at the top of the grid");
    await click("#heroPlayer .mp-play");
    if (!(await page.waitFor(`window.musicPlayer.state().track && window.musicPlayer.state().track.id === 'ritual-annihilation-a' && window.musicPlayer.audio.currentTime > 0.3`, { timeout: 10000 }))) problems.push("the hero's play button didn't start Ritual Annihilation (Side A)");
    await click("body > main .face-hero-player .mp-side", 1);
    if (!(await page.waitFor(`window.musicPlayer.state().track.id === 'ritual-annihilation-b' && window.musicPlayer.state().playing`, { timeout: 10000 }))) problems.push("Side B didn't play Side B");
    h = await page.evaluate(hero);
    if (h.sides !== "Side A,Side B*" || !/ritual-annihilation-b/.test(h.img)) problems.push(`after Side B, the hero shows ${JSON.stringify(h)}`);
    const sq = await page.evaluate(`(function () { var a = document.querySelector('body > main #bookGallery .aw-item'); return { id: a.dataset.id, img: a.querySelector('img').getAttribute('src') }; })()`);
    if (sq.id !== "ritual-annihilation-b" || !/ritual-annihilation-b/.test(sq.img)) problems.push(`the grid's Ritual Annihilation square didn't turn to Side B: ${JSON.stringify(sq)}`);
    const third = await page.evaluate(`document.querySelectorAll('body > main #bookGallery .aw-item')[2].dataset.id`);
    await click("body > main #bookGallery .aw-item", 2);
    await page.waitFor(`window.musicPlayer.state().track.id === ${JSON.stringify(third)}`, { timeout: 10000 });
    await page.evaluate(`document.getElementById('photoModalClose').click(); true`);
    h = await page.evaluate(hero);
    if (!h.img.includes(third)) problems.push(`after playing ${third} from the grid, the hero still shows ${h.img}`);
    await page.evaluate(`window.musicPlayer.stop(); true`);
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  // Two sides, one square (Louis, 2026-10-13): Side A, then Side B, then the next record; the square, the popup's
  // Side A · Side B and its cover follow the side that plays.
  await check("Production: a two-sided song is one square that plays Side A, then Side B, then the next record, its cover following the side", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900);
    await page.goto(BASE_URL + "/production/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
    await page.goto(BASE_URL + "/production/");
    await new Promise((r) => setTimeout(r, 1500));
    const sq = `document.querySelector('body > main #bookGallery .aw-item')`;
    await page.evaluate(`${sq}.scrollIntoView({ block: 'center' }); true`);
    await new Promise((r) => setTimeout(r, 250));
    const p = await page.evaluate(`(function () { var b = ${sq}.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await page.browser.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
    const view = `(function () { var a = ${sq}; return { id: window.musicPlayer.state().track && window.musicPlayer.state().track.id, square: a.dataset.id, img: a.querySelector('img').getAttribute('src'),
      label: (a.querySelector('.aw-lbl-b') || {}).textContent || '', sides: [].map.call(document.querySelectorAll('body > main #photoModalSides .mp-side'), function (x) { return x.textContent + (x.classList.contains('active') ? '*' : ''); }).join(','),
      title: document.getElementById('photoModalTitle').textContent }; })()`;
    const problems = [];
    if (!(await page.waitFor(`window.musicPlayer.state().track && window.musicPlayer.state().track.id === 'ritual-annihilation-a' && window.musicPlayer.audio.currentTime > 0.3`, { timeout: 10000 }))) problems.push("the square didn't play Side A");
    let v = await page.evaluate(view);
    if (v.sides !== "Side A*,Side B") problems.push(`the popup's sides read "${v.sides}"`);
    await page.evaluate(`window.musicPlayer.seek(window.musicPlayer.state().duration - 1.2); true`);
    if (!(await page.waitFor(`window.musicPlayer.state().track.id === 'ritual-annihilation-b' && window.musicPlayer.state().playing`, { timeout: 8000 }))) problems.push("Side A's end didn't start Side B");
    v = await page.evaluate(view);
    if (v.square !== "ritual-annihilation-b" || !/ritual-annihilation-b/.test(v.img)) problems.push(`the square didn't turn to Side B: ${JSON.stringify(v)}`);
    if (v.label !== "Ritual Annihilation — Side A & B") problems.push(`the square's title reads "${v.label}", not the record's "Ritual Annihilation — Side A & B"`);
    if (v.sides !== "Side A,Side B*" || v.title !== "Ritual Annihilation") problems.push(`the popup after Side A: ${JSON.stringify(v)}`);
    const q = await page.evaluate(`window.musicPlayer.queue()`);
    const after = q[q.indexOf("ritual-annihilation-b") + 1];
    await page.evaluate(`window.musicPlayer.seek(window.musicPlayer.state().duration - 1.2); true`);
    if (!(await page.waitFor(`window.musicPlayer.state().track.id === ${JSON.stringify(after)}`, { timeout: 8000 }))) problems.push(`Side B's end didn't start the next record (${after})`);
    await page.evaluate(`window.musicPlayer.play('ritual-annihilation-a'); true`);
    await new Promise((r) => setTimeout(r, 300));
    v = await page.evaluate(view);
    if (v.square !== "ritual-annihilation-a" || !/ritual-annihilation-a/.test(v.img)) problems.push(`back on Side A, the square shows ${JSON.stringify(v)}`);
    await page.evaluate(`window.musicPlayer.stop(); true`);
    await page.goto(BASE_URL + "/production/ritual-annihilation-b/");
    const links = await page.evaluate(`[].map.call(document.querySelectorAll('body > main .mp-sides .mp-side'), function (a) { return a.textContent + (a.classList.contains('active') ? '*' : '') + '>' + a.getAttribute('href'); }).join(',')`);
    if (links !== "Side A>/production/ritual-annihilation-a/,Side B*>/production/ritual-annihilation-b/") problems.push(`Side B's page links its sides as "${links}"`);
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  await check("Production: Filters narrow the grid by Style, Elements and Voice, and Deselect all brings everything back", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900);
    await page.goto(BASE_URL + "/production/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
    await page.goto(BASE_URL + "/production/");
    await new Promise((r) => setTimeout(r, 1500));
    const shown = `[].filter.call(document.querySelectorAll('body > main #bookGallery .aw-item'), function (i) { return i.style.display !== 'none'; }).length`;
    const pick = (key, value) => page.evaluate(`document.querySelector('body > main #bookFilterOverlay [data-filter="${key}"][data-value="${value}"]').click(); true`);
    const count = (sel) => page.evaluate(`document.querySelectorAll('body > main #bookGallery .aw-item${sel}').length`);
    const problems = [];
    const all = await page.evaluate(shown);
    const groups = await page.evaluate(`[].map.call(document.querySelectorAll('body > main #bookFilterOverlay .artwork-filter-group-label'), function (g) { return g.textContent.trim(); }).join(",")`);
    if (groups !== "Style,Elements,Voice") problems.push(`filter groups read "${groups}"`);
    await page.evaluate(`document.querySelector('body > main #bookFilterToggle').click(); true`);
    await pick("style", "hard techno");
    const hard = await page.evaluate(shown), wantHard = await count(`[data-style="Hard Techno"]`);
    if (hard !== wantHard || !hard) problems.push(`Style Hard Techno shows ${hard}, expected ${wantHard}`);
    await pick("style", "all");
    await pick("elements", "dubstep drops");
    const dub = await page.evaluate(shown), wantDub = await count(`[data-elements*="Dubstep drops"]`);
    if (dub !== wantDub || !dub) problems.push(`Elements Dubstep drops shows ${dub}, expected ${wantDub}`);
    await pick("voice", "vocals");
    const both = await page.evaluate(shown), wantBoth = await count(`[data-elements*="Dubstep drops"][data-voice="Vocals"]`);
    if (both !== wantBoth) problems.push(`Dubstep drops + Vocals shows ${both}, expected ${wantBoth}`);
    const tag = await page.evaluate(`document.querySelector('body > main #activeBookFilterTags').textContent`);
    if (!/Elements\s*Dubstep drops/.test(tag) || !/Voice\s*Vocals/.test(tag)) problems.push(`the active tags read "${tag}"`);
    await page.evaluate(`document.querySelector('body > main #bookFilterResetBtn').click(); true`);
    if ((await page.evaluate(shown)) !== all) problems.push("Deselect all didn't bring every track back");
    const label = await page.evaluate(`(document.querySelector('body > main #bookGallery .aw-item .aw-lbl-r, body > main #bookGallery .aw-item .aw-lbl-l') || {}).textContent || ''`);
    if (!/Techno|Rave|Hardcore|Dubstep/.test(label)) problems.push(`the side label reads "${label}", not the track's style`);
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  await check("Production: the speaker opens the volume line (click, scroll wheel); the left end mutes; a click elsewhere closes it", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900);
    await page.goto(BASE_URL + "/production/omnipulse/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); localStorage.removeItem('mp-volume'); localStorage.removeItem('mp-muted'); true`);
    await page.goto(BASE_URL + "/production/omnipulse/");
    await new Promise((r) => setTimeout(r, 800));
    const problems = [];
    if (await page.evaluate(`document.querySelector('#trackPlayer .mp-vol').classList.contains('open')`)) problems.push("the volume line shows before the speaker is clicked");
    await page.evaluate(`document.querySelector('#trackPlayer .mp-volbtn').click(); true`);
    await new Promise((r) => setTimeout(r, 300));
    if (!(await page.evaluate(`document.querySelector('#trackPlayer .mp-vol').classList.contains('open')`))) problems.push("clicking the speaker didn't open the volume line");
    const box = await page.evaluate(`(function () { var b = document.querySelector('#trackPlayer .mp-vbar .mp-bar-line').getBoundingClientRect(); return { l: b.left, w: b.width, y: b.top + b.height / 2 }; })()`);
    const mouse = async (type, x, y, extra = {}) => page.browser.send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: type === "mouseMoved" || type === "mouseWheel" ? "none" : "left", clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 }, extra), page.sessionId);
    const vol = `({ v: window.musicPlayer.audio.volume, m: window.musicPlayer.state().muted, fill: document.querySelector('#trackPlayer .mp-vfill').style.width })`;
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await mouse(type, box.l + box.w * 0.25, box.y);
    let r = await page.evaluate(vol);
    if (Math.abs(r.v - 0.25) > 0.05 || r.fill !== "25%") problems.push(`a click at a quarter of the line set ${JSON.stringify(r)}`);
    await mouse("mouseWheel", box.l + box.w / 2, box.y, { deltaX: 0, deltaY: -100 });
    await new Promise((r) => setTimeout(r, 150));
    const up = (await page.evaluate(vol)).v;
    if (!(up > r.v)) problems.push(`scrolling up didn't raise it (${r.v} -> ${up})`);
    await mouse("mouseWheel", box.l + box.w / 2, box.y, { deltaX: 0, deltaY: 100 });
    await mouse("mouseWheel", box.l + box.w / 2, box.y, { deltaX: 0, deltaY: 100 });
    await new Promise((r) => setTimeout(r, 150));
    const down = (await page.evaluate(vol)).v;
    if (!(down < up)) problems.push(`scrolling down didn't lower it (${up} -> ${down})`);
    const kept = await page.evaluate(`localStorage.getItem('mp-volume')`);
    if (Math.abs(parseFloat(kept) - down) > 0.001) problems.push(`the volume isn't kept for the next visit (${kept})`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await mouse(type, box.l - 2, box.y);
    r = await page.evaluate(vol);
    if (!r.m || r.fill !== "0%" || !(await page.evaluate(`document.querySelector('#trackPlayer').classList.contains('is-muted')`))) problems.push(`sliding to the left end didn't mute: ${JSON.stringify(r)}`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await mouse(type, 40, 400);
    await new Promise((r) => setTimeout(r, 300));
    if (await page.evaluate(`document.querySelector('#trackPlayer .mp-vol').classList.contains('open')`)) problems.push("a click elsewhere didn't close the volume line");
    await page.evaluate(`localStorage.removeItem('mp-volume'); localStorage.removeItem('mp-muted'); true`);
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  await check("Production: the newest record (Ritual Annihilation, Sides A and B) leads the grid as one square and the hero, and a track's own page plays it", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900);
    await page.enforceCsp(PROD_CSP, new URL(BASE_URL).origin);
    await page.goto(BASE_URL + "/production/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
    await page.goto(BASE_URL + "/production/");
    const problems = [];
    const first = await page.evaluate(`document.querySelector('body > main #bookGallery .aw-item').dataset.sides`);
    if (first !== "ritual-annihilation-a ritual-annihilation-b") problems.push(`the grid opens with ${first}`);
    const titles = await page.evaluate(`[].map.call(document.querySelectorAll('body > main #bookGallery .aw-item'), function (a) { return a.dataset.title; })`);
    const twice = titles.filter((t, i) => titles.indexOf(t) !== i);
    if (twice.length) problems.push(`the same song has two squares: ${twice.join(", ")} (its sides belong in one)`);
    const hero = await page.evaluate(`(document.querySelector('body > main .face-hero .hp-image') || {}).getAttribute ? document.querySelector('body > main .face-hero .hp-image').getAttribute('src') : ''`);
    if (!/ritual-annihilation-a/.test(hero)) problems.push(`the hero shows ${hero}`);
    await page.goto(BASE_URL + "/production/omnipulse/");
    await new Promise((r) => setTimeout(r, 800));
    const p = await page.evaluate(`(function () { var b = document.querySelector('#trackPlayer .mp-play').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await page.browser.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
    if (!(await page.waitFor(`window.musicPlayer.audio.currentTime > 0.3 && window.musicPlayer.state().track.id === 'omnipulse'`, { timeout: 10000 }))) problems.push("the track page's play button didn't play it");
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  // From page to page (Louis, 2026-10-14: the music should go on while visitors explore). music-player.js writes what
  // plays to the mp-now cookie at pagehide; the next page (any face) loads the player only while it exists and goes
  // on at the same second, with the same volume. Where the browser refuses sound before a touch, the bar waits and
  // the first key or click goes on (the test accepts either, and says which). A tab opened alongside shows it paused,
  // never the same music twice; the bar steps aside for the footer (the newsletter form); its ✕ ends it everywhere.
  await check("Production: the music goes on from page to page (another page, a track's own page) at the same second and volume; ✕ ends it everywhere", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900);
    await page.enforceCsp(PROD_CSP, new URL(BASE_URL).origin);
    const problems = [];
    const mouse = async (x, y) => {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await page.browser.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
    };
    const click = async (sel, i = 0) => {
      await page.evaluate(`document.querySelectorAll(${JSON.stringify(sel)})[${i}].scrollIntoView({ block: 'center' }); true`);
      await new Promise((r) => setTimeout(r, 200));
      const p = await page.evaluate(`(function () { var b = document.querySelectorAll(${JSON.stringify(sel)})[${i}].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      await mouse(p.x, p.y);
    };
    // leave the page the way a visitor does: their own click on a link
    const follow = async (href) => {
      await page.evaluate(`(function () { var a = document.createElement('a'); a.href = ${JSON.stringify(href)}; a.textContent = 'go';
        a.style.cssText = 'position:fixed;left:0;top:0;width:60px;height:40px;z-index:99999;background:#888'; document.body.appendChild(a); return true; })()`);
      const loaded = new Promise((resolve) => { const off = page.browser.on("Page.loadEventFired", () => { off(); resolve(); }, page.sessionId); setTimeout(resolve, 20000); });
      await mouse(30, 20);
      await loaded;
    };
    const st = `(function () { var p = window.musicPlayer; if (!p) return null; var s = p.state(); return { id: s.track && s.track.id, playing: s.playing,
      t: p.audio.currentTime, vol: p.audio.volume, bar: !!document.querySelector('.mp-mini.show'), src: p.audio.currentSrc }; })()`;
    const playing = `window.musicPlayer.state().playing && window.musicPlayer.audio.currentTime > 0`;
    const goesOn = async (where, id, t0) => {
      if (!(await page.waitFor(`!!window.musicPlayer && !!window.musicPlayer.state().track`, { timeout: 8000 }))) { problems.push(`${where}: the music wasn't picked up`); return null; }
      let how = "on its own";
      let played = await page.waitFor(playing, { timeout: 6000 });
      if (!played) { // refused before a touch: the first key goes on with it
        how = "after the first key";
        for (const type of ["keyDown", "keyUp"])
          await page.browser.send("Input.dispatchKeyEvent", { type, key: "m", code: "KeyM", text: type === "keyDown" ? "m" : undefined }, page.sessionId);
        played = await page.waitFor(playing, { timeout: 6000 });
      }
      const s = await page.evaluate(st);
      if (!played) problems.push(`${where}: the music didn't go on (${JSON.stringify(s)})`);
      else console.log(`      ${where}: it went on ${how}`);
      if (s.id !== id) problems.push(`${where}: ${s.id} came instead of ${id}`);
      if (s.t < t0 - 0.5) problems.push(`${where}: it started over (at ${s.t.toFixed(1)} s, it had reached ${t0.toFixed(1)} s)`);
      if (Math.abs(s.vol - 0.4) > 0.01) problems.push(`${where}: the volume came back at ${s.vol}, not 0.4`);
      if (!/\/audio\/[^/]+\.mp3$/.test(s.src || "")) problems.push(`${where}: the MP3 isn't the site's own /audio/ (${s.src})`);
      return s;
    };

    // a page with no music loads no player at all
    await page.goto(BASE_URL + "/about/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
    await page.goto(BASE_URL + "/about/");
    await new Promise((r) => setTimeout(r, 500));
    if (await page.evaluate(`!!window.musicPlayer || !!document.querySelector('script[src*="/js/music"]')`)) problems.push("a page with no music loaded the player");

    await page.goto(BASE_URL + "/production/");
    await new Promise((r) => setTimeout(r, 1200));
    await click("body > main #bookGallery .aw-item", 2);
    if (!(await page.waitFor(`window.musicPlayer.audio.currentTime > 4`, { timeout: 15000 }))) problems.push("the track never got going on Production");
    await page.evaluate(`window.musicPlayer.setVolume(0.4); true`);
    await click("#photoModalClose");
    const first = await page.evaluate(st);

    // another page (the About page): on with the same track, from where it was
    await follow("/about/");
    const about = await goesOn("About", first.id, first.t);
    if (about && !about.bar) problems.push("About: no now-playing bar");
    // the footer stays reachable ("Join the List", the legal links): at the bottom of the page the bar rises above it
    const clearOfFooter = `(function () { var m = document.querySelector('.mp-mini.show'), f = document.querySelector('#footerWrap > footer');
      return !!m && m.getBoundingClientRect().bottom <= f.getBoundingClientRect().top + 1; })()`;
    await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); true`);
    if (!(await page.waitFor(clearOfFooter, { timeout: 3000 }))) problems.push("at the bottom of the About page the bar covers the footer");
    await page.evaluate(`window.scrollTo(0, 0); true`);

    // a tab opened alongside: the same track in its bar, paused (never the same music twice)
    const other = await browser.newPage();
    await other.goto(BASE_URL + "/links/");
    await other.waitFor(`!!window.musicPlayer && !!window.musicPlayer.state().track`, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 1000));
    const o = await other.evaluate(st);
    if (!o || o.playing || o.id !== first.id) problems.push(`a tab opened alongside: ${JSON.stringify(o)} (expected ${first.id}, paused)`);
    await other.close();

    // a track's own page, another track: the music goes on in the bar, the page's own player waits with its track
    const ownId = first.id === "omnipulse" ? "no-return" : "omnipulse";
    const t1 = await page.evaluate(`window.musicPlayer.audio.currentTime`);
    await follow(`/production/${ownId}/`);
    const own = await goesOn(`${ownId}'s page`, first.id, t1);
    if (own && !own.bar) problems.push("a track's own page: no bar for the music carried there");
    if (own && !(await page.evaluate(clearOfFooter))) problems.push("a track's own page: the bar covers the footer");
    // on a phone, at the end of the page, the bar rests in its slot above the footer: it covers neither the footer nor
    // the page's own player
    await page.setViewport(390, 844, true);
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); true`);
    await new Promise((r) => setTimeout(r, 600));
    const covers = await page.evaluate(`(function () { var m = document.querySelector('.mp-mini.show'), o = document.getElementById('trackPlayer'), f = document.querySelector('#footerWrap > footer');
      if (!m) return 'nothing: there is no bar'; var a = m.getBoundingClientRect(), b = o.getBoundingClientRect(), c = f.getBoundingClientRect();
      return [a.bottom > c.top + 1 ? 'the footer' : '', a.top < b.bottom && a.bottom > b.top ? "the page's own player" : ''].filter(Boolean).join(' and '); })()`);
    if (covers) problems.push(`phone, end of a track's page: the bar covers ${covers}`);
    await page.setViewport(1440, 900);
    await new Promise((r) => setTimeout(r, 400));
    if (await page.evaluate(`document.getElementById('trackPlayer').classList.contains('is-playing')`)) problems.push("the track page's own player shows itself playing");

    // ✕ ends it everywhere: the next page loads no player
    await click(".mp-mini-x");
    if (!(await page.waitFor(`!window.musicPlayer.state().track`, { timeout: 3000 }))) problems.push("the ✕ didn't stop the music");
    await follow("/about/");
    await new Promise((r) => setTimeout(r, 600));
    if (await page.evaluate(`!!window.musicPlayer || !!document.querySelector('.mp-mini')`)) problems.push("after the ✕, the next page still loaded the player");
    const csp = page.cspViolations.filter((t) => !/livereload/i.test(t));
    if (csp.length) problems.push(`CSP: ${csp.join(" | ")}`);
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  await check("Menu links that open a face at its grid scroll there and leave no #hash in the address bar", async () => {
    const page = await browser.newPage();
    const problems = [];
    for (const path of ["/#artworks-section", "/oeuvre/#oeuvre", "/photography/#photography", "/vestments/#vestments", "/production/#production"]) {
      await page.goto(BASE_URL + path);
      await page.waitFor(`!location.hash && scrollY > 200`, { timeout: 5000 });
      const r = await page.evaluate(`({ hash: location.hash, y: Math.round(scrollY) })`);
      if (r.hash) problems.push(`${path}: hash still in the address bar ("${r.hash}")`);
      if (r.y <= 200) problems.push(`${path}: didn't scroll to the grid (scrollY ${r.y})`);
    }
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  // Career (Luis, luis.andrada.one, Oct 2026): no hero (Louis: the page starts right on the resume, the menu only
  // in the header). A small portrait sits on top of his name; the pinned cluster's section links scroll to their
  // section and mark it.
  await check("Career: opens on the resume (header menu, small portrait over the name), section links scroll and mark", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/career/");
    await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
    await page.goto(BASE_URL + "/career/");
    await new Promise((r) => setTimeout(r, 1200));
    const problems = [];
    const top = JSON.parse(await page.evaluate(`JSON.stringify((function(){ var m = document.querySelector('body > main');
      var name = m.querySelector('.cr-name'), av = m.querySelector('.cr-avatar'), nav = document.getElementById('desktopNav');
      var n = name.getBoundingClientRect(), a = av ? av.getBoundingClientRect() : null;
      return { hero: !!m.querySelector('.face-hero, .hp-nav'), heroClass: document.documentElement.classList.contains('hero-in-view'),
        nameTop: n.top, vh: innerHeight, navOpacity: nav ? getComputedStyle(nav).opacity : null,
        av: a && { w: a.width, bottom: a.bottom, left: a.left }, nameLeft: n.left, loaded: av ? av.complete && av.naturalWidth > 0 : false,
        cluster: getComputedStyle(m.querySelector('.career-cluster')).visibility }; })())`));
    if (top.hero || top.heroClass) problems.push("the page still has a hero");
    if (top.nameTop > top.vh * 0.6) problems.push(`the resume doesn't start on the first screen (name at ${Math.round(top.nameTop)}px)`);
    if (top.navOpacity !== "1") problems.push(`the header menu isn't showing (opacity ${top.navOpacity})`);
    if (!top.av) problems.push("no portrait");
    else {
      if (top.av.w > 200) problems.push(`the portrait is ${Math.round(top.av.w)}px wide (meant to be small)`);
      if (top.av.bottom > top.nameTop + 1 || Math.abs(top.av.left - top.nameLeft) > 2) problems.push("the portrait isn't right on top of the name");
      if (!top.loaded) problems.push("the portrait didn't load");
    }
    if (top.cluster !== "visible") problems.push("the pinned cluster is hidden");
    await page.evaluate(`document.querySelector('body > main .career-cluster a[href="#skills"]').click(); true`);
    const reached = await page.waitFor(`Math.abs(document.querySelector('body > main #skills').getBoundingClientRect().top) < 120`, { timeout: 4000 });
    if (!reached) problems.push("Skills link didn't bring Skills to the top");
    if (!(await page.waitFor(`document.querySelector('body > main .career-cluster a[href="#skills"]').classList.contains('is-current')`, { timeout: 2000 }))) problems.push("Skills isn't marked as the section being read");
    if (await page.evaluate(`location.hash`)) problems.push("a section link put a #hash in the address bar");
    const links = await page.evaluate(`JSON.stringify([].map.call(document.querySelectorAll('body > main .cr-meta a'), function (a) { return a.getAttribute('href'); }))`);
    if (!/linkedin\.com\/in\//.test(links) || !/"\/inquiry\/"/.test(links)) problems.push(`the resume's head links are ${links}`);
    await page.close();
    if (problems.length) throw new Error(problems.join("; "));
    return true;
  });

  await check("Artwork modal opens and closes cleanly", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    await page.evaluate(`document.querySelector('#artworkGallery .artwork-item')?.click()`);
    const opened = await page.waitFor(`document.getElementById('arwModal')?.classList.contains('open')`, { timeout: 3000 });
    if (!opened) throw new Error("modal never gained .open class after clicking a thumbnail");
    await page.evaluate(`document.getElementById('arwClose')?.click()`);
    const closed = await page.waitFor(`!document.getElementById('arwModal')?.classList.contains('open')`, { timeout: 3000 });
    await page.close();
    if (!closed) throw new Error("modal never lost .open class after clicking close");
    return true;
  });

  // Clicking a book on the Oeuvre grid must pop up the viewer in place —
  // never navigate to a new page/tab (the standalone /oeuvre/<slug>/ page
  // still exists separately for direct links, but the grid itself should
  // stay put).
  await check("Book popup opens and closes cleanly, without navigating away", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/oeuvre/");
    await waitForIntroDoorGone(page);
    const urlBefore = await page.evaluate("location.href");
    // Skip the page's own "site mirror" clone of the grid (tabindex=-1,
    // decorative only) and click the real, interactive cover.
    await page.evaluate(`document.querySelector('.aw-item:not([tabindex="-1"])')?.click()`);
    const opened = await page.waitFor(`document.getElementById('bookModal')?.classList.contains('open')`, { timeout: 3000 });
    const urlAfterOpen = await page.evaluate("location.href");
    await page.evaluate(`document.getElementById('bookModalClose')?.click()`);
    const closed = await page.waitFor(`!document.getElementById('bookModal')?.classList.contains('open')`, { timeout: 3000 });
    await page.close();
    if (!opened) throw new Error("modal never gained .open class after clicking a cover");
    if (urlAfterOpen !== urlBefore) throw new Error(`URL changed after opening the popup (${urlBefore} -> ${urlA…13220 tokens truncated….contains('mirror-ready') };
    })()`);
    await page.close();
    if (!early) throw new Error("the back-most layer never got its tiny previews");
    if (r.total && r.tiny !== r.total) throw new Error(`${r.total - r.tiny} of ${r.total} archive images in that layer still use the real file`);
    if (!r.ready) throw new Error("layer built but not visible (mirror-ready missing)");
    return true;
  });

  // ── Zoom (100 -> 180% in 20% steps) in every fullscreen viewer ──
  const ZOOM_STATE = (sel, imgSel) => `(() => { const o = document.querySelector(${JSON.stringify(sel)}); const i = o.querySelector(${JSON.stringify(imgSel)}); const r = i.getBoundingClientRect();
    return { label: o.querySelector('.zoom-label').textContent, w: Math.round(r.width), sw: o.scrollWidth, cw: o.clientWidth, sh: o.scrollHeight, ch: o.clientHeight,
      inDis: o.querySelector('[data-z=in]').disabled, outDis: o.querySelector('[data-z=out]').disabled, lock: document.documentElement.classList.contains('lb-lock') }; })()`;
  const clickZ = (sel, dir) => `document.querySelector(${JSON.stringify(sel)} + ' [data-z=${dir}]').click()`;

  await check("Zoom (artwork page): 100% -> +20% steps up to 180% only, bigger image scrolls the overlay not the page, back to 100%, reset on reopen", async () => {
    const sel = "body > main #lightbox", imgSel = ".lightbox-img";
    const page = await browser.newPage();
    await page.setViewport(1300, 800, false);
    await page.goto(BASE_URL + "/artworks/la2026-o55/");
    await waitForIntroDoorGone(page);
    await page.evaluate(`document.querySelector('body > main .sp-img').click()`);
    await page.waitFor(`document.querySelector(${JSON.stringify(sel)}).classList.contains('active')`, { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 600));
    const s0 = await page.evaluate(ZOOM_STATE(sel, imgSel));
    const labels = [s0.label];
    for (let i = 0; i < 5; i++) { await page.evaluate(clickZ(sel, "in")); labels.push(await page.evaluate(`document.querySelector(${JSON.stringify(sel)} + ' .zoom-label').textContent`)); }
    await new Promise((r) => setTimeout(r, 400));
    const s180 = await page.evaluate(ZOOM_STATE(sel, imgSel));
    await page.evaluate(`(() => { const o = document.querySelector(${JSON.stringify(sel)}); o.scrollTop = 200; o.scrollLeft = 100; })()`);
    const sc = await page.evaluate(`(() => { const o = document.querySelector(${JSON.stringify(sel)}); return { top: o.scrollTop, left: o.scrollLeft, pageY: window.scrollY }; })()`);
    for (let i = 0; i < 5; i++) await page.evaluate(clickZ(sel, "out"));
    const back = await page.evaluate(ZOOM_STATE(sel, imgSel));
    await page.evaluate(clickZ(sel, "in"));
    await page.evaluate(`document.querySelector(${JSON.stringify(sel)}).classList.remove('active')`);
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(`document.querySelector(${JSON.stringify(sel)}).classList.add('active')`);
    await new Promise((r) => setTimeout(r, 300));
    const reopened = await page.evaluate(ZOOM_STATE(sel, imgSel));
    await page.close();
    if (labels.join(",") !== "100%,120%,140%,160%,180%,180%") throw new Error(`zoom steps were ${labels.join(",")}`);
    if (!s180.inDis || !s0.outDis) throw new Error("the + / - buttons aren't disabled at the limits");
    if (s180.w < s0.w * 1.7) throw new Error(`image only grew ${s0.w}px -> ${s180.w}px at 180%`);
    if (!(s180.sh > s180.ch + 20 || s180.sw > s180.cw + 20)) throw new Error("zoomed image doesn't make the overlay scrollable");
    if (!s180.lock) throw new Error("page behind isn't locked (lb-lock) while open");
    if (sc.top < 1 && sc.left < 1) throw new Error("the overlay can't be scrolled when zoomed");
    if (sc.pageY !== 0) throw new Error("the page behind scrolled");
    if (back.label !== "100%") throw new Error(`zooming out ended at ${back.label}`);
    if (reopened.label !== "100%") throw new Error(`reopened at ${reopened.label}, not 100%`);
    return true;
  });

  await check("Zoom (archive item page + home artwork lightboxes): zoom bar present and steps 20%", async () => {
    const page = await browser.newPage();
    await page.setViewport(1300, 800, false);
    await page.goto(BASE_URL + "/");
    await waitForIntroDoorGone(page);
    await page.evaluate(`(() => { const lb = document.getElementById('arwLightbox'); document.getElementById('arwLightboxImg').src = document.querySelector('body > main .aw-img').src; lb.classList.add('active'); })()`);
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(clickZ("#arwLightbox", "in"));
    await page.evaluate(clickZ("#arwLightbox", "in"));
    const home = await page.evaluate(`document.querySelector('#arwLightbox .zoom-label').textContent`);
    await page.goto(BASE_URL + "/archive/");
    const link = await page.evaluate(`Array.from(document.querySelectorAll('body > main a')).map(a => a.getAttribute('href')).find(h => /^\\/archive\\/[^/]+\\/$/.test(h)) || ''`);
    let arch = "(no archive item page)";
    if (link) {
      await page.goto(BASE_URL + link);
      arch = await page.evaluate(`(() => { const lb = document.querySelector('body > #lightbox'); if (!lb) return 'no lightbox'; lb.classList.add('active'); lb.querySelector('[data-z=in]').click(); return lb.querySelector('.zoom-label').textContent; })()`);
    }
    await page.close();
    if (home !== "140%") throw new Error(`home lightbox label was ${home}`);
    if (link && arch !== "120%") throw new Error(`archive lightbox label was ${arch}`);
    return true;
  });

  await check("Zoom + jump-to-page (book fullscreen): 100-180%, scrolls inside, jump goes to the typed page, reopens at 100%", async () => {
    const page = await browser.newPage();
    await page.setViewport(1300, 800, false);
    await page.goto(BASE_URL + "/oeuvre/");
    await waitForIntroDoorGone(page);
    await page.evaluate(`document.querySelector('.aw-item:not([tabindex="-1"])')?.click()`);
    await page.waitFor(`document.getElementById('bookModal')?.classList.contains('open')`, { timeout: 3000 });
    await page.evaluate(`document.querySelector('#bookModal .book-viewport')?.click()`);
    await page.waitFor(`document.getElementById('bookFullscreen')?.classList.contains('active')`, { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 800));
    const state = `(() => { const o = document.getElementById('bookFullscreen'); const v = o.querySelector('.book-viewport').getBoundingClientRect();
      return { label: o.querySelector('.zoom-label').textContent, w: Math.round(Math.max(v.width, v.height)), sw: o.scrollWidth, cw: o.clientWidth, sh: o.scrollHeight, ch: o.clientHeight, ind: o.querySelector('.book-page-indicator').textContent.trim(), max: o.querySelector('.book-jump-input').max }; })()`;
    const s0 = await page.evaluate(state);
    for (let i = 0; i < 6; i++) await page.evaluate(clickZ("#bookFullscreen", "in"));
    await new Promise((r) => setTimeout(r, 700));
    const s180 = await page.evaluate(state);
    await page.evaluate(`(() => { const o = document.getElementById('bookFullscreen'); o.querySelector('.book-jump-input').value = '3'; o.querySelector('.book-jump').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); })()`);
    await new Promise((r) => setTimeout(r, 1200));
    const jumped = await page.evaluate(state);
    await page.evaluate(`document.getElementById('bookFullscreenClose').click()`);
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(`document.querySelector('#bookModal .book-viewport')?.click()`);
    await new Promise((r) => setTimeout(r, 800));
    const reopened = await page.evaluate(state);
    await page.close();
    if (s180.label !== "180%") throw new Error(`label ${s180.label}`);
    if (s180.w < s0.w * 1.6) throw new Error(`book only grew ${s0.w}px -> ${s180.w}px`);
    if (!(s180.sh > s180.ch + 20 || s180.sw > s180.cw + 20)) throw new Error("zoomed book doesn't scroll");
    if (!/\b3\b/.test(jumped.ind)) throw new Error(`jump to 3 left the indicator at "${jumped.ind}" (max ${s0.max})`);
    if (reopened.label !== "100%") throw new Error(`reopened at ${reopened.label}`);
    return true;
  });

  // The zoom bar, the X and the book's page controls must stay put while the zoomed overlay scrolls (all screen types)
  for (const [label, w, h, mobile] of [["desktop", 1300, 800, false], ["phone", 390, 844, true]]) {
    await check(`Fullscreen controls stay pinned while a zoomed viewer scrolls (${label}): X, zoom bar, and book jump/page controls`, async () => {
      const page = await browser.newPage();
      await page.setViewport(w, h, mobile);
      await page.goto(BASE_URL + "/artworks/la2026-o55/");
      await waitForIntroDoorGone(page);
      await page.evaluate(`document.querySelector('body > main .sp-img').click()`);
      await page.waitFor(`document.querySelector('body > main #lightbox').classList.contains('active')`, { timeout: 4000 });
      for (let i = 0; i < 4; i++) await page.evaluate(clickZ("body > main #lightbox", "in"));
      await new Promise((r) => setTimeout(r, 500));
      const pos = `(() => { const o = document.querySelector('body > main #lightbox'); const f = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; };
        return { x: f(o.querySelector('.lightbox-close')), bar: f(o.querySelector('.zoom-bar')), st: o.scrollTop + o.scrollLeft }; })()`;
      const a = await page.evaluate(pos);
      await page.evaluate(`(() => { const o = document.querySelector('body > main #lightbox'); o.scrollTop = 250; o.scrollLeft = 250; })()`);
      await new Promise((r) => setTimeout(r, 200));
      const b = await page.evaluate(pos);
      const inView = await page.evaluate(`(() => { const r = document.querySelector('body > main #lightbox .zoom-bar').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.top >= 0; })()`);
      // book viewer
      await page.goto(BASE_URL + "/oeuvre/");
      await waitForIntroDoorGone(page);
      await page.evaluate(`document.querySelector('.aw-item:not([tabindex="-1"])')?.click()`);
      await page.waitFor(`document.getElementById('bookModal')?.classList.contains('open')`, { timeout: 3000 });
      await page.evaluate(`document.querySelector('#bookModal .book-viewport')?.click()`);
      await page.waitFor(`document.getElementById('bookFullscreen')?.classList.contains('active')`, { timeout: 3000 });
      for (let i = 0; i < 4; i++) await page.evaluate(clickZ("#bookFullscreen", "in"));
      await new Promise((r) => setTimeout(r, 800));
      const bpos = `(() => { const o = document.getElementById('bookFullscreen'); const f = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; };
        return { x: f(o.querySelector('.book-fullscreen-close')), bar: f(o.querySelector('.zoom-bar')), jump: f(o.querySelector('.book-jump')), ctl: f(o.querySelector('.book-fullscreen-controls')), st: o.scrollTop + o.scrollLeft }; })()`;
      const c = await page.evaluate(bpos);
      await page.evaluate(`(() => { const o = document.getElementById('bookFullscreen'); o.scrollTop = 300; o.scrollLeft = 300; })()`);
      await new Promise((r) => setTimeout(r, 200));
      const d = await page.evaluate(bpos);
      const overlap = await page.evaluate(`(() => { const o = document.getElementById('bookFullscreen'); const a = o.querySelector('.zoom-bar').getBoundingClientRect(), b = o.querySelector('.book-fullscreen-controls').getBoundingClientRect(); return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top); })()`);
      await page.close();
      const same = (p, q) => JSON.stringify(p) === JSON.stringify(q);
      if (b.st < 1) throw new Error("test setup: the artwork overlay didn't scroll");
      if (!same(a.x, b.x)) throw new Error(`artwork X moved when scrolling: ${a.x} -> ${b.x}`);
      if (!same(a.bar, b.bar)) throw new Error(`artwork zoom bar moved when scrolling: ${a.bar} -> ${b.bar}`);
      if (!inView) throw new Error("artwork zoom bar isn't fully on screen");
      if (d.st < 1) throw new Error("test setup: the book overlay didn't scroll");
      for (const k of ["x", "bar", "jump", "ctl"]) if (!same(c[k], d[k])) throw new Error(`book ${k} moved when scrolling: ${c[k]} -> ${d[k]}`);
      if (overlap) throw new Error("book page controls and the zoom bar overlap");
      return true;
    });
  }

  // ── Small screens: burger menu + popups lock the page and keep their blur ──
  // Every name in the burger menu fits on the screen and can be tapped (Louis, Nov 1: the items weren't shrunk to allow
  // users to click them), from a small phone's viewport (SE, 320x568) to a tall one.
  for (const [w, h] of [[320, 568], [375, 667], [390, 664], [430, 932]]) {
    await check(`Phone burger menu at ${w}x${h}: all ten names on screen, below the close button, each one tappable`, async () => {
      const page = await browser.newPage();
      await page.setViewport(w, h, true);
      await page.goto(BASE_URL + "/archive/");
      await waitForIntroDoorGone(page);
      await new Promise((r) => setTimeout(r, 800));
      await page.evaluate(`document.getElementById('mobileMenuBtn').click()`);
      await new Promise((r) => setTimeout(r, 900));
      const r = await page.evaluate(`(() => { const btn = document.getElementById('mobileMenuBtn').getBoundingClientRect();
        return { btnBottom: btn.bottom, vh: innerHeight, links: [].map.call(document.querySelectorAll('#mobileMenu a'), (a) => { const q = a.getBoundingClientRect();
          const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
          return { t: a.textContent.trim(), top: q.top, bottom: q.bottom, hit: !!hit && a.contains(hit) }; }) }; })()`);
      await page.close();
      const bad = [];
      if (r.links.length !== 10) bad.push(`${r.links.length} names, not 10`);
      for (const l of r.links) {
        if (l.top < r.btnBottom - 1 || l.bottom > r.vh + 1) bad.push(`${l.t} is off screen or under the button (${Math.round(l.top)}-${Math.round(l.bottom)}px)`);
        else if (!l.hit) bad.push(`${l.t} can't be tapped`);
      }
      if (bad.length) throw new Error(bad.join(" | "));
    });
  }

  await check("Phone burger menu opened after scrolling: header + close (-) button stay in view, page behind is locked, and the - shows", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/archive/");
    await waitForIntroDoorGone(page);
    await new Promise((r) => setTimeout(r, 1000));
    await page.evaluate(`window.scrollTo(0, 500)`);
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(`document.getElementById('mobileMenuBtn').click()`);
    await new Promise((r) => setTimeout(r, 900));
    const r = await page.evaluate(`(() => { const b = document.getElementById('mobileMenuBtn'); const q = b.getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return { open: b.classList.contains('open'), top: Math.round(q.top), hit: !!hit && b.contains(hit), htmlOv: getComputedStyle(document.documentElement).overflowY,
        vAlpha: getComputedStyle(b.querySelector('.bar-v')).opacity }; })()`);
    await page.evaluate(`document.getElementById('mobileMenuBtn').click()`);
    await new Promise((r) => setTimeout(r, 500));
    const after = await page.evaluate(`getComputedStyle(document.documentElement).overflowY`);
    await page.close();
    if (!r.open) throw new Error("menu didn't open");
    if (r.top < 0 || r.top > 60) throw new Error(`the menu button is off screen (top ${r.top}px): the sticky header scrolled away`);
    if (!r.hit) throw new Error("the menu button isn't the top element at its position (covered)");
    if (r.htmlOv !== "hidden") throw new Error(`page behind isn't locked (html overflow ${r.htmlOv})`);
    if (parseFloat(r.vAlpha) > 0.1) throw new Error("the + is still showing (should be a - while open)");
    if (after === "hidden") throw new Error("page stays locked after closing the menu");
    return true;
  });

  await check("Phone popups keep their blur and lock the page behind them (artwork lightbox, home popup)", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/artworks/la2026-o55/");
    await waitForIntroDoorGone(page);
    await page.evaluate(`document.querySelector('body > main .sp-img').click()`);
    await new Promise((r) => setTimeout(r, 700));
    const lb = await page.evaluate(`(() => { const o = document.querySelector('body > main #lightbox'); const c = getComputedStyle(o, '::before');
      return { blur: c.backdropFilter || c.webkitBackdropFilter, ov: getComputedStyle(document.documentElement).overflowY }; })()`);
    await page.goto(BASE_URL + "/");
    await waitForIntroDoorGone(page);
    await page.evaluate(`(() => { const m = document.querySelector('body > main .arw-modal'); m.classList.add('open'); document.body.style.overflow = 'hidden'; })()`);
    await new Promise((r) => setTimeout(r, 500));
    const home = await page.evaluate(`(() => { const c = getComputedStyle(document.querySelector('body > main .arw-modal-bg')); return { blur: c.backdropFilter || c.webkitBackdropFilter, ov: getComputedStyle(document.documentElement).overflowY }; })()`);
    await page.close();
    if (!/blur/.test(lb.blur || "")) throw new Error(`lightbox lost its blur on phones (${lb.blur})`);
    if (lb.ov !== "hidden") throw new Error("page behind the lightbox still scrolls");
    if (!/blur/.test(home.blur || "")) throw new Error(`home popup lost its blur on phones (${home.blur})`);
    if (home.ov !== "hidden") throw new Error("page behind the home popup still scrolls");
    return true;
  });

  for (const [label, w, h, mobile] of [["desktop", 1300, 800, false], ["phone", 390, 844, true]]) {
    await check(`Oeuvre book popup (${label}): page behind is blurred and locked, X matches the artwork pages' X`, async () => {
      const page = await browser.newPage();
      await page.setViewport(w, h, mobile);
      await page.goto(BASE_URL + "/oeuvre/");
      await waitForIntroDoorGone(page);
      await new Promise((r) => setTimeout(r, 800));
      await page.evaluate(`document.querySelector('.aw-item:not([tabindex="-1"])')?.click()`);
      await page.waitFor(`document.getElementById('bookModal')?.classList.contains('open')`, { timeout: 3000 });
      await new Promise((r) => setTimeout(r, 600));
      const r = await page.evaluate(`(() => { const bg = getComputedStyle(document.getElementById('bookModalBg')); const x = getComputedStyle(document.getElementById('bookModalClose'));
        return { blur: bg.backdropFilter || bg.webkitBackdropFilter, ov: getComputedStyle(document.documentElement).overflowY,
          x: [x.position, x.top, x.right, x.fontSize, x.fontWeight, x.textTransform, x.opacity].join('|') }; })()`);
      await page.goto(BASE_URL + "/artworks/la2026-o55/");
      await waitForIntroDoorGone(page);
      const ref = await page.evaluate(`(() => { const x = getComputedStyle(document.querySelector('body > main .lightbox-close')); return [x.position, x.top, x.right, x.fontSize, x.fontWeight, x.textTransform, x.opacity].join('|'); })()`);
      await page.close();
      if (!/blur/.test(r.blur || "")) throw new Error(`the popup's backdrop has no blur (${r.blur})`);
      if (r.ov !== "hidden") throw new Error("the Oeuvre page behind the popup still scrolls");
      if (r.x.split("|").slice(0, 6).join("|") !== ref.split("|").slice(0, 6).join("|")) throw new Error(`popup X (${r.x}) differs from the artwork page X (${ref})`);
      return true;
    });
  }

  // Oct 2026: a popup's fog (its copy inside the blurred background) only got there by accident and was
  // never cleared, so after closing the whole background stayed brighter; then re-copying the whole page on
  // every open/close made the popups' own animations stutter. Now an open popup has its own fog layer
  // (#siteMirrorPopup) that fades in and out with it: fog while open, gone after closing, no page re-copy.
  const POPUP_SEL = ".arw-modal, .sins-popup, .arch-popup, .book-modal, #bookFullscreen, .lightbox-overlay, .ml-popup, .artwork-filter-overlay";
  const IN_COPIES = `document.querySelectorAll(${JSON.stringify(["#siteMirror", "#headerBleed", "#footerBleed", "#headerMirrorEcho", "#footerMirrorEcho"].map(h => POPUP_SEL.split(", ").map(s => h + " " + s).join(", ")).join(", "))}).length`;
  for (const [path, open, close] of [
    ["/photography/", `document.querySelector('body > main .aw-item:not([style*="none"])').click()`, `document.getElementById('photoModalClose').click()`],
    ["/vestments/", `document.querySelector('body > main .aw-item:not([style*="none"])').click()`, `document.getElementById('photoModalClose').click()`],
    ["/production/", `document.querySelector('body > main .aw-item:not([style*="none"])').click()`, `document.getElementById('photoModalClose').click(); window.musicPlayer.stop()`],
    ["/archive/", `document.querySelector('body > main .arch-item').click()`, `document.getElementById('archPopupX').click()`],
  ]) {
    await check(`Popup fog (${path}): rises with the popup, clears after it closes, and never re-copies the page`, async () => {
      const page = await browser.newPage();
      await page.setViewport(1440, 900);
      await page.goto(BASE_URL + path);
      await waitForIntroDoorGone(page);
      await page.waitFor(`(document.getElementById('siteMirrorClone')?.children.length || 0) > 0`, { timeout: 8000 });
      await new Promise((r) => setTimeout(r, 5000)); // let load-time rebuilds settle
      const before = { copies: await page.evaluate(IN_COPIES), builds: await page.evaluate(`window.__mirrorBuilds`) };
      await page.evaluate(open);
      const opened = await page.waitFor(`${IN_COPIES} > 0`, { timeout: 4000 });
      await page.evaluate(close);
      const cleared = await page.waitFor(`${IN_COPIES} === 0`, { timeout: 4000 });
      await new Promise((r) => setTimeout(r, 1500));
      const after = { copies: await page.evaluate(IN_COPIES), builds: await page.evaluate(`window.__mirrorBuilds`) };
      await page.close();
      if (before.copies) throw new Error(`${before.copies} closed popup element(s) in the background copies`);
      if (!opened) throw new Error("the open popup's fog never reached the background");
      if (!cleared || after.copies) throw new Error("the popup's fog stayed in the background after it closed");
      if (after.builds !== before.builds) throw new Error(`opening/closing re-copied the whole page (${before.builds} -> ${after.builds}); that stalls the popup animation`);
      return true;
    });
  }

  // ── Small screens: the full fog stack, built only as far as the device can afford ──
  const FX_CLEAN = `(() => { try { localStorage.removeItem('fx-force'); localStorage.removeItem('fx-demote'); sessionStorage.removeItem('fx-run'); } catch (e) {} })()`;
  const FX_FILLED = `(() => { const f = (id) => (document.getElementById(id)?.children.length || 0) > 0; return {
    level: window.__fxLevel, lite: document.documentElement.classList.contains('fx-lite'),
    clone: f('siteMirrorClone'), core: f('siteMirrorBleedCore'), mid: f('siteMirrorBleed'), dark: f('siteMirrorBleedDark'),
    hdr: !!document.querySelector('#headerBleed .edge-layer > *'), echo: f('headerMirrorEcho'),
    maxWin: Math.max(...['siteMirrorClone','siteMirrorBleedCore','siteMirrorBleed','siteMirrorBleedDark'].map(id => parseFloat(getComputedStyle(document.getElementById(id)).height) || 0)) / innerHeight }; })()`;

  for (const [level, expect] of [[1, { core: true, mid: false, dark: false, lite: true }], [2, { core: true, mid: true, dark: false, lite: true }], [3, { core: true, mid: true, dark: true, lite: false }]]) {
    await check(`Phones: forcing effect level ${level} (?fx=${level}) builds exactly that much of the fog stack, with small render windows`, async () => {
      const page = await browser.newPage();
      await page.setViewport(390, 844, true);
      await page.goto(BASE_URL + `/archive/?fx=${level}`);
      await page.waitFor(`document.getElementById('siteMirrorClone')?.children.length > 0 && window.__mirrorBuilds >= 1`, { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 1500));
      const s = await page.evaluate(FX_FILLED);
      await page.evaluate(FX_CLEAN);
      await page.close();
      const bad = [];
      if (s.level !== level) bad.push(`level is ${s.level}`);
      for (const k of Object.keys(expect)) if (s[k] !== expect[k]) bad.push(`${k} is ${s[k]}, expected ${expect[k]}`);
      if (!s.hdr || !s.echo) bad.push("header fog/echo missing");
      if (s.maxWin > 2.2) bad.push(`a fog layer window is ${s.maxWin.toFixed(1)} viewports tall (must stay small on phones)`);
      if (bad.length) throw new Error(bad.join(" | "));
      return true;
    });
  }

  await check("Phones: automatic level always builds at least the back-most copy + Core, and never more than the device budget allows", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/?fx=auto");
    await page.waitFor(`document.getElementById('siteMirrorClone')?.children.length > 0`, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1200));
    const s = await page.evaluate(FX_FILLED);
    const dpr = await page.evaluate(`window.devicePixelRatio`);
    await page.evaluate(FX_CLEAN);
    await page.close();
    if (!(s.level >= 0 && s.level <= 3)) throw new Error(`level ${s.level}`);
    if (s.level >= 1 && !s.core) throw new Error("level >= 1 but the closest fog layer isn't there");
    if (s.level === 0 && (s.core || s.mid || s.dark)) throw new Error("level 0 but fog layers were built");
    // the budget rule: layers * (w*dpr * 1.9vh*dpr * 8 bytes) <= 140MB
    const mb = 390 * dpr * (1.9 * 844 * dpr) * 8 / 1e6;
    const layers = 1 + (s.core ? 1 : 0) + (s.mid ? 1 : 0) + (s.dark ? 2 : 0);
    if (layers * mb > 140 * 1.05 && s.level > 0) throw new Error(`built ${layers} layers at ~${mb.toFixed(0)}MB each (> 140MB budget)`);
    return true;
  });

  await check("Phones: circuit breaker - a page that died while visible (run flag still set) lowers the effect level on the next load", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/archive/");
    await page.waitFor(`window.__fxLevel !== undefined`, { timeout: 8000 });
    const before = await page.evaluate(`window.__fxLevel`);
    // pretend the browser killed this page while it was visible: the flag ends up still set (our listener runs after the site's)
    await page.evaluate(`(() => { const on = () => sessionStorage.setItem('fx-run', '1'); window.addEventListener('pagehide', on); document.addEventListener('visibilitychange', on); on(); })()`);
    await page.goto(BASE_URL + "/about/");
    await page.waitFor(`window.__fxLevel !== undefined`, { timeout: 8000 });
    const after = await page.evaluate(`({ level: window.__fxLevel, demote: localStorage.getItem('fx-demote') })`);
    // a clean navigation (pagehide fires normally) must NOT lower it further
    await page.goto(BASE_URL + "/archive/");
    await page.waitFor(`window.__fxLevel !== undefined`, { timeout: 8000 });
    const clean = await page.evaluate(`localStorage.getItem('fx-demote')`);
    await page.evaluate(FX_CLEAN);
    await page.close();
    if (after.demote !== "1") throw new Error(`no demotion recorded after an unclean previous load (fx-demote=${after.demote})`);
    if (before > 0 && after.level !== before - 1) throw new Error(`level went ${before} -> ${after.level}, expected ${before - 1}`);
    if (clean !== "1") throw new Error(`a clean navigation changed the demotion (${clean})`);
    return true;
  });

  await check("Desktop is unaffected by the effect levels: always the full stack, no lite class", async () => {
    const page = await browser.newPage();
    await page.setViewport(1300, 800, false);
    await page.goto(BASE_URL + "/?fx=0");   // must be ignored on large screens
    await page.waitFor(`document.getElementById('siteMirrorBleedDark')?.children.length > 0`, { timeout: 10000 });
    const s = await page.evaluate(FX_FILLED);
    await page.evaluate(FX_CLEAN);
    await page.close();
    if (s.level !== 3 || s.lite || !s.core || !s.mid || !s.dark) throw new Error(JSON.stringify(s));
    return true;
  });

  await check("Phones: pinch-zooming the page switches the background stack off (no white blink/reload) and back on at 1x", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/archive/?fx=3");
    await page.waitFor(`document.getElementById('siteMirrorBleedCore')?.children.length > 0`, { timeout: 10000 });
    const shown = `(() => { const m = document.getElementById('siteMirror'); return { zoomed: document.documentElement.classList.contains('fx-zoomed'), display: getComputedStyle(m).display, scale: window.visualViewport ? window.visualViewport.scale : null }; })()`;
    const before = await page.evaluate(shown);
    let scaled = true;
    try { await page.browser.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 }, page.sessionId); } catch (e) { scaled = false; }
    await new Promise((r) => setTimeout(r, 600));
    const zoomed = await page.evaluate(shown);
    try { await page.browser.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 }, page.sessionId); } catch (e) {}
    await new Promise((r) => setTimeout(r, 600));
    const back = await page.evaluate(shown);
    await page.evaluate(FX_CLEAN);
    await page.close();
    if (!scaled || !(zoomed.scale > 1.5)) throw new Error("test setup: couldn't pinch-zoom the emulated page (scale " + zoomed.scale + ")");
    if (before.zoomed || before.display === "none") throw new Error("background off before any zoom");
    if (!zoomed.zoomed || zoomed.display !== "none") throw new Error(`zoomed in but the background is still on (${JSON.stringify(zoomed)})`);
    if (back.zoomed || back.display === "none") throw new Error(`background didn't come back at 1x (${JSON.stringify(back)})`);
    return true;
  });

  await check("Cloud glass: filter bars / dropdowns / boxes are transparent with a feathered ::before (no hard rectangle)", async () => {
    const bad = [];
    for (const [path, sel] of [["/", ".artwork-filter-bar"], ["/oeuvre/", ".artwork-filter-bar"], ["/archive/", ".arch-filters-row"]]) {
      const page = await browser.newPage();
      await page.goto(BASE_URL + path);
      await page.evaluate(`document.documentElement.classList.add('dark')`);
      await new Promise((res) => setTimeout(res, 700));
      const r = await page.evaluate(`(() => {
        const el = document.querySelector('body > main ${sel}');
        if (!el) return null;
        const b = getComputedStyle(el, '::before'), s = getComputedStyle(el);
        return { bg: s.backgroundColor, f: b.backdropFilter, mask: b.maskImage || b.webkitMaskImage, inset: b.top };
      })()`);
      await page.close();
      if (!r) { bad.push(`${path}: ${sel} not found`); continue; }
      if (r.bg !== "rgba(0, 0, 0, 0)") bad.push(`${path}: ${sel} still has its own hard background (${r.bg})`);
      if (!/saturate\(1\.5\)/.test(r.f)) bad.push(`${path}: cloud glass missing (${r.f})`);
      if (!r.mask || r.mask === "none") bad.push(`${path}: no feather mask`);
    }
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });

  await check("Header smudge lines up with the nav links at desktop and tablet widths", async () => {
    const bad = [];
    for (const [w, h, mobile] of [[1440, 900, false], [1024, 800, false]]) {
      const page = await browser.newPage();
      await page.setViewport(w, h, mobile);
      await page.goto(BASE_URL + "/about/");
      const built = await page.waitFor(`document.querySelectorAll('#headerBleed .edge-core nav a').length > 0`, { timeout: 10000 });
      if (!built) { await page.close(); throw new Error("header smudge never built"); }
      const worst = await page.evaluate(`(() => {
        const real = Array.from(document.querySelectorAll('body > header nav a')).map(a => a.getBoundingClientRect().left);
        const copy = Array.from(document.querySelectorAll('#headerBleed .edge-core nav a')).map(a => a.getBoundingClientRect().left);
        let worst = 0;
        for (let i = 0; i < Math.min(real.length, copy.length); i++) worst = Math.max(worst, Math.abs(real[i] - copy[i]));
        return real.length ? worst : 9999;
      })()`);
      await page.close();
      if (worst > 3) bad.push(`${w}px: header smudge ${Math.round(worst)}px off the nav links`);
    }
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });

  await check("Inquiry's three options have a smudge (pinned UI gets its own fog)", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/inquiry/");
    await page.waitFor(`document.getElementById('siteMirrorBleedCore')?.children.length > 0`, { timeout: 10000 });
    await page.evaluate(`document.documentElement.classList.add('dark')`);
    const r = await page.evaluate(`(() => {
      const o = document.querySelectorAll('body > main .inq-door-opt');
      return { n: o.length, shadows: Array.from(o).map(e => getComputedStyle(e).textShadow) };
    })()`);
    await page.close();
    if (r.n < 3) throw new Error(`expected 3 inquiry options, found ${r.n}`);
    if (r.shadows.some((s) => !s || s === "none")) throw new Error(`an option has no fog: ${JSON.stringify(r.shadows)}`);
    return true;
  });

  await check("Bottom of page: the back mirror reaches the bottom on short pages and the footer glow fades in (no hard seam)", async () => {
    const bad = [];
    for (const path of ["/about/", "/inquiry/", "/links/", "/"]) {
      const page = await browser.newPage();
      await page.setViewport(1300, 700, false);
      await page.goto(BASE_URL + path);
      await page.waitFor(`document.querySelector('#siteMirrorClone > div') !== null`, { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 1200));
      const r = await page.evaluate(`(() => {
        const mirror = document.getElementById('siteMirror').getBoundingClientRect().height;
        const clone = document.querySelector('#siteMirrorClone > div').getBoundingClientRect().height;
        const fe = getComputedStyle(document.getElementById('footerMirrorEcho'));
        const fb = getComputedStyle(document.getElementById('footerBleed'));
        return { mirror, clone, feMask: fe.maskImage || fe.webkitMaskImage, fbMask: fb.maskImage || fb.webkitMaskImage };
      })()`);
      await page.close();
      if (r.clone < r.mirror - 2) bad.push(`${path}: mirror copy ${Math.round(r.clone)}px vs page ${Math.round(r.mirror)}px (gap at the bottom)`);
      if (!r.feMask || r.feMask === "none" || !r.fbMask || r.fbMask === "none") bad.push(`${path}: footer glow has no soft top edge`);
    }
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });


  await check("Footer 'Join the List' + logo actually show at the end of the page (tall screens, reduce-motion)", async () => {
    // The fog-in waits for things to rise 3% up the screen before revealing them. The footer is the end
    // of the page and can never rise that far, so on tall windows (and with reduce-motion, which also
    // stripped the button's centring) the real button stayed at opacity 0 for good - only its blurred
    // fog copies showed. End-of-page items now reveal against the whole viewport.
    const bad = [];
    for (const [w, h, motion] of [[1920, 1200, "no-preference"], [2560, 1440, "no-preference"], [1440, 900, "reduce"]]) {
      const page = await browser.newPage();
      await page.setViewport(w, h, false);
      await page.browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: motion }] }, page.sessionId);
      await page.goto(BASE_URL + "/about/");
      await waitForIntroDoorGone(page);
      // Dark mode is what the logo inversion is checked against; an earlier test toggles the theme,
      // and that choice persists in localStorage for the rest of the run.
      await page.evaluate(`localStorage.setItem('theme', 'dark')`);
      await page.goto(BASE_URL + "/about/"); // a repeat visit: the first one holds every reveal for the intro door
      await page.waitFor(`window.__revealReady === true`, { timeout: 6000 });
      await page.evaluate(`document.querySelector('#footerWrap > footer').scrollIntoView({ block: 'end' })`);
      await new Promise((r) => setTimeout(r, 2000));
      const r = await page.evaluate(`(() => {
        const eff = (el) => { let e = 1; for (let n = el; n && n !== document.documentElement; n = n.parentElement) e *= parseFloat(getComputedStyle(n).opacity); return e; };
        const f = document.querySelector('#footerWrap > footer');
        const btn = f.querySelector('.footer-join-newsletter'), logo = f.querySelector('.footer-logo');
        const br = btn.getBoundingClientRect();
        return { btn: eff(btn), logo: eff(logo), invert: /invert/.test(getComputedStyle(logo).filter),
                 off: Math.abs(br.left + br.width / 2 - document.documentElement.clientWidth / 2) };
      })()`);
      await page.close();
      const tag = `${w}x${h}${motion === "reduce" ? " reduce-motion" : ""}`;
      if (r.btn < 0.5) bad.push(`${tag}: 'Join the List' opacity ${r.btn.toFixed(2)}`);
      if (r.logo < 0.5 || !r.invert) bad.push(`${tag}: logo opacity ${r.logo.toFixed(2)}, dark invert ${r.invert}`);
      if (r.off > 3) bad.push(`${tag}: 'Join the List' ${Math.round(r.off)}px off-centre`);
    }
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });


  await check("Fog-in starts fogged: nothing on screen flashes sharp before the fade begins", async () => {
    // The item classes carry a transition, so if their hidden starting state is not committed instantly,
    // everything animates FROM fully visible while the page gate lifts - a sharp flash, then a snap into fog.
    // Reads the homepage picture in the very moment the gate lifts (reveal-pending appears).
    const page = await browser.newPage();
    await page.setViewport(1440, 900, false);
    await page.goto(BASE_URL + "/");
    await waitForIntroDoorGone(page);
    // Samples the picture every few ms from the first moment and records how visible it ever gets while
    // it is tagged but not yet revealed. (The deliberate image-loading fog state is excluded.)
    await page.browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__fogMax = -1; window.__fogDone = false;
      var iv = setInterval(function () {
        var el = document.querySelector('body > main .hp-image'); if (!el) return;
        var c = el.classList;
        var tagged = c.contains('reveal-item') || c.contains('reveal-item-no-filter') || c.contains('reveal-item-no-transform') || c.contains('reveal-item-opacity-only');
        if (tagged && !c.contains('revealed') && !c.contains('reveal-loading')) {
          var e = 1; for (var n = el; n && n !== document.documentElement; n = n.parentElement) e *= parseFloat(getComputedStyle(n).opacity);
          if (e > window.__fogMax) window.__fogMax = e;
        }
        if (c.contains('revealed') || performance.now() > 6000) { window.__fogDone = true; clearInterval(iv); }
      }, 8);` }, page.sessionId);
    await page.goto(BASE_URL + "/");
    await page.waitFor(`window.__fogDone === true`, { timeout: 8000 });
    const start = await page.evaluate(`window.__fogMax`);
    await page.close();
    if (start < 0) throw new Error("homepage picture was never seen in its fogged state");
    if (start > 0.1) throw new Error(`homepage picture showed at ${start.toFixed(2)} opacity before its fade-in began (should start fogged at 0)`);
    return true;
  });

  // Links page (Louis, Oct 2026; layout Nov 3, council #6288): hover shines like the header (no underline, no bold).
  // Andrada alone on the first line; the names in one row under it, the group moved right over the picture; a click sends Andrada down to the
  // empty line under the name, centred (a drift, or a plain fade under reduce motion), both shine, then the page changes.
  for (const motion of ["no-preference", "reduce"]) {
    await check(`Links page (${motion} motion): Andrada over the names' row, both over the picture, header-style hover, and a click brings Andrada under the name, both shine, then it opens`, async () => {
      const page = await browser.newPage();
      await page.browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: motion }] }, page.sessionId);
      await page.goto(BASE_URL + "/links/");
      await page.evaluate(`sessionStorage.setItem('intro-seen','1'); sessionStorage.removeItem('__nsTest'); true`);
      await page.goto(BASE_URL + "/links/");
      await new Promise((r) => setTimeout(r, 2500));
      const mouse = async (type, x, y) => page.browser.send("Input.dispatchMouseEvent",
        { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
      const centre = (sel) => page.evaluate(`(function(){ var b = document.querySelector('body > main ${sel}').getBoundingClientRect(); return [b.right - 6, b.top + b.height / 2]; })()`);
      const rest = await page.evaluate(`(function(){ var m = document.querySelector('body > main .name-stack'); var s = m && m.querySelector('.ns-surname');
        if (!s) return null; var a = s.getBoundingClientRect(), mr = m.getBoundingClientRect();
        var names = [].map.call(m.querySelectorAll('a.ns'), function (n) { var r = n.getBoundingClientRect(); return { text: n.textContent, l: r.left, r: r.right, t: r.top }; });
        var ph = document.querySelector('body > main .links-photo').getBoundingClientRect();
        return { names: names, sc: (a.left + a.right) / 2, sb: a.bottom, pl: ph.left, pc: (ph.left + ph.right) / 2,
          rc: (names[0].l + names[names.length - 1].r) / 2 }; })()`);
      if (!rest) throw new Error("no Andrada in the name stack");
      if (rest.names.map((n) => n.text).join(" ") !== "Louis Han Odi L' Ny Luis") throw new Error(`names read "${rest.names.map((n) => n.text).join(" ")}"`);
      if (rest.names.some((n) => Math.abs(n.t - rest.names[0].t) > 1)) throw new Error("the names aren't on one row");
      if (rest.sb > rest.names[0].t + 1) throw new Error("Andrada isn't on its own line above the names");
      if (Math.abs(rest.sc - rest.rc) > 2) throw new Error(`Andrada isn't centred over the names' row (${Math.round(rest.sc - rest.rc)}px off)`);
      // moved right to balance over the picture (Louis #6313): the row's middle over the picture, from its left edge to its middle
      if (rest.rc < rest.pl - 2 || rest.rc > rest.pc + 2) throw new Error(`the names' row (middle ${Math.round(rest.rc)}px) isn't over the picture (${Math.round(rest.pl)}-${Math.round(rest.pc)}px)`);
      // waits (up to 1.5 s) for the hover's 0.25 s transition to end: a slow headless run can still be mid-fade at 400 ms
      const hoverStyle = async (sel) => { const p = await centre(sel); await mouse("mouseMoved", p[0], p[1]); await new Promise((r) => setTimeout(r, 400));
        for (let i = 0; i < 11 && await page.evaluate(`getComputedStyle(document.querySelector('body > main ${sel}')).opacity !== "1"`); i++) await new Promise((r) => setTimeout(r, 100));
        return page.evaluate(`(function(){ var e = document.querySelector('body > main ${sel}'), cs = getComputedStyle(e), af = getComputedStyle(e, '::after');
          return { deco: cs.textDecorationLine, weight: cs.fontWeight, shadow: cs.textShadow, opacity: cs.opacity, after: af.content + ' ' + af.display }; })()`); };
      for (const sel of [".links-col nav .tw-link", ".name-stack .ns-3", ".name-stack .ns-surname"]) {
        const h = await hoverStyle(sel);
        if (h.deco !== "none") throw new Error(`hovering ${sel} underlines it (${h.deco})`);
        if (!/^none/.test(h.after) && !/none$/.test(h.after)) throw new Error(`hovering ${sel} draws an underline bar (::after ${h.after})`);
        const restWeight = sel.includes("tw-link") ? "400" : "700"; // the name band is bold already
        if (h.weight !== restWeight) throw new Error(`hovering ${sel} changes its weight to ${h.weight} (the header's hover never bolds)`);
        if (h.shadow === "none") throw new Error(`hovering ${sel} doesn't shine like the header (no glow)`);
        if (sel.includes("ns-3") && h.opacity !== "1") throw new Error(`hovering Odi doesn't brighten it (opacity ${h.opacity})`);
      }
      const listWeight = await page.evaluate(`getComputedStyle(document.querySelector('body > main .links-col nav .tw-link')).fontWeight`);
      // record the moment both shine (sessionStorage survives the page change), then click Han for real
      await page.evaluate(`(function(){ var m = document.querySelector('body > main .name-stack'); window.__t0 = performance.now();
        new MutationObserver(function(){ var s = m.querySelector('.ns-surname'), l = m.querySelector('.ns-2');
          if (!s.classList.contains('ns-shine') || !l.classList.contains('ns-shine') || sessionStorage.getItem('__nsTest')) return;
          var a = s.getBoundingClientRect(), b = l.getBoundingClientRect();
          sessionStorage.setItem('__nsTest', JSON.stringify({ dx: (a.left + a.right) / 2 - (b.left + b.right) / 2, dy: a.top - b.bottom, ms: performance.now() - window.__t0 })); })
          .observe(m, { subtree: true, attributes: true, attributeFilter: ['class'] }); return true; })()`);
      const han = await centre(".name-stack .ns-2");
      await mouse("mouseMoved", han[0], han[1]);
      await mouse("mousePressed", han[0], han[1]);
      await mouse("mouseReleased", han[0], han[1]);
      await new Promise((r) => setTimeout(r, 1600));
      const after = await page.evaluate(`({ path: location.pathname, rec: JSON.parse(sessionStorage.getItem('__nsTest') || 'null') })`);
      await page.close();
      if (listWeight !== "400") throw new Error(`list links are weight ${listWeight} at rest`);
      if (!after.rec) throw new Error("Andrada and Han never shone together before the page changed");
      if (Math.abs(after.rec.dx) > 2 || Math.abs(after.rec.dy) > 1.5) throw new Error(`Andrada didn't land centred under Han (dx ${after.rec.dx.toFixed(1)}px, dy ${after.rec.dy.toFixed(1)}px)`);
      if (after.rec.ms < 300) throw new Error(`no visible move: both shone ${Math.round(after.rec.ms)}ms after the click`);
      if (after.path !== "/oeuvre/") throw new Error(`the click didn't open Han's page (now at ${after.path})`);
      return true;
    });
  }

  // Links page on phones (Louis, Oct 2026; Nov 3, #6318): Andrada centred on top; Louis / Han / Odi / L' / Ny / Luis under
  // it in one row of equal columns; an empty line under them where Andrada lands under the clicked name;
  // no "Polymath" / "Toronto based" (removed, Louis Nov 1). The list has no "Portfolio" any more.
  for (const motion of ["no-preference", "reduce"]) {
    await check(`Links page on a phone (${motion} motion): Andrada centred above the names in one row, a click brings Andrada under the name`, async () => {
      const page = await browser.newPage();
      await page.setViewport(390, 844, true);
      await page.browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: motion }] }, page.sessionId);
      await page.goto(BASE_URL + "/links/");
      await page.evaluate(`sessionStorage.setItem('intro-seen','1'); sessionStorage.removeItem('__nsPhone'); true`);
      await page.goto(BASE_URL + "/links/");
      await new Promise((r) => setTimeout(r, 2500));
      const lay = await page.evaluate(`(function(){ var m = document.querySelector('body > main .name-stack'), s = m.querySelector('.ns-surname');
        var names = [].slice.call(m.querySelectorAll('a.ns')).map(function (a) { var r = a.getBoundingClientRect(), pt = parseFloat(getComputedStyle(a).paddingTop) || 0;
          return { text: a.textContent, l: r.left, r: r.right, t: r.top + pt }; });
        var sr = s.getBoundingClientRect(), mr = m.getBoundingClientRect(), band = document.querySelector('body > main .name-band');
        return { names: names, s: { c: (sr.left + sr.right) / 2, t: sr.top, b: sr.bottom, h: sr.height }, mc: (mr.left + mr.right) / 2, bandText: band.textContent,
          list: [].map.call(document.querySelectorAll('body > main .links-col nav .tw-link'), function (a) { return a.textContent; }).slice(0, 9),
          vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }; })()`);
      const bad = [];
      if (lay.names.map((n) => n.text).join(" ") !== "Louis Han Odi L' Ny Luis") bad.push(`names read "${lay.names.map((n) => n.text).join(" ")}"`);
      if (Math.abs(lay.s.c - lay.mc) > 2) bad.push(`Andrada is ${Math.round(lay.s.c - lay.mc)}px off centre`);
      if (lay.names.some((n) => Math.abs(n.t - lay.names[0].t) > 1)) bad.push("the names aren't on one row");
      if (lay.s.b > lay.names[0].t + 1) bad.push("Andrada isn't on its own line above the names");
      const widths = lay.names.map((n) => n.r - n.l);
      if (Math.max(...widths) - Math.min(...widths) > 2) bad.push(`the columns aren't equal (${widths.map(Math.round).join("/")}px)`);
      if (/polymath|toronto based/i.test(lay.bandText)) bad.push("Polymath / Toronto based is still shown");
      if (lay.sw > lay.vw) bad.push(`the page scrolls sideways (${lay.sw}px > ${lay.vw}px)`);
      if (lay.list.join(" ") !== "Artworks Oeuvre Photography Vestments Production Career Inquiry Archive About-me") bad.push(`the list reads "${lay.list.join(" ")}"`);
      if (bad.length) { await page.close(); throw new Error(bad.join(" | ")); }
      // record where Andrada is the moment both shine (sessionStorage survives the page change), then tap Odi
      await page.evaluate(`(function(){ var m = document.querySelector('body > main .name-stack'); window.__t0 = performance.now();
        new MutationObserver(function(){ var s = m.querySelector('.ns-surname'), l = m.querySelector('.ns-3');
          if (!s.classList.contains('ns-shine') || !l.classList.contains('ns-shine') || sessionStorage.getItem('__nsPhone')) return;
          var a = s.getBoundingClientRect(), b = l.getBoundingClientRect(), pt = parseFloat(getComputedStyle(l).paddingTop) || 0;
          sessionStorage.setItem('__nsPhone', JSON.stringify({ dx: (a.left + a.right) / 2 - (b.left + b.right) / 2, dy: a.top - (b.top + pt), h: a.height, ms: performance.now() - window.__t0 })); })
          .observe(m, { subtree: true, attributes: true, attributeFilter: ['class'] }); return true; })()`);
      const odi = lay.names[2];
      const x = (odi.l + odi.r) / 2, y = odi.t + lay.s.h / 2;
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await page.browser.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
      await new Promise((r) => setTimeout(r, 1600));
      const after = await page.evaluate(`({ path: location.pathname, rec: JSON.parse(sessionStorage.getItem('__nsPhone') || 'null') })`);
      await page.close();
      if (!after.rec) throw new Error("Andrada and Odi never shone together before the page changed");
      if (Math.abs(after.rec.dx) > 2 || Math.abs(after.rec.dy - after.rec.h) > 1.5) throw new Error(`Andrada didn't land under Odi (dx ${after.rec.dx.toFixed(1)}px, dy ${after.rec.dy.toFixed(1)}px vs one line ${after.rec.h.toFixed(1)}px)`);
      if (after.rec.ms < 300) throw new Error(`no visible move: both shone ${Math.round(after.rec.ms)}ms after the tap`);
      if (after.path !== "/photography/") throw new Error(`the tap didn't open Odi's page (now at ${after.path})`);
      return true;
    });
  }

  // Andrada itself is a link to andrada.one (this very page): a click moves nothing, it shines, and the page opens again.
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await check(`Links page (${w}px): clicking Andrada only shines it, then andrada.one opens again`, async () => {
      const page = await browser.newPage();
      await page.setViewport(w, h, w < 640);
      await page.goto(BASE_URL + "/links/");
      await page.evaluate(`sessionStorage.setItem('intro-seen','1'); sessionStorage.removeItem('__nsA'); true`);
      await page.goto(BASE_URL + "/links/");
      await new Promise((r) => setTimeout(r, 2500));
      const s = await page.evaluate(`(function(){ var s = document.querySelector('body > main .name-stack .ns-surname'); if (!s) return null;
        var b = s.getBoundingClientRect(); window.__samePage = 1;
        new MutationObserver(function(){ if (!s.classList.contains('ns-shine') || sessionStorage.getItem('__nsA')) return;
          var c = s.getBoundingClientRect(); sessionStorage.setItem('__nsA', JSON.stringify({ dx: c.left - b.left, dy: c.top - b.top })); })
          .observe(s, { attributes: true, attributeFilter: ['class'] });
        return { tag: s.tagName, href: s.getAttribute('href'), x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      if (!s) { await page.close(); throw new Error("no Andrada in the name stack"); }
      if (s.tag !== "A" || !["/links/", "https://andrada.one/"].includes(s.href)) { await page.close(); throw new Error(`Andrada is a <${s.tag}> to "${s.href}", not a link to andrada.one`); }
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await page.browser.send("Input.dispatchMouseEvent", { type, x: s.x, y: s.y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
      await new Promise((r) => setTimeout(r, 1500));
      const after = await page.evaluate(`({ path: location.pathname, reloaded: window.__samePage === undefined, rec: JSON.parse(sessionStorage.getItem('__nsA') || 'null') })`);
      await page.close();
      if (!after.rec) throw new Error("Andrada never shone after the click");
      if (Math.abs(after.rec.dx) > 0.5 || Math.abs(after.rec.dy) > 0.5) throw new Error(`Andrada moved (${after.rec.dx}, ${after.rec.dy}) - it should only shine`);
      if (after.path !== "/links/" || !after.reloaded) throw new Error(`the click didn't open andrada.one again (at ${after.path}, reloaded ${after.reloaded})`);
      return true;
    });
  }

  // Footer (Louis, Oct 2026): the small logo above "Join the List" and the "<name> © 2026 — All Rights Reserved"
  // line both open andrada.one, on every page.
  await check("Footer: the logo and the copyright line open andrada.one (desktop and phone)", async () => {
    const bad = [];
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const sel of [".footer-logo", ".footer-home"]) {
        const page = await browser.newPage();
        await page.setViewport(w, h, w < 640);
        await page.goto(BASE_URL + "/about/");
        await page.evaluate(`sessionStorage.setItem('intro-seen','1'); true`);
        await page.goto(BASE_URL + "/about/");
        await page.evaluate(`document.querySelector('#footerWrap > footer').scrollIntoView({ block: 'end' })`);
        await new Promise((r) => setTimeout(r, 1500));
        const p = await page.evaluate(`(function(){ var el = document.querySelector('#footerWrap > footer ${sel}'); if (!el) return null;
          var b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, hit = document.elementFromPoint(x, y), a = hit && hit.closest('a');
          return { x: x, y: y, href: a ? a.getAttribute('href') : null, text: el.textContent.trim() }; })()`);
        if (!p) { bad.push(`${w}px: no ${sel}`); await page.close(); continue; }
        if (!["/links/", "https://andrada.one/"].includes(p.href)) { bad.push(`${w}px: ${sel} leads to ${p.href}`); await page.close(); continue; }
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
          await page.browser.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, page.sessionId);
        await new Promise((r) => setTimeout(r, 1200));
        const path = await page.evaluate(`location.pathname`);
        await page.close();
        if (path !== "/links/") bad.push(`${w}px: clicking ${sel} landed on ${path}`);
        if (sel === ".footer-home" && !/© \d{4} — All Rights Reserved$/.test(p.text)) bad.push(`${w}px: the copyright link reads "${p.text}"`);
      }
    }
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });

  await check("Fallback font takes the same width as AndradaMono (no reflow when the font arrives)", async () => {
    // Until AndradaMono loads, text draws in the next font of the stack. If that one is narrower
    // (the generic monospace - Consolas on Windows - is 9% narrower), lines re-wrap on the swap:
    // on phones the footer used to drop 20px. Courier New matches AndradaMono's width.
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/about/");
    const r = await page.evaluate(`(async () => {
      await document.fonts.load('40px AndradaMono');
      const stack = getComputedStyle(document.body).fontFamily;
      const fallback = stack.split(',').slice(1).join(',');
      const w = (fam) => { const s = document.createElement('span');
        s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:40px;font-family:' + fam;
        s.textContent = 'Louis Andrada \u00a9 2026 \u2014 All Rights Reserved'; document.body.appendChild(s);
        const x = s.getBoundingClientRect().width; s.remove(); return x; };
      return { stack, andrada: w('AndradaMono'), fallback: w(fallback) };
    })()`);
    await page.close();
    const diff = Math.abs(r.fallback - r.andrada) / r.andrada;
    if (diff > 0.02) throw new Error(`fallback (${r.stack}) is ${(diff * 100).toFixed(1)}% off AndradaMono's width`);
    return true;
  });

  await browser.close();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passes} passed, ${failures} failed`);
  if (failures > 0) {
    console.log(`\nFailed checks:`);
    for (const l of failedLabels) console.log(`  - ${l}`);
    console.log("");
  } else {
    console.log("\nAll checks passed.\n");
  }
  // Intentionally exit 0 even on failure when running under `rev:test`
  // (continuous dev loop) so concurrently doesn't tear down the dev
  // server/watcher over a test failure — `npm run test:live` alone still
  // exits non-zero for CI/scripted use.
  process.exit(ALWAYS_EXIT_0 ? 0 : failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Live test suite crashed:", e);
  process.exit(ALWAYS_EXIT_0 ? 0 : 1);
});

