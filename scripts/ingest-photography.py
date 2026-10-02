"""
Turns a folder of original photos into the Photography section.

For every photo it writes:
  photography-images/<NAME>.jpg     web copy: upright, longest side 2560px,
                                    JPEG q85, NO metadata (iPhone photos carry
                                    GPS location) except the colour profile
  content/photography/photoN.md    the page (id and title photo1, photo2, …)

Numbering follows the date the photo was taken (EXIF), oldest = photo1. Photos
already listed in content/photography/ keep their number; new ones continue
after the highest. Collection: pure black-and-white photos are Ambiguous,
everything else Lucid (override with --ambiguous NAME …). Year comes from
the EXIF date.

The web copies are not served from this repo: upload photography-images/* to
photography/ in louis7andrada/louis-andrada-images (same as books), then run
scripts/image-dims.py. Originals stay in private/ (never published).

Usage (from the repo root; needs Pillow):
    python scripts/ingest-photography.py private/photography-originals
    python scripts/ingest-photography.py <folder> --ambiguous IMG_7823
"""

import argparse
import glob
import os
import re
import sys

from PIL import Image, ImageOps, ImageStat

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(REPO_ROOT, "content", "photography")
OUT_DIR = os.path.join(REPO_ROOT, "photography-images")
IMAGE_BASE = "https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/photography"
MAX_SIDE = 2560
EXTS = (".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff", ".webp")


def taken(im, path):
    exif = im.getexif()
    date = exif.get_ifd(0x8769).get(36867) or exif.get(306) if exif else None
    if date:
        return str(date)
    return "9999:99:99 " + os.path.basename(path)  # undated: after everything else


def is_black_and_white(im):
    small = im.convert("RGB")
    small.thumbnail((200, 200))
    return ImageStat.Stat(small.convert("HSV").split()[1]).mean[0] < 3


def existing():
    """name (e.g. IMG_7407) -> order, from the pages already written."""
    known = {}
    for md in glob.glob(os.path.join(CONTENT, "*.md")):
        if md.endswith("_index.md"):
            continue
        text = open(md, encoding="utf-8").read()
        img = re.search(r'^image:\s*"[^"]*/([^/"]+)\.jpg"', text, re.M)
        order = re.search(r"^order:\s*(\d+)", text, re.M)
        if img and order:
            known[img.group(1)] = int(order.group(1))
    return known


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--ambiguous", nargs="*", default=[], help="photo names to force into Ambiguous")
    ap.add_argument("--lucid", nargs="*", default=[], help="photo names to force into Lucid")
    args = ap.parse_args()

    files = [p for p in sorted(glob.glob(os.path.join(args.folder, "*"))) if p.lower().endswith(EXTS)]
    if not files:
        sys.exit(f"no photos in {args.folder}")
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(CONTENT, exist_ok=True)

    photos = []
    for p in files:
        name = os.path.splitext(os.path.basename(p))[0]
        with Image.open(p) as im:
            photos.append((taken(im, p), name, p))
    photos.sort()

    known = existing()
    next_order = max(known.values(), default=0) + 1
    for date, name, path in photos:
        order = known.get(name)
        if order is None:
            order, next_order = next_order, next_order + 1
        with Image.open(path) as im:
            icc = im.info.get("icc_profile")
            im = ImageOps.exif_transpose(im)
            bw = is_black_and_white(im)
            im = im.convert("L" if bw else "RGB")
            im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
            # A fresh save with no exif= drops every tag (GPS, camera, dates).
            extra = {"icc_profile": icc} if icc and not bw else {}
            im.save(os.path.join(OUT_DIR, f"{name}.jpg"), "JPEG", quality=85, optimize=True, progressive=True, **extra)
        collection = "Ambiguous" if bw else "Lucid"
        if name in args.ambiguous:
            collection = "Ambiguous"
        if name in args.lucid:
            collection = "Lucid"
        year = date[:4] if date[:4].isdigit() and date[0] != "9" else "2026"
        pid = f"photo{order}"
        with open(os.path.join(CONTENT, f"{pid}.md"), "w", encoding="utf-8", newline="\n") as f:
            f.write(f'---\nid: "{pid}"\ntitle: "{pid}"\norder: {order}\nyear: {year}\ncollection: "{collection}"\n'
                    f'image: "{IMAGE_BASE}/{name}.jpg"\n---\n')
        print(f"{pid:>9}  {name}  {date[:10]}  {collection}")


if __name__ == "__main__":
    main()
