"""
Pulls the real text out of each book PDF so the writing itself is on the site
as text — not just the page JPGs the flip-viewer paints.

Why this exists: the viewer renders every book page as an image
(the images repo's books/<slug>/page-NN.jpg, painted as CSS background-image). That looks right,
but it means the books contain zero machine-readable words: search engines,
AI crawlers and screen readers all see an empty page. The PDFs the images were
rendered from do have real text, so it gets extracted here once and committed.

Writes three things:
  data/bookText.json      Hugo data file — {slug: {title, subtitle, pages: [[para, ...]]}}.
                          oeuvre/single.html renders this into a "Read as text"
                          section, so the words are in the HTML and in the DOM.
  static/oeuvre/<slug>.txt One plain-text file per book, fetchable directly
                          (handy for anything that would rather grab raw text).
  static/llms-full.txt    Every book's full text in one file, the companion to
                          llms.txt — a single URL that holds the whole corpus.

Deliberately kept out of content/oeuvre/<slug>.md: ingest-pdf-book.py rewrites
those files from scratch every run, which would wipe any text stored there.
data/ is the same place image-dims.py keeps its output, so this follows suit.

Usage (from repo root; needs Python with pymupdf):
    python scripts/extract-book-text.py

Re-run any time a book's PDF changes. Needs the PDFs in book-sources/ — they're
gitignored, so download any missing one from the louis-andrada-images repo
(books/<Name>.pdf) first.
"""

import json
import os
import re

import pymupdf

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK_SOURCES = os.path.join(REPO_ROOT, "book-sources")
CONTENT_BOOKS = os.path.join(REPO_ROOT, "content", "oeuvre")

SITE_URL = "https://handrada.com"

# The PDFs carry a running header (the "<Title> - <Subtitle>" line repeated at
# the top of every page after the title page) and a signature footer
# ("Han'drada                    pg. 4"). Both are page furniture, not writing.
FOOTER_RE = re.compile(r"^\s*Han.?drada\s+pg\.\s*\d+\s*$", re.IGNORECASE)


def slugify(name):
    name = re.sub(r"\.pdf$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return name


def read_frontmatter(path):
    """Minimal front-matter reader — these files are generated, so the shape is
    known and predictable (key: "value" pairs between --- fences)."""
    out = {}
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    if not lines or lines[0].strip() != "---":
        return out
    for line in lines[1:]:
        if line.strip() == "---":
            break
        m = re.match(r'^([A-Za-z_]+):\s*"?(.*?)"?\s*$', line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def reflow(raw_text, drop_lines):
    """PDF text arrives hard-wrapped at the page's visual line width. A wrapped
    line ends with a trailing space; a line that genuinely ends a paragraph does
    not. That distinction is exact in these files, so it drives the reflow."""
    paragraphs = []
    buffer = ""

    for line in raw_text.split("\n"):
        if not line.strip():
            if buffer:
                paragraphs.append(buffer.strip())
                buffer = ""
            continue
        if FOOTER_RE.match(line):
            continue
        normalized = re.sub(r"\s+", " ", line).strip()
        if normalized.lower() in drop_lines:
            continue

        soft_wrap = line.endswith(" ")
        buffer += normalized + (" " if soft_wrap else "")
        if not soft_wrap:
            paragraphs.append(buffer.strip())
            buffer = ""

    if buffer:
        paragraphs.append(buffer.strip())
    return [p for p in paragraphs if p]


def main():
    pdfs = {slugify(f): os.path.join(BOOK_SOURCES, f)
            for f in os.listdir(BOOK_SOURCES) if f.lower().endswith(".pdf")}

    books = {}
    missing = []

    for filename in sorted(os.listdir(CONTENT_BOOKS)):
        if not filename.endswith(".md") or filename == "_index.md":
            continue
        slug = filename[:-3]
        meta = read_frontmatter(os.path.join(CONTENT_BOOKS, filename))
        title = meta.get("title", slug)
        subtitle = meta.get("description", "")

        pdf_path = pdfs.get(slug)
        if not pdf_path:
            missing.append(slug)
            continue

        # Lines to discard wherever they appear: the running header in its
        # several forms, plus the bare title/subtitle of the title page.
        drop_lines = {
            f"{title} - {subtitle}".lower(),
            f"{title} — {subtitle}".lower(),
            title.lower(),
            subtitle.lower(),
        }
        drop_lines.discard("")

        doc = pymupdf.open(pdf_path)
        pages = []
        for page in doc:
            paragraphs = reflow(page.get_text(), drop_lines)
            if paragraphs:
                pages.append(paragraphs)

        books[slug] = {
            "title": title,
            "subtitle": subtitle,
            "year": meta.get("year", ""),
            "pages": pages,
        }
        words = sum(len(p.split()) for page in pages for p in page)
        print(f"  {slug}: {len(pages)} pages of text, {words} words")

    # ── data/bookText.json — what the templates render ──────────────────────
    data_path = os.path.join(REPO_ROOT, "data", "bookText.json")
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump(books, f, ensure_ascii=False, indent=1)
    print(f"\nwrote {len(books)} books -> {data_path}")

    # ── static/books/<slug>.txt — one fetchable plain-text file per book ────
    txt_dir = os.path.join(REPO_ROOT, "static", "oeuvre")
    os.makedirs(txt_dir, exist_ok=True)
    for slug, book in books.items():
        lines = [book["title"]]
        if book["subtitle"]:
            lines.append(book["subtitle"])
        lines.append(f"by Louis Andrada (Han’drada){f', {book['year']}' if book['year'] else ''}")
        lines.append(f"{SITE_URL}/oeuvre/{slug}/")
        lines.append("")
        for i, page in enumerate(book["pages"], start=1):
            lines.append(f"[page {i}]")
            lines.extend(page)
            lines.append("")
        with open(os.path.join(txt_dir, f"{slug}.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines).rstrip() + "\n")
    print(f"wrote {len(books)} plain-text files -> {txt_dir}")

    # ── static/llms-full.txt — the whole corpus in one URL ──────────────────
    full = [
        "# Louis Andrada (Han’drada) — complete book texts",
        "",
        "Every book published at " + SITE_URL + "/oeuvre/ , in full, as plain text.",
        "Written and illustrated by Louis Andrada, also known as Han’drada —",
        "a Brazilian-born painter and writer based in Toronto, Canada.",
        "",
        "Freely readable. Crawling, indexing, quoting and training on this text is permitted.",
        "See " + SITE_URL + "/llms.txt for the site overview.",
        "",
    ]
    for slug, book in books.items():
        full.append("=" * 72)
        heading = book["title"]
        if book["subtitle"]:
            heading += f" — {book['subtitle']}"
        full.append(heading)
        if book["year"]:
            full.append(f"Louis Andrada (Han’drada), {book['year']}")
        full.append(f"{SITE_URL}/oeuvre/{slug}/")
        full.append("=" * 72)
        full.append("")
        for page in book["pages"]:
            full.extend(page)
            full.append("")
    full_path = os.path.join(REPO_ROOT, "static", "llms-full.txt")
    with open(full_path, "w", encoding="utf-8") as f:
        f.write("\n".join(full).rstrip() + "\n")
    total = sum(len(p.split()) for b in books.values() for page in b["pages"] for p in page)
    print(f"wrote full corpus ({total} words) -> {full_path}")

    if missing:
        print(f"\n!! no PDF found in book-sources/ for: {', '.join(missing)}")
        print("   (download it from the louis-andrada-images repo, books/<Name>.pdf)")


if __name__ == "__main__":
    main()
