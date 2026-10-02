"""
Turns a folder of original photos into the Photography section.

For every photo it writes:
  photography-images/photoN.jpg    web copy: upright, 1600px WIDE (same rule as
                                   the artworks; narrower originals are never
                                   enlarged), JPEG q80 with full-resolution
                                   colour (4:4:4), converted to sRGB, NO
                                   metadata (iPhone photos carry GPS location)
  content/photography/photoN.md    the page: id photoN, title in lowercase
                                   roman numerals (i, ii, iii …)

Numbering follows the date the photo was taken (EXIF), oldest = photo1 / i.
Photos already in content/photography/ keep their number and collection
(matched by `source`, the original file name); new ones continue after the
highest. New photos: pure black-and-white = Ambiguous, everything else Lucid.
--ambiguous / --lucid NAME … override that (also for existing photos).

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

import io

from PIL import Image, ImageCms, ImageOps, ImageStat

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(REPO_ROOT, "content", "photography")
OUT_DIR = os.path.join(REPO_ROOT, "photography-images")
IMAGE_BASE = "https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/photography"
WIDTH = 1600
QUALITY = 80
EXTS = (".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff", ".webp")


def roman(n):
    out = ""
    for v, s in ((1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"),
                 (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")):
        while n >= v:
            out += s
            n -= v
    return out


def taken(im, path):
    exif = im.getexif()
    date = exif.get_ifd(0x8769).get(36867) or exif.get(306) if exif else None
    if date:
        return str(date)
    return "9999:99:99 " + os.path.basename(path)  # undated: after everything else


SRGB = ImageCms.createProfile("sRGB")


def to_srgb(im, icc):
    """iPhones shoot in Display P3. Converting the pixels to sRGB keeps the colours
    right in every copy made from this file (the site's WebP copies drop colour
    profiles, which made every Lucid photo look washed out)."""
    if not icc:
        return im
    try:
        return ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), SRGB, outputMode="RGB")
    except Exception:  # noqa: BLE001 - an unreadable profile: keep the pixels as they are
        return im


def is_black_and_white(im):
    small = im.convert("RGB")
    small.thumbnail((200, 200))
    return ImageStat.Stat(small.convert("HSV").split()[1]).mean[0] < 3


def existing():
    """original name (e.g. IMG_7407) -> (order, collection), from the pages already written."""
    known = {}
    for md in glob.glob(os.path.join(CONTENT, "*.md")):
        if md.endswith("_index.md"):
            continue
        text = open(md, encoding="utf-8").read()
        src = re.search(r'^source:\s*"([^"]+)"', text, re.M) \
            or re.search(r'^image:\s*"[^"]*/(IMG_[^/"]+)\.jpg"', text, re.M)  # pages written before `source`
        order = re.search(r"^order:\s*(\d+)", text, re.M)
        coll = re.search(r'^collection:\s*"([^"]+)"', text, re.M)
        if src and order:
            known[src.group(1)] = (int(order.group(1)), coll.group(1) if coll else None)
    return known


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--ambiguous", nargs="*", default=[], help="photo names to put in Ambiguous")
    ap.add_argument("--lucid", nargs="*", default=[], help="photo names to put in Lucid")
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
    next_order = max((o for o, _ in known.values()), default=0) + 1
    for date, name, path in photos:
        order, collection = known.get(name, (None, None))
        if order is None:
            order, next_order = next_order, next_order + 1
        pid = f"photo{order}"
        with Image.open(path) as im:
            icc = im.info.get("icc_profile")
            im = ImageOps.exif_transpose(im)
            bw = is_black_and_white(im)
            im = im.convert("L") if bw else to_srgb(im.convert("RGB"), icc)
            if im.width > WIDTH:
                im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
            # A fresh save with no exif=/icc_profile= drops every tag (GPS, camera, dates);
            # untagged = sRGB, which the pixels now are. subsampling=0 keeps colour at full
            # resolution (the default halves it, smearing red lights and coloured edges).
            im.save(os.path.join(OUT_DIR, f"{pid}.jpg"), "JPEG", quality=QUALITY, subsampling=0,
                    optimize=True, progressive=True)
        if collection is None:
            collection = "Ambiguous" if bw else "Lucid"
        if name in args.ambiguous:
            collection = "Ambiguous"
        if name in args.lucid:
            collection = "Lucid"
        year = date[:4] if date[:4].isdigit() and date[0] != "9" else "2026"
        with open(os.path.join(CONTENT, f"{pid}.md"), "w", encoding="utf-8", newline="\n") as f:
            f.write(f'---\nid: "{pid}"\ntitle: "{roman(order)}"\norder: {order}\nyear: {year}\n'
                    f'collection: "{collection}"\nsource: "{name}"\nimage: "{IMAGE_BASE}/{pid}.jpg"\n---\n')
        print(f"{pid:>9}  {roman(order):>9}  {name}  {date[:10]}  {collection}")


if __name__ == "__main__":
    main()
