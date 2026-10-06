// Smoke test for louis-portfolio.
//
// Builds the site fresh with the real production build (same flags as
// `npm run build`) into a throwaway directory, then statically checks the
// generated HTML for regressions. This is deliberately dependency-free
// (no jest/vitest, no headless browser) so it stays cheap to run and has
// no new packages to install/maintain — just Node's built-ins.
//
// Run with: npm test   (or: node tests/smoke-test.mjs)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUILD_DIR = path.join(ROOT, ".smoke-test-build");

let failures = 0;
let passes = 0;

function ok(label) {
  passes++;
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}

function fail(label, detail) {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  if (detail) console.log(`      ${detail}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function readHtml(relPath) {
  const p = path.join(BUILD_DIR, relPath);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

function assert(cond, label, detail) {
  if (cond) ok(label);
  else fail(label, detail);
}

// ── 1. Build ──────────────────────────────────────────────────────────
section("Build");
fs.rmSync(BUILD_DIR, { recursive: true, force: true });
try {
  execFileSync("hugo", ["--gc", "--minify", "--destination", BUILD_DIR], {
    cwd: ROOT,
    stdio: "pipe",
  });
  ok("hugo --gc --minify builds without error");
} catch (e) {
  fail("hugo --gc --minify builds without error", e.stderr?.toString() || e.message);
  console.log("\nBuild failed — skipping remaining checks.");
  process.exit(1);
}

// ── 2. reCAPTCHA gating ──────────────────────────────────────────────
// Only these page types call grecaptcha.execute(); the script should load
// ONLY there, and nowhere else, and with `defer` so it never blocks parse.
section("reCAPTCHA gating (should load only where actually used)");
const RECAPTCHA_SRC = /recaptcha\/api\.js/;
const RECAPTCHA_DEFER = /<script defer src="https:\/\/www\.google\.com\/recaptcha\/api\.js/;

const shouldHaveRecaptcha = {
  "inquiry/index.html": "Inquiry",
  "unsubscribe/index.html": "Unsubscribe",
};
const shouldNotHaveRecaptcha = {
  "index.html": "Home",
  "about/index.html": "About",
  "links/index.html": "Links (contact form removed Oct 2026)",
  "archive/index.html": "Archive",
  "artworks/index.html": "Artworks list",
  "oeuvre/index.html": "Oeuvre list",
  "photography/index.html": "Photography list",
  "docs/index.html": "Docs",
  "privacy/index.html": "Privacy",
  "cv/index.html": "CV redirect",
};

for (const [rel, label] of Object.entries(shouldHaveRecaptcha)) {
  const html = readHtml(rel);
  if (html === null) {
    fail(`${label} page exists (${rel})`, "file not found in build output");
    continue;
  }
  assert(RECAPTCHA_SRC.test(html), `${label} loads reCAPTCHA`);
  assert(RECAPTCHA_DEFER.test(html), `${label}'s reCAPTCHA script has defer`);
}
for (const [rel, label] of Object.entries(shouldNotHaveRecaptcha)) {
  const html = readHtml(rel);
  if (html === null) {
    fail(`${label} page exists (${rel})`, "file not found in build output");
    continue;
  }
  assert(!RECAPTCHA_SRC.test(html), `${label} does NOT load reCAPTCHA (was unused there)`);
}

// Spot-check a handful of individual artwork pages too, since those are
// the page type hit hardest by count (~148 pages).
const artworkDirs = fs.existsSync(path.join(BUILD_DIR, "artworks"))
  ? fs.readdirSync(path.join(BUILD_DIR, "artworks"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("collection-"))
      .slice(0, 5)
  : [];
for (const d of artworkDirs) {
  const html = readHtml(`artworks/${d.name}/index.html`);
  if (html === null) continue;
  assert(!RECAPTCHA_SRC.test(html), `Artwork page "${d.name}" does NOT load reCAPTCHA`);
}

// ── 3. Lazy-loading on the home page's hidden collection view ──────────
// display:none doesn't stop eager image fetch — only loading=lazy does.
// These 10 <img> tags (tree/snake/fruit grids + 3 "full" pieces + the
// combined piece) sit inside #treeCollectionView, hidden by default.
section("Lazy-loading (hidden tree/snake/fruit images shouldn't eager-load)");
{
  const html = readHtml("index.html");
  if (html === null) {
    fail("Home page exists", "index.html not found in build output");
  } else {
    const treeViewMatch = html.match(/<div id=treeCollectionView[\s\S]*?<\/div>\s*<\/div>\s*<section/);
    const totalLazy = (html.match(/loading=lazy/g) || []).length;
    assert(totalLazy > 100, "Home page has a large number of lazy-loaded images (gallery grid intact)", `found ${totalLazy}`);

    // The main gallery grid (.aw-img) already had loading=lazy before this
    // pass — confirm that's still true (regression guard, not a new fix).
    const awImgTags = html.match(/<img[^>]*class=aw-img[^>]*>/g) || [];
    const awImgMissingLazy = awImgTags.filter((t) => !t.includes("loading=lazy"));
    assert(
      awImgTags.length > 0 && awImgMissingLazy.length === 0,
      `All ${awImgTags.length} main gallery thumbnails still have loading=lazy`,
      awImgMissingLazy.length ? `${awImgMissingLazy.length} missing it` : undefined
    );

    // The 10 previously-eager collection-view images should now all have it.
    const objectCoverTags = html.match(/<img[^>]*object-cover[^>]*>/g) || [];
    const hAutoShadowTags = html.match(/<img[^>]*class="?w-full h-auto shadow"?[^>]*>/g) || [];
    const objectCoverMissing = objectCoverTags.filter((t) => !t.includes("loading=lazy"));
    const hAutoMissing = hAutoShadowTags.filter((t) => !t.includes("loading=lazy"));
    assert(
      objectCoverTags.length > 0 && objectCoverMissing.length === 0,
      `All ${objectCoverTags.length} collection "full piece" images have loading=lazy`,
      objectCoverMissing.length ? `${objectCoverMissing.length} missing it` : undefined
    );
    assert(
      hAutoShadowTags.length > 0 && hAutoMissing.length === 0,
      `All ${hAutoShadowTags.length} collection grid images have loading=lazy`,
      hAutoMissing.length ? `${hAutoMissing.length} missing it` : undefined
    );
  }
}

// ── 4. Confirmed-dead files are not referenced anywhere in the build ───
// (True regardless of whether the source files have actually been
// deleted yet — nothing should be pointing at them either way.)
section("No page references files identified as dead weight");
const deadPaths = [
  "/profile.jpg",
  "/logo.png",
  "/profile3.jpeg",
  // "/images/docs/" is live again since Sep 30 2026: the CV and practice PDFs
  // (cleaned of Instagram) are served from the site itself.
  "/images/oeuvre/",
  "AndradaMono.ttf",
  "AndradaMono.sfd",
];
{
  const allHtmlFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html") || entry.name.endsWith(".xml")) allHtmlFiles.push(full);
    }
  })(BUILD_DIR);

  for (const deadPath of deadPaths) {
    const offenders = [];
    for (const file of allHtmlFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(deadPath)) offenders.push(path.relative(BUILD_DIR, file));
    }
    assert(
      offenders.length === 0,
      `Nothing references "${deadPath}"`,
      offenders.length ? `referenced in: ${offenders.slice(0, 3).join(", ")}` : undefined
    );
  }
}

// ── 5. Internal link/asset integrity ────────────────────────────────────
// Every local href/src should resolve to something that actually exists
// in the build output — catches accidental broken links from any edit.
section("Internal links and asset references resolve");
{
  function resolveUrlToFile(url) {
    // Strip query/hash, decode.
    let clean = decodeURIComponent(url.split("#")[0].split("?")[0]);
    if (!clean || clean === "/") clean = "/index.html";
    let full = path.join(BUILD_DIR, clean);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      full = path.join(full, "index.html");
    }
    return full;
  }

  const allHtmlFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) allHtmlFiles.push(full);
    }
  })(BUILD_DIR);

  const attrRegex = /\s(?:href|src)="?([^"'\s>]+)"?/g;
  const broken = new Map(); // url -> [files]
  let checkedCount = 0;

  // Sample: every page for nav-critical files would be slow; instead check
  // ALL files but skip external/non-http(s) URLs and data/blob URIs.
  for (const file of allHtmlFiles) {
    const content = fs.readFileSync(file, "utf-8");
    let m;
    while ((m = attrRegex.exec(content))) {
      const url = m[1];
      if (!url.startsWith("/")) continue; // only same-site absolute paths
      if (url.startsWith("//")) continue; // protocol-relative external
      checkedCount++;
      const target = resolveUrlToFile(url);
      if (!fs.existsSync(target)) {
        const list = broken.get(url) || [];
        list.push(path.relative(BUILD_DIR, file));
        broken.set(url, list);
      }
    }
  }

  assert(checkedCount > 100, `Checked a substantial number of local references`, `${checkedCount} checked`);
  assert(
    broken.size === 0,
    "No broken internal links/asset references found",
    broken.size
      ? [...broken.entries()].slice(0, 8).map(([u, fs_]) => `${u} (in ${fs_[0]}${fs_.length > 1 ? ` +${fs_.length - 1} more` : ""})`).join("; ")
      : undefined
  );
}

// ── 6. Books/Oeuvre section ──────────────────────────────────────────────
// Books are hosted externally (same pattern as artwork/archive images) —
// every asset URL should point at the louis-andrada-images GitHub repo via
// each book's own `imageBase` frontmatter field, never at a local /oeuvre/
// path (there is no static/oeuvre/ folder shipped with this site at all).
section("Books/Oeuvre section");
{
  const grid = readHtml("oeuvre/index.html");
  if (grid === null) {
    fail("Oeuvre grid page exists (oeuvre/index.html)");
  } else {
    assert(/>Han</.test(grid), "Books grid page has its 'Han' heading (the Oeuvre section, shown as Han)");
    assert(grid.includes('id=booksSearchInput'), "Books grid has the search input");
    assert(grid.includes('id=bookFilterToggle'), "Books grid has the filter toggle");
    assert(grid.includes('id=bookModal'), "Books grid includes the popup-viewer modal");
    assert(grid.includes('id=bookModalClose'), "Book popup modal has a close button");
    assert(
      /raw\.githubusercontent\.com\/louis7andrada\/louis-andrada-images/.test(grid),
      "Books grid's cover images point at the external GitHub images repo"
    );
    assert(
      !/src="\/oeuvre\//.test(grid),
      "Books grid never points a cover image at a local /oeuvre/ path"
    );
  }

  const bookDirs = fs.existsSync(path.join(BUILD_DIR, "oeuvre"))
    ? fs.readdirSync(path.join(BUILD_DIR, "oeuvre"), { withFileTypes: true }).filter((d) => d.isDirectory())
    : [];
  assert(bookDirs.length > 0, "At least one book has its own standalone page built");

  for (const d of bookDirs) {
    const html = readHtml(`oeuvre/${d.name}/index.html`);
    if (html === null) {
      fail(`Book page "${d.name}" exists`);
      continue;
    }
    assert(html.includes("class=book-viewport"), `Book "${d.name}" page has the viewer stage`);
    assert(
      /data-image-base=https:\/\/raw\.githubusercontent\.com\/louis7andrada\/louis-andrada-images\/main\/books\//.test(html),
      `Book "${d.name}" viewer reads its images from the GitHub repo (imageBase)`
    );
    assert(html.includes("mountBookViewer"), `Book "${d.name}" page includes the shared viewer engine`);
    assert(html.includes("class=sp-back"), `Book "${d.name}" page has a back link`);
  }
}

// ── 7. Nav: the sections are shown by their owner names (Oct 2026) ───────
// Artworks / Oeuvre / Photography read Louis / Han / Odi in the menus, the
// section titles and the back links. Only the labels: URLs, folders and ids
// keep the section names. The Links page keeps its own list as it was.
section('Nav — sections shown as "Louis", "Han", "Odi"');
{
  const home = readHtml("index.html");
  if (home === null) {
    fail("Home page exists for nav-rename check");
  } else {
    assert(/<h1[^>]*>Louis</.test(home), "Home page's section heading says Louis");
    for (const label of ["Louis", "Han", "Odi"]) assert(new RegExp(`>${label}</a>`).test(home), `Home page's nav has a "${label}" link`);
    for (const label of ["Artworks", "Oeuvre", "Photography"]) assert(!new RegExp(`>${label}</a>`).test(home), `Home page's nav no longer says "${label}"`);
    assert(/href="?https:\/\/han\.andrada\.one\/#oeuvre/.test(home), "Home page's Han link opens han.andrada.one at the grid");
  }

  const artworkDirs = fs.existsSync(path.join(BUILD_DIR, "artworks"))
    ? fs.readdirSync(path.join(BUILD_DIR, "artworks"), { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("collection-"))
        .slice(0, 1)
    : [];
  for (const d of artworkDirs) {
    const html = readHtml(`artworks/${d.name}/index.html`);
    if (html === null) continue;
    assert(html.includes("Back to Louis"), `Artwork page "${d.name}" back-link says "Back to Louis"`);
  }
}

// ── 8. Header logo — page logos (old / ha / odi / andrada) + Jera Ansuz (new) ──
section("Header logos (each face's logo, then Jera Ansuz)");
{
  const home = readHtml("index.html");
  if (home === null) {
    fail("Home page exists for header-logo check");
  } else {
    for (const [src, name] of [["/logoold.png", "old"], ["/lalogo.png", "new"], ["/halogo.png", "ha"], ["/odiandradalogo.png", "odi"], ["/andradalogo.png", "andrada"]]) {
      assert(
        home.includes(`src=${src}`) && home.includes(`data-logo=${name}`),
        `Header logo includes ${src} (data-logo=${name})`
      );
    }
    assert(
      !/\.intro-logo-wrap:hover/.test(home),
      "Intro-door logo has no :hover effect (removed — was confusing alongside the automatic animation)"
    );
  }
}

// ── 9. Regression guard for the earlier "site mirror" background feature ─
section("Site mirror background (regression guard from earlier work)");
{
  const home = readHtml("index.html");
  const about = readHtml("about/index.html");
  for (const [label, html] of [["Home", home], ["About", about]]) {
    if (html === null) {
      fail(`${label} page exists for site-mirror check`);
      continue;
    }
    assert(html.includes('id=siteMirror'), `${label} page has #siteMirror`);
    assert(html.includes('id=siteMirrorClone'), `${label} page has #siteMirrorClone`);
    assert(html.includes('id=headerMirrorEcho'), `${label} page has #headerMirrorEcho`);
    assert(html.includes('id=footerMirrorEcho'), `${label} page has #footerMirrorEcho`);
  }
}

// ── 10. Basic navigation sanity ─────────────────────────────────────────
section("Navigation sanity");
{
  const home = readHtml("index.html");
  if (home) {
    // About/Inquiry/Archive stay relative; the faces and the hub are their own (sub)domains (Oct 2026).
    for (const href of ["/about/", "/inquiry/", "/archive/", "https://andrada.one/", "https://han.andrada.one/#oeuvre", "https://odi.andrada.one/#photography"]) {
      assert(home.includes(`href=${href}`) || home.includes(`href="${href}"`), `Home page links to ${href}`);
    }
  }
}

// ── Cleanup + summary ────────────────────────────────────────────────
fs.rmSync(BUILD_DIR, { recursive: true, force: true });

console.log(`\n${"─".repeat(50)}`);
console.log(`${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.log("\nFAILED\n");
  process.exit(1);
} else {
  console.log("\nAll checks passed.\n");
  process.exit(0);
}
