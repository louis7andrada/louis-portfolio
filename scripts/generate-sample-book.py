"""
Generates placeholder "book" assets (cover, anchor spreads, transition
sprite sheets, and a looping GIF grid thumbnail) purely from a page count,
into a local staging folder — book-images/<slug>/ — so the Books/Oeuvre
viewer's positioning and animation flow can be tested before real
photography exists. Also writes the matching Hugo content file with an
`imageBase` field pointing at where those files belong in the
louis-andrada-images GitHub repo.

The site never reads from book-images/ directly (same as artwork/archive
images, books are hosted externally, not shipped with this repo) — a
generated sample book won't actually show images on the live/dev site until
book-images/<slug>/ is uploaded to
https://github.com/louis7andrada/louis-andrada-images under books/<slug>/.

Run with no arguments to (re)generate a small batch of sample books (mixed
vertical/horizontal). Pass --slug/--pages/etc. to generate one custom book.

Usage:
    python scripts/generate-sample-book.py
    python scripts/generate-sample-book.py --slug my-book --pages 8 --orientation horizontal
"""

import argparse
import math
import os
import shutil

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

COVER_COLORS = [(58, 46, 40), (40, 48, 52), (46, 40, 54)]
PAGE_BG = (236, 231, 221)
PAGE_LINE = (205, 198, 182)


def load_font(size):
    for candidate in (r"C:\Windows\Fonts\arial.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


def centered_text(draw, box, text, fnt, fill):
    x0, y0, x1, y1 = box
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    cx = x0 + (x1 - x0 - tw) / 2 - bbox[0]
    cy = y0 + (y1 - y0 - th) / 2 - bbox[1]
    draw.text((cx, cy), text, font=fnt, fill=fill)


def make_cover(w, h, title, color_seed):
    img = Image.new("RGB", (w, h), (250, 248, 244))
    base_color = COVER_COLORS[color_seed % len(COVER_COLORS)]

    # drop shadow
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    margin = int(w * 0.03)
    sd.rectangle([margin, margin + int(h * 0.02), w - margin + 8, h - margin + 10], fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(w * 0.015))
    img.paste(Image.alpha_composite(img.convert("RGBA"), shadow).convert("RGB"), (0, 0))

    # cover face with a soft top-left -> bottom-right gradient
    cover = Image.new("RGB", (w - 2 * margin, h - 2 * margin))
    cd = ImageDraw.Draw(cover)
    cw, ch = cover.size
    for y in range(ch):
        f = y / max(1, ch - 1)
        r = int(base_color[0] * (1.18 - 0.30 * f))
        g = int(base_color[1] * (1.18 - 0.30 * f))
        b = int(base_color[2] * (1.18 - 0.30 * f))
        cd.line([(0, y), (cw, y)], fill=(min(255, r), min(255, g), min(255, b)))

    # spine shadow strip (binding edge, left side)
    spine_w = max(4, int(cw * 0.045))
    spine = Image.new("RGBA", (spine_w, ch), (0, 0, 0, 0))
    spd = ImageDraw.Draw(spine)
    for x in range(spine_w):
        f = 1 - (x / max(1, spine_w - 1))
        spd.line([(x, 0), (x, ch)], fill=(0, 0, 0, int(110 * f)))
    cover.paste(Image.alpha_composite(cover.convert("RGBA"), _pad_left(spine, cw, ch)).convert("RGB"), (0, 0))

    # fore-edge page-block sliver (right side) — a few pale hairlines
    edge_w = max(6, int(cw * 0.02))
    ed = ImageDraw.Draw(cover)
    for i in range(edge_w):
        x = cw - edge_w + i
        shade = 232 - int(i * 2.2)
        ed.line([(x, 6), (x, ch - 6)], fill=(shade, shade, shade - 6))

    fnt_title = load_font(max(18, int(cw * 0.075)))
    fnt_sub = load_font(max(11, int(cw * 0.032)))
    centered_text(cd, (int(cw * 0.1), int(ch * 0.42), int(cw * 0.9), int(ch * 0.58)), title.upper(), fnt_title, (232, 226, 214))
    centered_text(cd, (int(cw * 0.1), int(ch * 0.6), int(cw * 0.9), int(ch * 0.68)), "closed cover — click to open", fnt_sub, (200, 190, 172))

    img.paste(cover, (margin, margin))
    return img


def _pad_left(strip, w, h):
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(strip, (0, 0))
    return canvas


def make_spread(w, h, left_label, right_label, left_num, right_num):
    img = Image.new("RGB", (w, h), PAGE_BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], outline=(190, 183, 166), width=2)

    # spine gutter shading (soft dark gradient toward the center fold)
    gutter_w = max(10, int(w * 0.035))
    cx = w // 2
    for i in range(gutter_w):
        f = 1 - (i / gutter_w)
        shade = int(40 * f)
        d.line([(cx - i, 0), (cx - i, h)], fill=(PAGE_BG[0] - shade, PAGE_BG[1] - shade, PAGE_BG[2] - shade))
        d.line([(cx + i, 0), (cx + i, h)], fill=(PAGE_BG[0] - shade, PAGE_BG[1] - shade, PAGE_BG[2] - shade))

    fnt_label = load_font(max(14, int(w * 0.028)))
    fnt_num = load_font(max(10, int(w * 0.016)))

    # faint ruled lines to suggest page content, on each half
    for half_x0, half_x1 in ((0, cx - gutter_w), (cx + gutter_w, w)):
        for ly in range(int(h * 0.18), int(h * 0.42), max(10, int(h * 0.045))):
            d.line([(half_x0 + int(w * 0.08), ly), (half_x1 - int(w * 0.08), ly)], fill=PAGE_LINE, width=1)

    centered_text(d, (0, int(h * 0.44), cx, int(h * 0.56)), left_label, fnt_label, (60, 55, 48))
    centered_text(d, (cx, int(h * 0.44), w, int(h * 0.56)), right_label, fnt_label, (60, 55, 48))
    if left_num:
        d.text((int(w * 0.04), h - int(h * 0.07)), str(left_num), font=fnt_num, fill=(140, 133, 118))
    if right_num:
        rb = d.textbbox((0, 0), str(right_num), font=fnt_num)
        d.text((w - int(w * 0.04) - (rb[2] - rb[0]), h - int(h * 0.07)), str(right_num), font=fnt_num, fill=(140, 133, 118))
    return img


def shade_overlay(w, h, darker_at_far_edge):
    """Horizontal gradient, darker toward the free (moving) edge of a
    turning page — sells the illusion of the paper lifting/curling."""
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
    """A full-width page (the cover) shrinking from the left-hand spine
    outward — used for open (t: 0 -> 1 uncovers) and close (pass 1-t)."""
    frame = bg.copy()
    rect_w = max(0, int(w * (1 - t)))
    if rect_w > 0:
        squashed = turn_src.resize((rect_w, h)).convert("RGBA")
        squashed.alpha_composite(shade_overlay(rect_w, h, darker_at_far_edge=True))
        frame.paste(squashed.convert("RGB"), (0, 0))
    return frame


def flip_frame_half_right(bg, turn_src_right_half, t, w, h):
    """The right-hand page of a spread shrinking toward the center spine
    (fixed left edge at the spine) — used for spread-to-spread flips."""
    frame = bg.copy()
    half = w // 2
    rect_w = max(0, int(half * (1 - t)))
    if rect_w > 0:
        squashed = turn_src_right_half.resize((rect_w, h)).convert("RGBA")
        squashed.alpha_composite(shade_overlay(rect_w, h, darker_at_far_edge=True))
        frame.paste(squashed.convert("RGB"), (half, 0))
    return frame


def make_open_sheet(cover_img, spread1_img, frame_count, w, h):
    sheet = Image.new("RGB", (w * frame_count, h))
    for i in range(frame_count):
        t = i / (frame_count - 1) if frame_count > 1 else 1
        frame = flip_frame_fullwidth(spread1_img, cover_img, t, w, h)
        sheet.paste(frame, (i * w, 0))
    return sheet


def make_close_sheet(last_spread_img, cover_img, frame_count, w, h):
    sheet = Image.new("RGB", (w * frame_count, h))
    for i in range(frame_count):
        t = i / (frame_count - 1) if frame_count > 1 else 1
        frame = flip_frame_fullwidth(last_spread_img, cover_img, 1 - t, w, h)
        sheet.paste(frame, (i * w, 0))
    return sheet


def make_flip_sheet(from_img, to_img, frame_count, w, h):
    sheet = Image.new("RGB", (w * frame_count, h))
    right_half_src = from_img.crop((w // 2, 0, w, h))
    for i in range(frame_count):
        t = i / (frame_count - 1) if frame_count > 1 else 1
        frame = flip_frame_half_right(to_img, right_half_src, t, w, h)
        sheet.paste(frame, (i * w, 0))
    return sheet


def make_gif_thumbnail(path, cover_img, spread_imgs):
    frames = [cover_img] + spread_imgs + [cover_img]
    durations = [700] + [550] * len(spread_imgs) + [900]
    frames[0].save(
        path, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True,
    )


def build_book(slug, title, orientation, order, year, page_count, frames_per_flip, frames_per_open_close, fps):
    if orientation == "horizontal":
        page_w, page_h = 700, 500
    else:
        page_w, page_h = 500, 700
    w, h = page_w * 2, page_h

    out_dir = os.path.join(REPO_ROOT, "book-images", slug)
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    n = page_count
    spreads = math.ceil((n + 2) / 2)
    slots = [None] + [i for i in range(1, n + 1)] + [None]
    if len(slots) % 2 == 1:
        slots.append(None)

    color_seed = abs(hash(slug))
    cover_img = make_cover(w, h, title, color_seed)
    cover_img.save(os.path.join(out_dir, "cover.jpg"), quality=88)

    spread_imgs = []
    for s in range(spreads):
        left = slots[2 * s]
        right = slots[2 * s + 1] if (2 * s + 1) < len(slots) else None
        left_label = f"Page {left}" if left else "(blank)"
        right_label = f"Page {right}" if right else "(blank)"
        img = make_spread(w, h, left_label, right_label, left, right)
        img.save(os.path.join(out_dir, f"spread-{s + 1:02d}.jpg"), quality=88)
        spread_imgs.append(img)

    make_open_sheet(cover_img, spread_imgs[0], frames_per_open_close, w, h).save(
        os.path.join(out_dir, "transition-open.jpg"), quality=85
    )
    for s in range(spreads - 1):
        make_flip_sheet(spread_imgs[s], spread_imgs[s + 1], frames_per_flip, w, h).save(
            os.path.join(out_dir, f"transition-{s + 1:02d}.jpg"), quality=85
        )
    make_close_sheet(spread_imgs[-1], cover_img, frames_per_open_close, w, h).save(
        os.path.join(out_dir, "transition-close.jpg"), quality=85
    )

    make_gif_thumbnail(os.path.join(out_dir, "cover.gif"), cover_img, spread_imgs)

    content_path = os.path.join(REPO_ROOT, "content", "books", f"{slug}.md")
    image_base = f"https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/books/{slug}"
    frontmatter = f"""---
id: "{slug}"
slug: "{slug}"
imageBase: "{image_base}"
title: "{title}"
order: {order}
year: {year}
size: "{'11 x 8 in' if orientation == 'horizontal' else '5 x 8.5 in'}"
medium: "Graphite and ink on paper"
availability: "Available"
price: 45
description: "A placeholder sketchbook used to test the page-turn viewer end-to-end before real photography is dropped in."
pageCount: {n}
framesPerFlip: {frames_per_flip}
framesPerOpenClose: {frames_per_open_close}
fps: {fps}
comment: ""
---
"""
    with open(content_path, "w", encoding="utf-8") as f:
        f.write(frontmatter)
    print(f"built '{slug}' ({orientation}, {spreads} spreads, {page_count} pages)")


BATCH = [
    ("sample-book-v1", "Sketchbook One", "vertical", 6, 2026),
    ("sample-book-h1", "Field Notes", "horizontal", 5, 2026),
    ("sample-book-v2", "Sketchbook Two", "vertical", 4, 2025),
    ("sample-book-h2", "Travel Journal", "horizontal", 3, 2025),
    ("sample-book-v3", "Sketchbook Three", "vertical", 2, 2024),
    ("sample-book-h3", "Studio Log", "horizontal", 1, 2024),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug")
    parser.add_argument("--title", default="Sample Book")
    parser.add_argument("--orientation", choices=["vertical", "horizontal"], default="vertical")
    parser.add_argument("--order", type=int, default=1)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--pages", type=int, default=4)
    parser.add_argument("--frames-per-flip", type=int, default=8)
    parser.add_argument("--frames-per-open-close", type=int, default=10)
    parser.add_argument("--fps", type=int, default=12)
    args = parser.parse_args()

    if args.slug:
        build_book(args.slug, args.title, args.orientation, args.order, args.year,
                    args.pages, args.frames_per_flip, args.frames_per_open_close, args.fps)
    else:
        for slug, title, orientation, order, year in BATCH:
            build_book(slug, title, orientation, order, year, args.pages,
                        args.frames_per_flip, args.frames_per_open_close, args.fps)


if __name__ == "__main__":
    main()
