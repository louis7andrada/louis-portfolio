"""
Turns a PDF manuscript into a "single page mode" book: each PDF page becomes
one flip-through page (no cover/spread pairing — that's for physically
photographed sketchbooks only, see generate-sample-book.py). Renders every
page to a JPG and builds a page-curl transition sprite sheet between each
consecutive pair into a local staging folder — book-images/<slug>/ — and
writes the matching Hugo content file with an `imageBase` field pointing at
where those files belong in the louis-andrada-images GitHub repo.

The site never reads from book-images/ directly (same as artwork/archive
images, books are hosted externally, not shipped with this repo) — after
running this script, upload the generated folder's contents to
https://github.com/louis7andrada/louis-andrada-images under books/<slug>/.

Usage:
    python scripts/ingest-pdf-book.py "book-sources/My Book.pdf" --order 5 --year 2026

The slug/title default to the PDF's filename (title-cased) unless --slug/
--title are given. Re-run any time to regenerate assets (e.g. after editing
the source PDF) — it always rebuilds the book's folder from scratch.
"""

import argparse
import os
import re
import shutil

import pymupdf
from PIL import Image, ImageDraw

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RENDER_DPI = 150  # rasterization quality for each PDF page


def slugify(name):
    name = re.sub(r"\.pdf$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return name


def shade_overlay(w, h, darker_at_far_edge):
    grad = Image.new("L", (max(1, w), 1))
    for x in range(w):
        f = x / max(1, w - 1)
        alpha = f if darker_at_far_edge else (1 - f)
        grad.putpixel((x, 0), int(alpha * 130))
    grad = grad.resize((max(1, w), h))
    overlay = Image.new("RGBA", (max(1, w), h), (10, 8, 6, 255))
    overlay.putalpha(grad)
    return overlay


def flip_frame_fullwidth(bg, turn_src, t, w, h):
    """Full-page turn: the current page shrinks from the left-hand spine
    outward (t: 0 -> 1 uncovers), revealing the next page underneath."""
    frame = bg.copy()
    rect_w = max(0, int(w * (1 - t)))
    if rect_w > 0:
        squashed = turn_src.resize((rect_w, h)).convert("RGBA")
        squashed.alpha_composite(shade_overlay(rect_w, h, darker_at_far_edge=True))
        frame.paste(squashed.convert("RGB"), (0, 0))
    return frame


def make_flip_sheet(from_img, to_img, frame_count, w, h):
    sheet = Image.new("RGB", (w * frame_count, h))
    for i in range(frame_count):
        t = i / (frame_count - 1) if frame_count > 1 else 1
        frame = flip_frame_fullwidth(to_img, from_img, t, w, h)
        sheet.paste(frame, (i * w, 0))
    return sheet


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf_path")
    parser.add_argument("--slug")
    parser.add_argument("--title")
    parser.add_argument("--order", type=int, default=1)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--frames-per-flip", type=int, default=10)
    parser.add_argument("--fps", type=int, default=14)
    parser.add_argument("--description", default="")
    args = parser.parse_args()

    pdf_path = os.path.abspath(args.pdf_path)
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]
    slug = args.slug or slugify(base_name)
    title = args.title or base_name

    out_dir = os.path.join(REPO_ROOT, "book-images", slug)
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    n = doc.page_count
    zoom = RENDER_DPI / 72
    matrix = pymupdf.Matrix(zoom, zoom)

    page_imgs = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=matrix)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        page_imgs.append(img)

    # All pages of one PDF share the same page size, so a uniform stage size
    # (the first page's dimensions) is safe for every anchor/transition frame.
    w, h = page_imgs[0].size

    for i, img in enumerate(page_imgs):
        if img.size != (w, h):
            img = img.resize((w, h))
        path = os.path.join(out_dir, f"page-{i + 1:02d}.jpg")
        img.save(path, quality=90)

    # cover.jpg mirrors page 1 — the grid thumbnail template always looks
    # for cover.jpg regardless of a book's pageMode.
    page_imgs[0].save(os.path.join(out_dir, "cover.jpg"), quality=90)

    for i in range(n - 1):
        sheet = make_flip_sheet(page_imgs[i], page_imgs[i + 1], args.frames_per_flip, w, h)
        sheet.save(os.path.join(out_dir, f"transition-{i + 1:02d}.jpg"), quality=85)

    content_path = os.path.join(REPO_ROOT, "content", "oeuvre", f"{slug}.md")
    description = args.description.replace('"', "'")
    image_base = f"https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/books/{slug}"
    frontmatter = f"""---
id: "{slug}"
slug: "{slug}"
imageBase: "{image_base}"
title: "{title}"
order: {args.order}
year: {args.year}
medium: ""
description: "{description}"
pageMode: "single"
pageCount: {n}
framesPerFlip: {args.frames_per_flip}
fps: {args.fps}
comment: ""
---
"""
    with open(content_path, "w", encoding="utf-8") as f:
        f.write(frontmatter)

    print(f"built '{slug}': {n} pages, {n - 1} transitions -> {out_dir}")
    print(f"content file -> {content_path}")


if __name__ == "__main__":
    main()
