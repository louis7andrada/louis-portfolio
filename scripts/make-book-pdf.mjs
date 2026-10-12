// Lays out a book written in Markdown as a PDF in the Oeuvre books' style (as Cairn.pdf):
// 6 x 9 in, black pages, AndradaMono; a title page with the two marks; a running header
// "<Title> - <Subtitle>"; a footer "Han’drada ... pg. N"; each telling on a new page.
// The PDF then goes through the usual steps (CLAUDE.md, "Adding a new book").
//
//   node scripts/make-book-pdf.mjs <book.md> "book-sources/<Title>.pdf" [--author "Han’drada"]
//
// The Markdown:
//   # Title / **Subtitle** / plain lines = the title page's credit lines ("by …" lines and *italic*
//   notes before the first --- are left out: they are notes for the writers, not the reader).
//   --- separates sections. A section with "## I · Name" headings holds tellings, each on a new
//   page. Any other section is a page of its own: before the tellings it opens lower on the page
//   (the author's page, an epigraph); after them it opens with "·  ·  ·" (an afterword, sources).
//   "> " lines are an epigraph (centred, grey); one under the title gets its own page.
//   A paragraph that is all *italic* is grey italic.
//   "*[...]*" lines are placeholders and are left out.
// Uses the test suite's headless Chrome (tests/lib/browser.mjs).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Browser } from "../tests/lib/browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const AUTHOR = opt("--author", "Han’drada");
const [src, out] = args;
if (!src || !out) { console.error('usage: node scripts/make-book-pdf.mjs <book.md> <out.pdf> [--author "Han’drada"]'); process.exit(1); }

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
const allItalic = (s) => /^\*(?!\*)[^*]+\*$/.test(s);

// ---- parse ----
const md = fs.readFileSync(src, "utf-8").replace(/\r\n/g, "\n");
const sections = md.split(/\n-{3,}\n/);
const front = sections.shift().split("\n").map((l) => l.trim()).filter(Boolean);
const title = (front.find((l) => l.startsWith("# ")) || "# Untitled").slice(2).trim();
const subtitle = ((front.find((l) => /^\*\*.+\*\*$/.test(l)) || "").replace(/^\*\*|\*\*$/g, "")).trim();
const credits = front.filter((l) => !l.startsWith("#") && !l.startsWith(">") && !/^\*/.test(l) && !/^by /i.test(l));
// an epigraph under the title gets a page of its own, after the title page
const frontQuote = front.filter((l) => l.startsWith(">")).join("\n");
if (frontQuote) sections.unshift(frontQuote);

const paragraphs = (text) => text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^\*\[.*\]\*$/s.test(p));
function block(p, first) {
  if (p.startsWith(">")) {
    const lines = p.split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean);
    return `<div class="epigraph">${lines.map((l) => `<p>${inline(l)}</p>`).join("")}</div>`;
  }
  const flat = p.replace(/\s*\n\s*/g, " ");
  if (allItalic(flat)) return `<p class="note">${inline(flat.slice(1, -1))}</p>`;
  return `<p${first ? ' class="first"' : ""}>${inline(flat)}</p>`;
}

let html = "", seenTellings = false;
for (const sec of sections) {
  const parts = sec.split(/^## /m);
  const lead = parts.shift();
  if (parts.length) {
    seenTellings = true;
    for (const part of parts) {
      const [head, ...rest] = part.split("\n");
      const m = head.match(/^\s*([IVXLC]+)\s*[·.:-]\s*(.+)$/);
      html += `<section class="telling"><div class="num">${esc(m ? m[1] : "")}</div><h2>${inline(m ? m[2] : head)}</h2><div class="dots">·&nbsp;&nbsp;·&nbsp;&nbsp;·</div>`;
      paragraphs(rest.join("\n")).forEach((p, i) => { html += block(p, i === 0); });
      html += `</section>`;
    }
    if (lead.trim()) console.warn("text before the first ## in a section was left out:", lead.trim().slice(0, 60));
  } else {
    const ps = paragraphs(lead);
    if (!ps.length) continue;
    html += `<section class="${seenTellings ? "after" : "before"}">${seenTellings ? '<div class="dots">·&nbsp;&nbsp;·&nbsp;&nbsp;·</div>' : ""}`;
    ps.forEach((p, i) => { html += block(p, i === 0); });
    html += `</section>`;
  }
}

// ---- lay out ----
const fontUrl = pathToFileURL(path.join(ROOT, "static/fonts/AndradaMono.woff2")).href;
const markUrl = pathToFileURL(path.join(ROOT, "static/lalogoinvert.png")).href;
const signUrl = pathToFileURL(path.join(ROOT, "static/halogoinvert.png")).href;
const GREY = "#9e9e9e";
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: AndradaMono; src: url(${fontUrl}) format("woff2"); }
/* top and bottom margins hold the header and footer (painted black there); the side margins are padding,
   since Chrome leaves page margins white */
@page { size: 6in 9in; margin: 66pt 0 56pt 0; }
html, body { margin: 0; background: #000; color: #fff; font-family: AndradaMono, "Courier New", monospace; }
body { padding: 0 53pt 0 58pt; font-size: 7pt; line-height: 10.95pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { height: calc(9in - 123pt); break-after: page; text-align: center; }
.cover h1 { font-size: 22pt; font-weight: 400; line-height: 29pt; margin: 0; padding-top: 186pt; }
.cover .sub { color: ${GREY}; font-style: italic; font-size: 9pt; line-height: 10pt; margin-top: 9pt; }
.cover .mark { display: block; height: 22pt; margin: 25pt auto 0; }
.cover .sign { display: block; width: 56pt; margin: 54pt auto 0; }
section { break-before: page; }
section.telling, section.after { padding-top: 63pt; }
section.before { padding-top: 98pt; font-size: 8pt; line-height: 13.5pt; }
.num { text-align: center; color: ${GREY}; font-style: italic; font-size: 9pt; line-height: 12pt; }
h2 { text-align: center; font-size: 12pt; line-height: 16pt; margin: 6pt 0 0; font-weight: 700; }
.dots { text-align: center; color: ${GREY}; line-height: 10pt; margin: 4pt 0 21pt; white-space: pre; }
section.after .dots { margin: 0 0 22pt; }
p { margin: 0; text-align: justify; text-indent: 16pt; orphans: 2; widows: 2; }
p.first, section.before p { text-indent: 0; }
section.before p + p { margin-top: 13.5pt; }
p.note { color: ${GREY}; font-style: italic; text-indent: 0; }
.epigraph { margin: 10pt 0; text-align: center; color: ${GREY}; font-size: 7pt; line-height: 8pt; }
.epigraph p { text-align: center; text-indent: 0; margin: 0; }
</style></head><body>
<div class="cover"><h1>${inline(title)}</h1><div class="sub">${[subtitle, ...credits].map(inline).join("<br>")}</div>
<img class="mark" src="${markUrl}" alt=""><img class="sign" src="${signUrl}" alt=""></div>
${html}
</body></html>`;

// Header and footer: printed separately as a transparent overlay, one page per book page (Chrome's
// own header/footer templates can't use the font), then laid over the body with pymupdf, which also
// paints the top and bottom margins black (Chrome leaves page margins white). The title page has neither.
const stampPage = (n) => n === 1 ? `<div class="pg"></div>` : `<div class="pg">
  <div class="t" style="right: 55.9pt; top: 34.4pt;">${inline(title)} - <span class="g">${inline(subtitle)}</span></div>
  <div class="t" style="right: 57.5pt; top: 610.3pt; white-space: pre;">${esc(AUTHOR)}${" ".repeat(59)}pg. ${n}</div></div>`; // one line, as Cairn.pdf (extract-book-text.py drops it)
const stamps = (count) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: AndradaMono; src: url(${fontUrl}) format("woff2"); }
@page { size: 6in 9in; margin: 0; }
html, body { margin: 0; background: transparent; }
.pg { position: relative; height: 9in; break-after: page; }
.t { position: absolute; font-family: AndradaMono, "Courier New", monospace; font-size: 7pt; line-height: 9.2pt; color: #fff; white-space: nowrap; }
.g { color: ${GREY}; font-style: italic; }
</style></head><body>${Array.from({ length: count }, (_, i) => stampPage(i + 1)).join("")}</body></html>`;

const { execFileSync } = await import("node:child_process");
const python = (code, ...argv) => execFileSync("python", ["-I", "-c", code, ...argv], { encoding: "utf-8" });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "book-pdf-"));
const browser = await Browser.launch({ headless: true });
try {
  const tab = await browser.newPage();
  const printHtml = async (name, doc, background) => {
    const file = path.join(tmp, name + ".html");
    fs.writeFileSync(file, doc);
    await tab.goto(pathToFileURL(file).href);
    await tab.evaluate(`document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {})))).then(() => true)`);
    const r = await tab.browser.send("Page.printToPDF", { printBackground: background, preferCSSPageSize: true }, tab.sessionId);
    fs.writeFileSync(path.join(tmp, name + ".pdf"), Buffer.from(r.data, "base64"));
  };
  await printHtml("body", page, true);
  const count = Number(python(`import pymupdf, sys; print(len(pymupdf.open(sys.argv[1])))`, path.join(tmp, "body.pdf")));
  await printHtml("stamps", stamps(count), true); // true: without it Chrome recolours the text
} finally {
  await browser.close?.();
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
process.stdout.write(python(`import pymupdf, sys
body, st = pymupdf.open(sys.argv[1]), pymupdf.open(sys.argv[2])
for i, p in enumerate(body):
    W, H = p.rect.width, p.rect.height
    p.draw_rect(p.rect, color=None, fill=(0, 0, 0), width=0, overlay=False)  # under everything: no seam at the margins
    if i: p.show_pdf_page(p.rect, st, i)
body.set_metadata({"title": sys.argv[4], "author": sys.argv[5]})
body.save(sys.argv[3], garbage=3, deflate=True)
print(sys.argv[3], len(body), "pages")`, path.join(tmp, "body.pdf"), path.join(tmp, "stamps.pdf"), path.resolve(out), title, AUTHOR));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
