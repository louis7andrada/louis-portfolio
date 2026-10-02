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
async function check(label, fn) {
  if (ONLY && !label.toLowerCase().includes(ONLY)) return; // quick reruns: --only=text
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
  await check("Dark/light mode toggle works and persists", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    const before = await page.evaluate("document.documentElement.classList.contains('dark')");
    await page.evaluate(`document.getElementById('darkModeToggle')?.click()`);
    await new Promise((r) => setTimeout(r, 300));
    const after = await page.evaluate("document.documentElement.classList.contains('dark')");
    await page.close();
    if (before === after) throw new Error(`theme class didn't change (was ${before}, still ${after}) — toggle button id may have changed`);
    return true;
  });

  await check("Header logo advances through its old/new/ha cycle across navigations", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    // First-run entrance chains two waits before the first advance: the
    // intro door's own new->old->ha sequence (~3.5s) THEN, once it calls
    // startHeaderLogoSequence(), the header's own materialize+hold
    // (900ms + 3200ms) — around 7.6s total. Poll rather than guess it.
    const settled = await page.waitFor(
      `document.getElementById('logoMorphWrap')?.getAttribute('data-active') !== 'old'`,
      { timeout: 15000 } // door ~4s to dissolve + header materialize/hold ~4.1s, plus load time
    );
    const first = await page.evaluate(`document.getElementById('logoMorphWrap')?.getAttribute('data-active')`);
    if (!settled) throw new Error(`logo never advanced off its initial "old" state within 15s (still: "${first}")`);
    await page.goto(BASE_URL + "/about/");
    // Poll: the advance runs a couple of animation frames after load, which
    // can be delayed while the page's background mirror is being built.
    await page.waitFor(
      `document.getElementById('logoMorphWrap')?.getAttribute('data-active') !== ${JSON.stringify(first)}`,
      { timeout: 5000 }
    );
    const second = await page.evaluate(`document.getElementById('logoMorphWrap')?.getAttribute('data-active')`);
    await page.close();
    if (!first || !second) throw new Error(`data-active missing (first=${first}, second=${second})`);
    if (!["old", "new", "ha"].includes(first) || !["old", "new", "ha"].includes(second)) {
      throw new Error(`unexpected data-active value(s): ${first}, ${second}`);
    }
    if (first === second) throw new Error(`logo didn't advance between page loads (stayed on "${first}")`);
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
    if (urlAfterOpen !== urlBefore) throw new Error(`URL changed after opening the popup (${urlBefore} -> ${urlAfterOpen}) — it navigated instead of popping up`);
    if (!closed) throw new Error("modal never lost .open class after clicking close");
    return true;
  });

  // Clicking the book in the popup (or on the standalone page) opens the
  // fullscreen viewer; page turning happens by clicking inside that.
  await check("Book popup: clicking the stage opens fullscreen, where a click turns a page", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/oeuvre/");
    await waitForIntroDoorGone(page);
    await page.evaluate(`document.querySelector('.aw-item:not([tabindex="-1"])')?.click()`);
    await page.waitFor(`document.getElementById('bookModal')?.classList.contains('open')`, { timeout: 3000 });
    await page.evaluate(`document.querySelector('#bookModal .book-viewport')?.click()`);
    const fs = await page.waitFor(`document.getElementById('bookFullscreen')?.classList.contains('active')`, { timeout: 3000 });
    if (!fs) { await page.close(); throw new Error("clicking the popup's book never opened #bookFullscreen"); }
    const before = await page.evaluate(`document.querySelector('#bookFullscreen .book-page-indicator')?.textContent.trim()`);
    await page.evaluate(clickRightHalfOf("#bookFullscreen .book-viewport"));
    const advanced = await page.waitFor(
      `document.querySelector('#bookFullscreen .book-page-indicator')?.textContent.trim() !== ${JSON.stringify(before)}`,
      { timeout: 4000 }
    );
    await page.evaluate(`document.getElementById('bookFullscreenClose')?.click()`);
    const closed = await page.waitFor(`!document.getElementById('bookFullscreen')?.classList.contains('active')`, { timeout: 3000 });
    await page.close();
    if (!advanced) throw new Error(`page indicator never changed after clicking in fullscreen (stayed: "${before}")`);
    if (!closed) throw new Error("fullscreen didn't close via the X button");
    return true;
  });

  await check("Standalone book page: viewer mounts, opens fullscreen, and turns a page", async () => {
    const page = await browser.newPage();
    // Follow whatever the grid's first real book links to, rather than
    // hardcoding a slug that might not exist if the book list changes.
    await page.goto(BASE_URL + "/oeuvre/");
    await waitForIntroDoorGone(page);
    const href = await page.evaluate(`document.querySelector('.aw-item:not([tabindex="-1"])')?.getAttribute('href')`);
    if (!href) throw new Error("no book link found on the Oeuvre grid to follow");
    await page.goto(BASE_URL + href);
    await waitForIntroDoorGone(page);
    // The site-mirror clone deep-clones the *entire* <main> element
    // (tag included, see baseof.html's buildSiteMirror) into a div that
    // sits BEFORE the real <main> in the DOM — so it contains its own
    // nested <main>, and a plain "main .foo" selector matches that inert
    // clone first, not the real interactive one. Only the real <main> is
    // a direct child of <body>, so scoping to "body > main" is required.
    const hasStage = await page.evaluate(`!!document.querySelector('body > main .book-viewport')`);
    if (!hasStage) throw new Error(`${href} has no .book-viewport — standalone page may be broken`);
    await page.evaluate(`document.querySelector('body > main .sp-row .book-viewport')?.click()`);
    const fsOpen = await page.waitFor(`document.getElementById('bookFullscreen')?.classList.contains('active')`, { timeout: 3000 });
    if (!fsOpen) throw new Error("clicking the book never opened #bookFullscreen");
    const before = await page.evaluate(`document.querySelector('#bookFullscreen .book-page-indicator')?.textContent.trim()`);
    await page.evaluate(clickRightHalfOf("#bookFullscreen .book-viewport"));
    const advanced = await page.waitFor(
      `document.querySelector('#bookFullscreen .book-page-indicator')?.textContent.trim() !== ${JSON.stringify(before)}`,
      { timeout: 4000 }
    );
    const errors = page.consoleErrors;
    await page.close();
    if (!advanced) throw new Error(`page indicator never changed after clicking (stayed: "${before}")`);
    if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);
    return true;
  });

  // ── 4. Form submission flows — fully exercised, but stubbed so no real
  //      inquiry, subscriber, or notification is ever created ──────────
  section("Form submissions (network calls stubbed — nothing real is sent)");

  // Every form, end to end, under the production CSP and a stub that behaves like the real Apps
  // Script (302 -> script.googleusercontent.com -> "OK"). These forms are the only way clients reach
  // Louis, so each must prove: the message reached the webhook, the reply was read, the visitor saw
  // success, no error text or alert appeared, and nothing violated the CSP. Forms with a spam check run
  // twice - once with a normal check, once with the check itself failing (the "browser-error" a
  // reCAPTCHA key gives on a domain it isn't registered for): a broken check must never stop a client.
  const ERR = (sel) => `Array.from(document.querySelectorAll('${sel}')).filter(function(e){ return !e.classList.contains('hidden') && e.style.display !== 'none' && e.textContent.trim(); }).map(function(e){ return e.textContent.trim(); })[0] || ''`;
  const FORMS = [
    { name: "Inquiry: purchase", recaptcha: true, path: "/inquiry/",
      before: `localStorage.setItem('selectedArtworks', JSON.stringify(['LA2026-o50']))`,
      fill: `var f = document.querySelector('body > main #purchaseForm');
        var r = f.querySelector('input[name="artworkType"][value="original"]'); if (r) r.click();
        f.querySelector('[name="buyerName"]').value = 'Automated Test';
        f.querySelector('[name="buyerEmail"]').value = 'automated-test@example.invalid';
        f.querySelector('[name="buyerPhone"]').value = '0000000000';
        f.querySelector('[name="buyerCity"]').value = 'Testville';
        f.querySelector('[name="buyerCountry"]').value = 'Testland';`,
      submit: `document.querySelector('body > main #purchaseForm').requestSubmit()`,
      success: `!!document.querySelector('body > main .inq-submit-success')`,
      error: ERR("body > main .inq-error") },
    { name: "Inquiry: commission", recaptcha: true, path: "/inquiry/",
      fill: `var f = document.querySelector('body > main #commissionForm');
        f.querySelector('[name="commissionName"]').value = 'Automated Test';
        f.querySelector('[name="commissionEmail"]').value = 'automated-test@example.invalid';
        f.querySelector('[name="commissionPhone"]').value = '0000000000';
        f.querySelector('[name="commissionCity"]').value = 'Testville';
        f.querySelector('[name="commissionCountry"]').value = 'Testland';
        f.querySelector('[name="commissionSize"]').value = '24x36';
        f.querySelector('[name="commissionBudget"]').value = 'Test budget';
        f.querySelector('input[name="commissionType[]"][value="canvas"]').click();`,
      submit: `document.querySelector('body > main #commissionForm').requestSubmit()`,
      success: `!!document.querySelector('body > main .inq-submit-success')`,
      error: ERR("body > main .inq-error") },
    { name: "Inquiry: contact", recaptcha: true, path: "/inquiry/",
      fill: `var f = document.querySelector('body > main #contactForm');
        f.querySelector('[name="name"]').value = 'Automated Test';
        f.querySelector('[name="email"]').value = 'automated-test@example.invalid';
        f.querySelector('[name="phone"]').value = '0000000000';
        f.querySelector('[name="message"]').value = 'Automated test - please ignore.';`,
      submit: `document.querySelector('body > main #contactForm').requestSubmit()`,
      success: `!document.querySelector('body > main #contactSuccessMessage').classList.contains('hidden')`,
      error: ERR("body > main #contactErrorMessage") },
    { name: "Unsubscribe", recaptcha: true, path: "/unsubscribe/",
      fill: `document.querySelector('body > main #unsubEmail').value = 'automated-test@example.invalid';`,
      submit: `document.querySelector('body > main #unsubBtn').click()`,
      success: `document.querySelector('body > main #unsubSuccess').style.display === 'block'`,
      error: ERR("body > main #unsubNote"),
      // Never reveal whether an address is on the list: "not on it" must look like a removal.
      sameAsSuccess: ["NOT_FOUND"] },
    { name: "Newsletter signup (footer)", recaptcha: false, path: "/",
      fill: `document.getElementById('mlEmail').value = 'automated-test@example.invalid';`,
      submit: `document.getElementById('mlSubmit').click()`,
      success: `document.getElementById('mlNote').classList.contains('success')`,
      error: `document.getElementById('mlNote').classList.contains('error') ? document.getElementById('mlNote').textContent.trim() : ''`,
      // Never reveal whether an address is on the list: "already on it" must look like a signup.
      sameAsSuccess: ["DUPLICATE"] },
  ];
  for (const form of FORMS) {
    const modes = form.recaptcha
      ? [["spam check passes", { success: true, score: 0.9 }], ["spam check itself fails (browser-error)", { success: false, "error-codes": ["browser-error"] }]]
      : [["no spam check", null]];
    for (const reply of form.sameAsSuccess || []) modes.push([`Apps Script replies ${reply} - must look like success`, form.recaptcha ? { success: true, score: 0.9 } : null, reply]);
    for (const [mode, verifyReply, replyBody] of modes) {
      await check(`Form works end to end - ${form.name} (${mode})`, async () => {
        const page = await browser.newPage();
        const { webhookRule, replyRule } = await withSafetyStubs(page, verifyReply || undefined, replyBody || "OK");
        if (form.before) { await page.goto(BASE_URL + "/"); await page.evaluate(form.before); }
        await page.goto(BASE_URL + form.path);
        await new Promise((r) => setTimeout(r, 1500));
        await page.evaluate(`(function(){ ${form.fill} })()`);
        await page.evaluate(`window.__res = { success: false, error: '' };
          window.__resPoll = setInterval(function(){
            try { if (${form.success}) window.__res.success = true; var e = ${form.error}; if (e && !window.__res.error) window.__res.error = e; } catch (x) {}
          }, 40);`);
        await page.evaluate(form.submit);
        await page.waitFor(`window.__res && (window.__res.success || window.__res.error)`, { timeout: 20000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 300));
        const res = await page.evaluate(`window.__res`);
        const problems = [];
        if (webhookRule.hits.length === 0) problems.push("the message never reached the webhook");
        if (replyRule.hits.length === 0) problems.push("Apps Script's reply (script.googleusercontent.com) was never read");
        if (!res || !res.success) problems.push("the visitor never saw the success state");
        if (res && res.error) problems.push(`error shown: "${res.error}"`);
        if (page.dialogs.length) problems.push(`alert shown: "${page.dialogs.join(" | ")}"`);
        const csp = page.cspViolations.filter((t) => !/livereload/i.test(t));
        if (csp.length) problems.push(`CSP blocked: ${csp[0].slice(0, 160)}`);
        await page.close();
        if (problems.length) throw new Error(problems.join("; "));
        return true;
      });
    }
  }

  // ── 5. Regression guard for the site-mirror background feature ───────
  section("Site mirror background (regression guard)");
  await check("Home page: site mirror populates and fades in", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    const populated = await page.waitFor(
      `document.getElementById('siteMirrorClone')?.children.length > 0`,
      { timeout: 8000 }
    );
    const faded = await page.waitFor(
      `getComputedStyle(document.getElementById('siteMirror')).opacity === '1'`,
      { timeout: 3000 }
    );
    await page.close();
    if (!populated) throw new Error("siteMirrorClone never populated");
    if (!faded) throw new Error("siteMirror never reached opacity 1 (fade-in didn't complete)");
    return true;
  });

  await check("Home page: smudge (ink bleed) layers populate and stay aligned with the page after scrolling", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    const populated = await page.waitFor(
      `['siteMirrorBleedCore','siteMirrorBleed','siteMirrorBleedDark'].every(id => document.getElementById(id)?.children.length > 0)`,
      { timeout: 8000 }
    );
    if (!populated) { await page.close(); throw new Error("a smudge layer never populated"); }
    await page.evaluate(`window.scrollTo(0, 3000)`);
    await new Promise((r) => setTimeout(r, 1500));
    const drift = await page.evaluate(`(() => {
      const r = document.querySelector('body > main .aw-item');
      const c = document.querySelector('#siteMirrorBleedCore .aw-item');
      if (!r || !c) return null;
      return Math.abs(r.getBoundingClientRect().top - c.getBoundingClientRect().top);
    })()`);
    await page.close();
    if (drift === null) throw new Error("couldn't find a grid item in both the page and the smudge layer");
    if (drift > 20) throw new Error(`smudge layer drifted ${Math.round(drift)}px from the page after scrolling`);
    return true;
  });

  // ── 6. Background smudge + glass, across pages AND screen sizes ─────────
  // The smudge layers are static copies of the real page, so they only look
  // right if they sit exactly under it. These guard the failure modes hit
  // while building it: id-keyed CSS not applying to the copy (Oeuvre drifted
  // 214px), pinned/fixed elements landing in the wrong place, JS-positioned
  // grids going stale on resize, and the darker/standardized glass.
  section("Background smudge + glass (pages x screen sizes)");
  const SIZES = [
    [390, 844, true, "phone"],
    [820, 1180, true, "tablet"],
    [1440, 900, false, "desktop"],
  ];
  const SMUDGE_PAGES = ["/", "/oeuvre/", "/archive/", "/artworks/la2026-o55/", "/about/"];
  for (const [w, h, mobile, sizeLabel] of SIZES) {
    for (const path of SMUDGE_PAGES) {
      await check(`${path} @ ${sizeLabel} (${w}px): smudge copy lines up with the page, no pinned elements in it, no sideways overflow`, async () => {
        const page = await browser.newPage();
        await page.setViewport(w, h, mobile);
        await page.goto(BASE_URL + path);
        const lite = w <= 800; // phones: one cheap mirror layer only (see "lite mode")
        const built = await page.waitFor(
          lite ? `document.querySelector('#siteMirrorClone .fx-inner') !== null`
               : `document.getElementById('siteMirrorBleedCore')?.children.length > 0`,
          { timeout: 10000 }
        );
        if (!built) { await page.close(); throw new Error("smudge layers never built"); }
        if (lite) {
          const overflow0 = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
          await page.close();
          if (overflow0 > 1) throw new Error(`page overflows the screen sideways by ${overflow0}px`);
          return true;
        }
        // The copy rebuilds ~0.7s after the page's layout settles; poll for it
        // to line up rather than sampling once.
        const measure = `(() => {
          const real = Array.from(document.querySelectorAll('body > main img')).filter(i => i.getBoundingClientRect().width > 0);
          const copy = Array.from(document.querySelectorAll('#siteMirrorBleedCore img'));
          // the copy holds header + main + footer, so match from the end backwards over main's images
          const n = Math.min(real.length, 12);
          let worst = 0;
          const mainImgsInCopy = Array.from(document.querySelectorAll('#siteMirrorBleedCore main img')).filter(i => i.getBoundingClientRect().width > 0);
          for (let i = 0; i < Math.min(n, mainImgsInCopy.length); i++) {
            const a = real[i].getBoundingClientRect(), c = mainImgsInCopy[i].getBoundingClientRect();
            worst = Math.max(worst, Math.abs(a.left - c.left), Math.abs(a.top - (c.top - 3)));
          }
          return { worst, compared: Math.min(n, mainImgsInCopy.length) };
        })()`;
        let m = null;
        const deadline = Date.now() + 9000;
        while (Date.now() < deadline) {
          m = await page.evaluate(measure);
          if (m && m.worst <= 4) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        const pinned = await page.evaluate(`Array.from(document.querySelectorAll('#siteMirrorBleedCore *, #siteMirrorBleed *, #siteMirrorBleedDark *')).filter(n => { const cs = getComputedStyle(n); return (cs.position === 'fixed' || cs.position === 'sticky') && cs.visibility !== 'hidden'; }).length`);
        const overflow = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
        await page.close();
        if (m && m.compared > 0 && m.worst > 4) throw new Error(`smudge copy is ${Math.round(m.worst)}px off the real page (compared ${m.compared} images)`);
        if (pinned > 0) throw new Error(`${pinned} fixed/sticky element(s) visible inside the smudge copies (they'd sit in the wrong place)`);
        if (overflow > 1) throw new Error(`page overflows the screen sideways by ${overflow}px`);
        return true;
      });
    }
  }

  await check("Smudge copy re-aligns after the window is resized (Oeuvre grid re-lays out)", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900, false);
    await page.goto(BASE_URL + "/oeuvre/");
    await page.waitFor(`document.getElementById('siteMirrorBleedCore')?.children.length > 0`, { timeout: 10000 });
    await page.setViewport(820, 1180, true);
    const probe = `(() => {
      const r = document.querySelector('body > main .aw-item');
      const c = document.querySelector('#siteMirrorBleedCore main .aw-item');
      return r && c ? Math.max(Math.abs(r.getBoundingClientRect().left - c.getBoundingClientRect().left), Math.abs(r.getBoundingClientRect().top - (c.getBoundingClientRect().top - 3))) : 9999;
    })()`;
    const ok2 = await page.waitFor(`(${probe}) <= 4`, { timeout: 10000 });
    const worst = await page.evaluate(probe);
    await page.close();
    if (!ok2) throw new Error(`copy still ${Math.round(worst)}px off 10s after a resize`);
    return true;
  });

  await check("Copies never hijack ids: header/logo/menu/theme-toggle ids resolve to the REAL header after the smudge is built", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    const built = await page.waitFor(
      `document.getElementById('siteMirrorBleedCore')?.children.length > 0 && document.querySelectorAll('#headerBleed .edge-layer > *').length > 0`,
      { timeout: 10000 }
    );
    if (!built) { await page.close(); throw new Error("smudge/header layers never built"); }
    const bad = await page.evaluate(`['siteHeader','logoMorphWrap','darkModeToggle','mobileMenuBtn','artworkGallery','arwModal'].filter(id => { const el = document.getElementById(id); return !el || el.closest('#siteMirror, #headerBleed, #footerBleed, #headerMirrorEcho, #footerMirrorEcho'); })`);
    await page.close();
    if (bad.length) throw new Error(`ids resolving to a copy (or missing): ${bad.join(", ")}`);
    return true;
  });

  await check("Header and footer have their own smudge layers; text is dimmed in the wide layers, big-image mirror is dimmed 10%", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    await page.waitFor(`document.querySelectorAll('#footerBleed .edge-layer > *').length === 3`, { timeout: 10000 });
    await page.evaluate(`document.documentElement.classList.add('dark')`);
    const r = await page.evaluate(`(() => {
      const op = (sel) => { const n = document.querySelector(sel); return n ? getComputedStyle(n).opacity : null; };
      const img = document.querySelector('#siteMirrorClone img');
      return {
        headerLayers: document.querySelectorAll('#headerBleed .edge-layer > *').length,
        farText: op('#siteMirrorBleedDark .bleed-text'),
        midText: op('#siteMirrorBleed .bleed-text'),
        coreText: op('#siteMirrorBleedCore .bleed-text'),
        imgFilter: img ? getComputedStyle(img).filter : null,
        hiddenFooterInPage: !!document.querySelector('#siteMirrorBleedCore footer') && getComputedStyle(document.querySelector('#siteMirrorBleedCore footer')).visibility,
      };
    })()`);
    await page.close();
    if (r.headerLayers !== 3) throw new Error(`header smudge layers missing (${r.headerLayers}/3)`);
    if (!(parseFloat(r.farText) < parseFloat(r.midText) && parseFloat(r.midText) < 1 && (r.coreText === "1")))
      throw new Error(`text dimming wrong (core ${r.coreText}, mid ${r.midText}, far ${r.farText})`);
    if (!r.imgFilter || !/brightness\(0\.9\)/.test(r.imgFilter)) throw new Error(`mirror image dim missing: ${r.imgFilter}`);
    if (r.hiddenFooterInPage !== "hidden") throw new Error("footer isn't hidden in the page smudge copies (it'd be smudged twice)");
    return true;
  });

  await check("Dark background is the darkened base (rgb 12,12,12) on every page", async () => {
    const bad = [];
    for (const path of ["/", "/about/", "/archive/", "/oeuvre/", "/inquiry/", "/links/"]) {
      const page = await browser.newPage();
      await page.goto(BASE_URL + path);
      // Force dark (an earlier test may have toggled the saved theme to light).
      await page.evaluate(`document.documentElement.classList.add('dark')`);
      // poll: the colour transition can lag on a busy page
      await page.waitFor(`getComputedStyle(document.body).backgroundColor === 'rgb(12, 12, 12)'`, { timeout: 4000 });
      const dark = true;
      const bg = await page.evaluate(`getComputedStyle(document.body).backgroundColor`);
      await page.close();
      if (dark && bg !== "rgb(12, 12, 12)") bad.push(`${path}: ${bg}`);
    }
    if (bad.length) throw new Error(`unexpected dark background: ${bad.join(", ")}`);
    return true;
  });

  await check("Cloud header: glass (blur 20 + saturate 1.5) sits on a soft-edged ::before, with no straight border or box under the header", async () => {
    const bad = [];
    for (const path of ["/", "/archive/", "/oeuvre/", "/about/"]) {
      const page = await browser.newPage();
      await page.goto(BASE_URL + path);
      await page.evaluate(`document.documentElement.classList.add('dark')`);
      await new Promise((res) => setTimeout(res, 700)); // let the theme colour transition finish
      const r = await page.evaluate(`(() => {
        const h = document.getElementById('siteHeader');
        const b = getComputedStyle(h, '::before'), hs = getComputedStyle(h);
        return { f: b.backdropFilter, mask: b.maskImage || b.webkitMaskImage, bottom: b.bottom, hbg: hs.backgroundColor, border: hs.borderBottomColor };
      })()`);
      await page.close();
      if (!/saturate\(1\.5\)/.test(r.f) || !/blur\(20px\)/.test(r.f)) bad.push(`${path}: glass "${r.f}"`);
      if (!r.mask || r.mask === "none") bad.push(`${path}: no soft-edge mask`);
      if (r.bottom === "auto" || parseFloat(r.bottom) >= 0) bad.push(`${path}: glass doesn't extend below the header (would end on a line)`);
      if (r.hbg !== "rgba(0, 0, 0, 0)") bad.push(`${path}: header itself isn't transparent (${r.hbg})`);
    }
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });

  // ── Performance guards: the smudge must stay cheap on long pages/phones ──
  for (const [w, h, mobile, label] of [[390, 844, true, "phone"], [1440, 900, false, "desktop"]]) {
    await check(`Smudge layers are bounded windows that follow the scroll (${label}) - never one page-tall texture`, async () => {
      const page = await browser.newPage();
      await page.setViewport(w, h, mobile);
      await page.goto(BASE_URL + "/");
      await page.waitFor(`document.querySelector('#siteMirrorClone .fx-inner') !== null`, { timeout: 10000 });
      const bad = [];
      for (const y of [0, 5000, 12000]) {
        await page.evaluate(`window.scrollTo(0, ${y})`);
        await new Promise((r) => setTimeout(r, 900));
        const r = await page.evaluate(`(() => {
          const vh = window.innerHeight, pageH = document.getElementById('siteMirror').offsetHeight;
          return (window.innerWidth <= 800 ? ['siteMirrorClone'] : ['siteMirrorClone','siteMirrorBleedCore','siteMirrorBleed','siteMirrorBleedDark']).map(id => {
            const b = document.getElementById(id).getBoundingClientRect();
            return { id, top: b.top, bottom: b.bottom, height: b.height, vh, pageH };
          });
        })()`);
        for (const l of r) {
          if (l.pageH > l.vh * 5.5 && l.height > l.vh * 4.6) bad.push(`${l.id} is ${Math.round(l.height)}px tall on a ${Math.round(l.pageH)}px page (not windowed)`);
          // 32px tolerance at the top: the layers' intentional gravity shift is 3-28px
          if (l.top > 32 || l.bottom < l.vh - 2) bad.push(`${l.id} doesn't cover the screen at scrollY=${y} (top ${Math.round(l.top)}, bottom ${Math.round(l.bottom)})`);
        }
      }
      await page.close();
      if (bad.length) throw new Error([...new Set(bad)].slice(0, 4).join(" | "));
      return true;
    });
  }

  await check("Copies never force downloads (each copied image is a tiny preview or lazy)", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    await page.waitFor(`document.getElementById('siteMirrorBleedCore')?.children.length > 0`, { timeout: 10000 });
    const r = await page.evaluate(`(() => {
      const c = Array.from(document.querySelectorAll('#siteMirrorBleedCore img'));
      return { total: c.length, eager: c.filter(i => i.loading === 'eager' && !i.src.startsWith('data:')).length, lazy: c.filter(i => i.loading === 'lazy' || i.src.startsWith('data:')).length };
    })()`);
    await page.close();
    if (!r.total) throw new Error("no images in the smudge copy");
    if (r.eager > 0) throw new Error(`${r.eager} copied images are eager (would all download at once)`);
    if (r.lazy < r.total * 0.5) throw new Error(`only ${r.lazy}/${r.total} copied images are lazy or tiny previews`);
    return true;
  });

  await check("No rebuild storm while scrolling, and the page never reloads or jumps to the top during fast scrolling (phone)", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/");
    await page.waitFor(`document.querySelector('#siteMirrorClone .fx-inner') !== null`, { timeout: 10000 });
    await page.evaluate(`window.__marker = 'same-document'; window.__b0 = window.__mirrorBuilds;`);
    let lowest = Infinity;
    // fast bursts, like a flick-scroll while images are still loading
    for (let i = 1; i <= 14; i++) {
      await page.evaluate(`window.scrollTo(0, ${i * 900})`);
      await new Promise((r) => setTimeout(r, 120));
      const y = await page.evaluate(`window.scrollY`);
      if (i > 3 && y < lowest) lowest = y;
    }
    const r = await page.evaluate(`({ marker: window.__marker, y: window.scrollY, builds: window.__mirrorBuilds - window.__b0 })`);
    await page.close();
    if (r.marker !== 'same-document') throw new Error("the page reloaded during fast scrolling");
    if (lowest < 1500) throw new Error(`scroll position jumped back to ${Math.round(lowest)}px during fast scrolling`);
    if (r.builds > 1) throw new Error(`the smudge rebuilt ${r.builds} times while scrolling (should wait until scrolling stops)`);
    return true;
  });

  // ── Oeuvre page: full-screen filter, dark fog islands, white text ────────
  await check("Oeuvre: Filters opens a TRUE full-screen overlay (like Artworks), with no duplicate label, and closes on outside click", async () => {
    const page = await browser.newPage();
    await page.setViewport(1300, 700, false);
    await page.goto(BASE_URL + "/oeuvre/");
    await waitForIntroDoorGone(page);
    await page.evaluate(`document.getElementById('bookFilterToggle').click()`);
    await page.waitFor(`document.getElementById('bookFilterOverlay').classList.contains('open')`, { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 900)); // the overlay's open transition
    const r = await page.evaluate(`(() => {
      const o = document.getElementById('bookFilterOverlay').getBoundingClientRect();
      const sp = document.querySelector('#bookFilterOverlay .filter-spacer');
      return { x: o.left, y: o.top, w: o.width, h: o.height, iw: document.documentElement.clientWidth, ih: window.innerHeight, spacerOpacity: getComputedStyle(sp).opacity, inHeader: !!document.getElementById('bookFilterOverlay').closest('.book-page-header') };
    })()`);
    await page.evaluate(`document.getElementById('bookFilterOverlay').click()`);
    const closed = await page.waitFor(`!document.getElementById('bookFilterOverlay').classList.contains('open')`, { timeout: 3000 });
    await page.close();
    if (r.inHeader) throw new Error("the overlay is still nested inside the transformed header (can't be full screen)");
    if (Math.abs(r.x) > 1 || Math.abs(r.y) > 1 || Math.abs(r.w - r.iw) > 1 || Math.abs(r.h - r.ih) > 1) throw new Error(`overlay is ${Math.round(r.w)}x${Math.round(r.h)} at (${Math.round(r.x)},${Math.round(r.y)}), screen is ${r.iw}x${r.ih}`);
    if (parseFloat(r.spacerOpacity) !== 0) throw new Error(`the overlay's alignment spacer is visible (opacity ${r.spacerOpacity}) - a duplicate "Filters" label`);
    if (!closed) throw new Error("clicking outside didn't close the overlay");
    return true;
  });

  await check("Oeuvre: title cluster + search are dark fog islands (no borders, no square box), Filters text is white", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/oeuvre/");
    await page.evaluate(`document.documentElement.classList.add('dark')`);
    await new Promise((r) => setTimeout(r, 700));
    const r = await page.evaluate(`(() => {
      const q = (s) => document.querySelector('body > main ' + s);
      const inp = getComputedStyle(q('.book-search-input'));
      const tog = getComputedStyle(q('#bookFilterToggle'));
      const wrap = getComputedStyle(q('.book-search-wrap'), '::before');
      const clu = getComputedStyle(q('.book-page-header'), '::before');
      return { inpBorder: inp.borderTopWidth + '/' + inp.borderBottomWidth, inpBg: inp.backgroundColor, togColor: tog.color,
               wrapMask: wrap.maskImage || wrap.webkitMaskImage, cluMask: clu.maskImage || clu.webkitMaskImage, wrapBg: wrap.backgroundColor, cluBg: clu.backgroundColor };
    })()`);
    await page.close();
    const bad = [];
    if (r.inpBorder !== "0px/0px") bad.push(`search input still has a border (${r.inpBorder})`);
    if (r.inpBg !== "rgba(0, 0, 0, 0)") bad.push(`search input has a solid background (${r.inpBg})`);
    if (r.togColor !== "rgb(255, 255, 255)") bad.push(`Filters text isn't white (${r.togColor})`);
    if (!r.wrapMask || r.wrapMask === "none") bad.push("search island has no cloud mask");
    if (!r.cluMask || r.cluMask === "none") bad.push("title cluster island has no cloud mask");
    if (/^rgba?\(\s*2[0-9]{2}/.test(r.cluBg)) bad.push(`cluster fog isn't dark (${r.cluBg})`);
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });

  await check("Every fog box is a cloud island, not a rectangle (Artworks, Archive, Oeuvre)", async () => {
    const bad = [];
    for (const [path, sel] of [["/", ".artwork-filter-bar"], ["/archive/", ".arch-filters-row"], ["/oeuvre/", ".book-page-header"]]) {
      const page = await browser.newPage();
      await page.goto(BASE_URL + path);
      const r = await page.evaluate(`(() => {
        const el = document.querySelector('body > main ${sel}');
        if (!el) return null;
        const b = getComputedStyle(el, '::before');
        return { mask: b.maskImage || b.webkitMaskImage, size: b.maskSize || b.webkitMaskSize };
      })()`);
      await page.close();
      if (!r) { bad.push(`${path}: ${sel} not found`); continue; }
      if (!/svg/.test(r.mask || "")) bad.push(`${path} ${sel}: not using the blob mask (${(r.mask || "").slice(0, 40)})`);
    }
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });

  await check("Back layers load in one by one, bottom to top, on large screens", async () => {
    const page = await browser.newPage();
    await page.setViewport(1440, 900, false);
    await page.goto(BASE_URL + "/");
    await page.waitFor(`document.getElementById('siteMirror').classList.contains('mirror-ready')`, { timeout: 12000 });
    const d = await page.evaluate(`['siteMirrorClone','siteMirrorFrost','siteMirrorBleedDark','siteMirrorBleed','siteMirrorBleedCore'].map(id => parseFloat(getComputedStyle(document.getElementById(id)).transitionDelay))`);
    await page.close();
    for (let i = 1; i < d.length; i++) if (!(d[i] > d[i - 1])) throw new Error(`layers don't load bottom-to-top, delays: ${d.join(", ")}`);
    return true;
  });

  await check("Phones: no sideways drift or shake while scrolling slowly or flinging, no jump to the top, no reload", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/");
    await page.waitFor(`document.querySelector('#siteMirrorClone .fx-inner') !== null`, { timeout: 10000 });
    const cfg = await page.evaluate(`({ ox: getComputedStyle(document.documentElement).overflowX, ob: getComputedStyle(document.documentElement).overscrollBehaviorY, bx: getComputedStyle(document.body).overflowX })`);
    await page.evaluate(`window.__marker = 'same'`);
    const bad = [];
    const probe = `({ sx: window.scrollX, sl: document.documentElement.scrollLeft, bl: Math.round(document.body.getBoundingClientRect().left), y: window.scrollY })`;
    // slow: small steady steps
    for (let y = 0; y <= 2400; y += 120) {
      await page.evaluate(`window.scrollTo(0, ${y})`);
      await new Promise((r) => setTimeout(r, 40));
      const s = await page.evaluate(probe);
      if (s.sx !== 0 || s.sl !== 0 || s.bl !== 0) bad.push(`sideways shift at y=${y}: scrollX ${s.sx}, body left ${s.bl}`);
    }
    // fast: big jumps all the way down and back up
    let lowest = Infinity;
    for (let i = 1; i <= 16; i++) {
      await page.evaluate(`window.scrollTo(0, ${i * 1100})`);
      await new Promise((r) => setTimeout(r, 90));
      const s = await page.evaluate(probe);
      if (s.sx !== 0 || s.sl !== 0 || s.bl !== 0) bad.push(`sideways shift in fling at step ${i}`);
      if (i > 3) lowest = Math.min(lowest, s.y);
    }
    const end = await page.evaluate(`({ marker: window.__marker, y: window.scrollY })`);
    await page.close();
    if (cfg.ox !== "clip" || cfg.bx !== "clip") bad.push(`horizontal overflow isn't clipped (html ${cfg.ox}, body ${cfg.bx})`);
    if (cfg.ob !== "none") bad.push(`overscroll-behavior isn't disabled (${cfg.ob}) - pull-to-refresh can trigger`);
    if (end.marker !== "same") bad.push("the page reloaded during the fling");
    if (lowest < 2000) bad.push(`scroll jumped back up to ${Math.round(lowest)}px during the fling`);
    if (bad.length) throw new Error([...new Set(bad)].slice(0, 4).join(" | "));
    return true;
  });

  await check("Nav menus: no underline on hover anywhere (header + home menu); hover makes the link glow brighter instead", async () => {
    const bad = [];
    for (const path of ["/", "/about/"]) {
      const page = await browser.newPage();
      await page.goto(BASE_URL + path);
      const r = await page.evaluate(`(() => {
        const links = Array.from(document.querySelectorAll('body > header nav a, body > main .hp-nav-link'));
        const afterBars = links.filter(a => { const c = getComputedStyle(a, '::after').content; return c && c !== 'none' && c !== 'normal'; }).length;
        const twUnderline = links.filter(a => a.classList.contains('hover:underline')).length;
        // any :hover rule that sets an underline, or that lacks the glow
        let underlineOnHover = 0, glowRule = false;
        for (const sheet of Array.from(document.styleSheets)) {
          let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
          const walk = (list) => { for (const rule of Array.from(list)) {
            if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; }
            const sel = rule.selectorText || '';
            if (/(^|,|\s)(nav a|\.hp-nav-link)(:hover)/.test(sel) || /:hover/.test(sel) && /(nav a|hp-nav-link)/.test(sel)) {
              if (/underline/.test(rule.style.textDecorationLine + ' ' + rule.style.textDecoration)) underlineOnHover++;
              if (/text-shadow|filter/.test(rule.cssText)) glowRule = true;
            } } };
          walk(rules);
        }
        return { n: links.length, afterBars, twUnderline, underlineOnHover, glowRule };
      })()`);
      await page.close();
      if (!r.n) bad.push(`${path}: no nav links found`);
      if (r.afterBars) bad.push(`${path}: ${r.afterBars} link(s) still draw an ::after underline bar`);
      if (r.twUnderline) bad.push(`${path}: ${r.twUnderline} link(s) still have hover:underline`);
      if (r.underlineOnHover) bad.push(`${path}: a hover rule still underlines`);
      if (!r.glowRule) bad.push(`${path}: no brighter/glow hover rule found`);
    }
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });

  // ── Lite mode (phones): the heavy effects are OFF so a fast scroll can't run the tab out of graphics memory ──
  await check("Phones (effect level 0 = lite mode): only ONE background layer, no fog layers / header-footer fog / echoes, no backdrop blurs, smaller mirror blur", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/?fx=0");
    await page.waitFor(`document.querySelector('#siteMirrorClone .fx-inner') !== null`, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));
    const r = await page.evaluate(`(() => {
      try { localStorage.removeItem('fx-force'); } catch (e) {}
      const shown = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
      const filled = (id) => (document.getElementById(id)?.children.length || 0) > 0;
      const bf = (el, pseudo) => { const c = getComputedStyle(el, pseudo); return c.backdropFilter || c.webkitBackdropFilter || 'none'; };
      return {
        mirror: filled('siteMirrorClone'),
        heavy: ['siteMirrorBleedCore','siteMirrorBleed','siteMirrorBleedDark','headerMirrorEcho','footerMirrorEcho'].filter(id => filled(id)).map(id => id + ' (filled)'),
        headerBackdrop: bf(document.getElementById('siteHeader'), '::before'),
        headerOwnBackdrop: bf(document.getElementById('siteHeader')),
        mirrorFilter: getComputedStyle(document.getElementById('siteMirrorClone')).filter,
        frostBackdrop: bf(document.getElementById('siteMirrorFrost')),
      };
    })()`);
    await page.close();
    const bad = [];
    if (!r.mirror) bad.push("the mirror layer isn't built");
    if (r.heavy.length) bad.push(`heavy layers still active on a phone: ${r.heavy.join(", ")}`);
    if (r.headerBackdrop !== "none" || r.headerOwnBackdrop !== "none" || r.frostBackdrop !== "none") bad.push(`backdrop blurs still on (header ::before ${r.headerBackdrop}, header ${r.headerOwnBackdrop}, frost ${r.frostBackdrop})`);
    const blur = /blur\(([\d.]+)px\)/.exec(r.mirrorFilter || "");
    if (!blur || parseFloat(blur[1]) > 40) bad.push(`mirror blur is too large for a phone (${r.mirrorFilter})`);
    if (bad.length) throw new Error(bad.join(" | "));
    return true;
  });

  await check("Phones: the background pauses during a fast fling (no re-render burst) and returns once scrolling slows", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/");
    await page.waitFor(`document.querySelector('#siteMirrorClone .fx-inner') !== null`, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));
    // a very fast jump, like a hard flick
    await page.evaluate(`window.scrollTo(0, 400)`);
    await new Promise((r) => setTimeout(r, 30));
    await page.evaluate(`window.scrollTo(0, 9000)`);
    const paused = await page.waitFor(`document.getElementById('siteMirror').classList.contains('fx-paused')`, { timeout: 1500 });
    const resumed = await page.waitFor(`!document.getElementById('siteMirror').classList.contains('fx-paused')`, { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    const covers = await page.evaluate(`(() => { const b = document.getElementById('siteMirrorClone').getBoundingClientRect(); return b.top <= 40 && b.bottom >= window.innerHeight - 2; })()`);
    await page.close();
    if (!paused) throw new Error("the background never paused during a fast fling");
    if (!resumed) throw new Error("the background never came back after the fling");
    if (!covers) throw new Error("after the fling the background window doesn't cover the screen (not recentred)");
    return true;
  });

  await check("Phones: address-bar resizes (same width, different height) don't re-render or rebuild anything", async () => {
    const page = await browser.newPage();
    await page.setViewport(390, 844, true);
    await page.goto(BASE_URL + "/");
    await page.waitFor(`document.querySelector('#siteMirrorClone .fx-inner') !== null`, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(`window.__b0 = window.__mirrorBuilds; window.__wy0 = document.getElementById('siteMirror').style.getPropertyValue('--wy');`);
    for (const hh of [760, 844, 780, 844]) { await page.setViewport(390, hh, true); await new Promise((r) => setTimeout(r, 250)); }
    await new Promise((r) => setTimeout(r, 1800));
    const r = await page.evaluate(`({ builds: window.__mirrorBuilds - window.__b0, wy: document.getElementById('siteMirror').style.getPropertyValue('--wy') === window.__wy0 })`);
    await page.close();
    if (r.builds !== 0) throw new Error(`the background rebuilt ${r.builds} time(s) on height-only resizes`);
    if (!r.wy) throw new Error("the background window moved on height-only resizes");
    return true;
  });

  // ── Page fog-in: every page, every load ────────────────────────────────
  // (the harness opens each tab with no saved session, so a fresh tab = a "first visit" with the door;
  //  a second navigation in the same tab is a normal browsing page)
  const IN_VIEW_HIDDEN = `(() => Array.from(document.querySelectorAll('.reveal-item, .reveal-item-no-filter, .reveal-item-no-transform, .reveal-item-opacity-only'))
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top < window.innerHeight * 0.9 && r.bottom > 0; }).length)()`;

  await check("Fog-in on a normal page load: items are tagged, everything on screen comes out of the fog, nothing stays hidden, no leftover classes on screen", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/about/");
    await waitForIntroDoorGone(page);
    await page.goto(BASE_URL + "/archive/"); // same tab, intro already seen -> a browsing page load
    const tagged = await page.waitFor(`window.__revealStats && window.__revealStats.tagged > 20`, { timeout: 6000 });
    if (!tagged) { await page.close(); throw new Error("the reveal never tagged the page's content (window.__revealStats missing/low)"); }
    const gate = await page.evaluate(`document.documentElement.classList.contains('reveal-boot')`);
    const settled = await page.waitFor(`${IN_VIEW_HIDDEN} === 0`, { timeout: 9000 });
    const left = await page.evaluate(IN_VIEW_HIDDEN);
    const hdr = await page.evaluate(`document.querySelectorAll('#siteHeader .reveal-item, #siteHeader .reveal-item-no-filter, #siteHeader .reveal-item-no-transform, #siteHeader .reveal-item-opacity-only').length`);
    await page.close();
    if (gate) throw new Error("the pre-paint gate (reveal-boot) was never lifted");
    if (!settled) throw new Error(`${left} on-screen item(s) never came out of the fog`);
    if (hdr) throw new Error("the header was fogged on a normal page change (it should stay steady)");
    return true;
  });

  await check("Fog-in on first visit waits for the door, then reveals", async () => {
    const page = await browser.newPage();
    // the door remembers you via a session cookie + sessionStorage, shared with earlier tests: forget it
    await page.goto(BASE_URL + "/about/");
    await page.evaluate(`sessionStorage.removeItem('intro-seen'); document.cookie = 'intro-seen=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';`);
    await page.goto(BASE_URL + "/about/");
    await page.waitFor(`window.__revealStats && window.__revealStats.tagged > 5`, { timeout: 6000 });
    await new Promise((r) => setTimeout(r, 700));
    const early = await page.evaluate(`({ revealed: window.__revealStats.revealed, first: document.documentElement.classList.contains('reveal-first'), doorUp: getComputedStyle(document.getElementById('intro-door')).display !== 'none' })`);
    await waitForIntroDoorGone(page, 14000);
    const after = await page.waitFor(`window.__revealStats.revealed > 0`, { timeout: 6000 });
    await page.close();
    if (!early.first) throw new Error("first-visit mode (slower fog) isn't active");
    if (early.doorUp && early.revealed > 0) throw new Error(`${early.revealed} item(s) revealed while the door was still up`);
    if (!after) throw new Error("nothing revealed after the door went away");
    return true;
  });

  await check("Fog-in on scroll: below-the-fold items wait, then fog in when scrolled to", async () => {
    const page = await browser.newPage();
    await page.setViewport(1300, 700, false);
    await page.goto(BASE_URL + "/about/");
    await waitForIntroDoorGone(page);
    await page.goto(BASE_URL + "/archive/");
    await page.waitFor(`window.__revealStats && window.__revealStats.tagged > 20`, { timeout: 6000 });
    await page.waitFor(`${IN_VIEW_HIDDEN} === 0`, { timeout: 9000 });
    const waiting = await page.evaluate(`document.querySelectorAll('.reveal-item, .reveal-item-no-filter, .reveal-item-no-transform, .reveal-item-opacity-only').length`);
    await page.evaluate(`window.scrollTo(0, 1600)`);
    const done = await page.waitFor(`${IN_VIEW_HIDDEN} === 0`, { timeout: 9000 });
    const left = await page.evaluate(IN_VIEW_HIDDEN);
    await page.close();
    if (waiting < 1) throw new Error("expected some below-the-fold items to still be waiting");
    if (!done) throw new Error(`${left} item(s) scrolled into view never came out of the fog`);
    return true;
  });

  await check("Fog-in reveals to each element's OWN opacity (captions stay dim; nothing jumps when the classes are removed)", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/about/");
    await waitForIntroDoorGone(page);
    await page.goto(BASE_URL + "/artworks/la2026-o55/");
    await page.waitFor(`window.__revealStats && window.__revealStats.tagged > 5`, { timeout: 6000 });
    await page.waitFor(`${IN_VIEW_HIDDEN} === 0`, { timeout: 9000 });
    await new Promise((r) => setTimeout(r, 1500)); // let the cleanup finish
    const o = await page.evaluate(`(() => { const e = document.querySelector('body > main .sp-info-top p'); return e ? parseFloat(getComputedStyle(e).opacity) : null; })()`);
    await page.close();
    if (o === null) throw new Error("caption element not found");
    if (o > 0.7) throw new Error(`caption opacity is ${o}; it should keep its own dim value (~0.62)`);
    return true;
  });

  await check("Images show a foggy LOADING state (CSS rule exists) and the fog-in CSS has the fast/first/phone variants", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/");
    const r = await page.evaluate(`(() => {
      let loadingRule = false, phoneRule = false;
      const walk = (list, inPhone) => { for (const rule of Array.from(list)) {
        if (rule.media && /max-width:\\s*800px/.test(rule.media.mediaText)) { walk(rule.cssRules, true); continue; }
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules, inPhone); continue; }
        const sel = rule.selectorText || '';
        if (/reveal-loading/.test(sel)) { loadingRule = true; if (inPhone) phoneRule = true; }
      } };
      for (const s of Array.from(document.styleSheets)) { try { walk(s.cssRules, false); } catch (e) {} }
      const d = getComputedStyle(document.documentElement).getPropertyValue('--fog-d').trim();
      return { loadingRule, phoneRule, d };
    })()`);
    await page.close();
    if (!r.loadingRule) throw new Error("no .reveal-loading (foggy loading) CSS rule");
    if (!r.phoneRule) throw new Error("no lighter phone variant for the loading state");
    if (!/^0?\.(9|55)s$/.test(r.d)) throw new Error(`unexpected fog duration ${r.d}`);
    return true;
  });

  // ── Image sizes known up front: grids must not move when images finish loading ──
  for (const path of ["/", "/archive/", "/oeuvre/"]) {
    await check(`Grid items stay put while images load (${path}): declared sizes on every image, no position change after load`, async () => {
      const page = await browser.newPage();
      await page.goto(BASE_URL + path);
      await page.waitFor(`document.querySelectorAll('body > main .aw-item, body > main .arch-item').length > 3`, { timeout: 8000 });
      const snap = `(() => Array.from(document.querySelectorAll('body > main .aw-item, body > main .arch-item')).slice(0, 40).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]; }))()`;
      const missing = await page.evaluate(`Array.from(document.querySelectorAll('body > main .aw-img, body > main .arch-img')).filter(i => !(i.getAttribute('width') > 0 && i.getAttribute('height') > 0)).length`);
      const before = await page.evaluate(snap);
      await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
      await new Promise((r) => setTimeout(r, 3500));
      await page.evaluate(`window.scrollTo(0, 0)`);
      await new Promise((r) => setTimeout(r, 500));
      const after = await page.evaluate(snap);
      await page.close();
      if (missing) throw new Error(`${missing} grid image(s) have no width/height (run python scripts/image-dims.py)`);
      const movedIdx = before.map((b, i) => i).filter((i) => after[i] && (Math.abs(before[i][0] - after[i][0]) > 1 || Math.abs(before[i][1] - after[i][1]) > 1 || Math.abs(before[i][3] - after[i][3]) > 1));
      if (movedIdx.length) throw new Error(`${movedIdx.length} item(s) moved after their images loaded, e.g. #${movedIdx[0]}: ${before[movedIdx[0]]} -> ${after[movedIdx[0]]}`);
      return true;
    });
  }

  await check("Back-most fog layer is up early and paints tiny previews (no image downloads of its own)", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL + "/archive/");
    const early = await page.waitFor(`(() => { const c = document.getElementById('siteMirrorClone'); return !!c && c.querySelectorAll('img[src^="data:"]').length > 5; })()`, { timeout: 8000 });
    await page.waitFor(`document.getElementById('siteMirror').classList.contains('mirror-ready')`, { timeout: 4000 });
    const r = await page.evaluate(`(() => {
      const imgs = Array.from(document.querySelectorAll('#siteMirrorClone .arch-img'));
      return { total: imgs.length, tiny: imgs.filter(i => i.src.startsWith('data:')).length, ready: document.getElementById('siteMirror').classList.contains('mirror-ready') };
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

  // Oct 2026: opening a photo popup loaded its picture, that load re-copied the whole page into the
  // blurred background WITH the open popup's frosted backdrop in it, and after closing the background
  // stayed visibly brighter. Popups must never be in the copies, and must not trigger a re-copy.
  const POPUP_SEL = ".arw-modal, .sins-popup, .arch-popup, .book-modal, #bookFullscreen, .lightbox-overlay, .ml-popup, .artwork-filter-overlay";
  for (const [path, open, close] of [
    ["/photography/", `document.querySelector('body > main .aw-item:not([style*="none"])').click()`, `document.getElementById('photoModalClose').click()`],
    ["/archive/", `document.querySelector('body > main .arch-item').click()`, `document.getElementById('archPopupX').click()`],
  ]) {
    await check(`Background unchanged after a popup opens and closes (${path}): no popup in the copies, no re-copy`, async () => {
      const page = await browser.newPage();
      await page.setViewport(1440, 900);
      await page.goto(BASE_URL + path);
      await waitForIntroDoorGone(page);
      await page.waitFor(`(document.getElementById('siteMirrorClone')?.children.length || 0) > 0`, { timeout: 8000 });
      await new Promise((r) => setTimeout(r, 5000)); // let load-time rebuilds settle
      const before = await page.evaluate(`window.__mirrorBuilds`);
      await page.evaluate(open);
      await new Promise((r) => setTimeout(r, 2500)); // the popup's picture loads
      await page.evaluate(close);
      await new Promise((r) => setTimeout(r, 3500)); // a triggered rebuild would land within this
      const r = await page.evaluate(`({ builds: window.__mirrorBuilds,
        inCopies: document.querySelectorAll(['#siteMirror', '#headerBleed', '#footerBleed', '#headerMirrorEcho', '#footerMirrorEcho'].map(h => ${JSON.stringify(POPUP_SEL)}.split(', ').map(s => h + ' ' + s).join(', ')).join(', ')).length })`);
      await page.close();
      if (r.inCopies) throw new Error(`${r.inCopies} popup element(s) inside the background copies`);
      if (r.builds !== before) throw new Error(`opening/closing the popup re-copied the page into the background (${before} -> ${r.builds} builds)`);
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
