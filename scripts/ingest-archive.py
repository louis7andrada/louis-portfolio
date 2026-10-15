"""
Turns a folder of original photos into Archive entries.

The Archive has four categories (the filter shows `photos` as "Louis"):
  photos       photographs of Louis      -> photoN
  photography  photographs he took       -> photographyN
  studios      the studio, works in progress, sketchbooks -> studioN
  galleries    galleries & exhibitions   -> galleryN
Which photo goes where is a person's call, so the folder holds a
categories.json: {"IMG_7799": "photos", "IMG_6405": "skip", ...}
(original file name without extension). Every photo in the folder must be in it.

For every photo it writes:
  archive-images/<category>/<id>.jpg   web copy: upright, 1600px WIDE (never
                                       enlarged), JPEG q80, full-resolution
                                       colour (4:4:4), converted to sRGB, NO
                                       metadata (iPhone photos carry GPS)
  content/archive/<category>/<id>.md   the page (id, slug, category, year, image,
                                       source = the original file name, and the
                                       caption `comment` when the page had one)

Numbers continue after the highest one ever used in that category, counting the
entries removed into private/archive-removed/: the images repo still holds those
files, and Hugo caches remote images by URL forever, so a reused number would
show the OLD photo. Within a run, new photos are numbered by date taken. Photos
already in the archive (matched by `source`) keep their number and caption.
Archive photos carry no title, only year, category and one short caption
(`comment`, written by hand in an encyclopedia's voice): new photos get none, so
write theirs after the run.

Upload archive-images/<category>/* to archive/<category>/ in
louis7andrada/louis-andrada-images, then run scripts/image-dims.py.
Originals stay in private/ (never published).

Usage (from the repo root; needs Pillow):
    python scripts/ingest-archive.py private/archive-originals
"""

import argparse
import glob
import io
import json
import os
import re
import sys

from PIL import Image, ImageCms, ImageOps, ImageStat

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(REPO_ROOT, "content", "archive")
REMOVED = os.path.join(REPO_ROOT, "private", "archive-removed")
OUT_DIR = os.path.join(REPO_ROOT, "archive-images")
IMAGE_BASE = "https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/archive"
PREFIX = {"photos": "photo", "photography": "photography", "studios": "studio", "galleries": "gallery"}
WIDTH = 1600
QUALITY = 80
EXTS = (".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff", ".webp")
SRGB = ImageCms.createProfile("sRGB")


def taken(im):
    exif = im.getexif()
    date = exif.get_ifd(0x8769).get(36867) or exif.get(306) if exif else None
    return str(date) if date and re.match(r"\d{4}:\d\d:\d\d", str(date)) else None  # some apps write "    :  :  "


def to_srgb(im, icc):
    """iPhones shoot in Display P3; the site's WebP copies drop colour profiles."""
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


def used_numbers(category):
    """Every number this category has ever used: current pages + removed entries."""
    prefix = PREFIX[category]
    names = [os.path.splitext(os.path.basename(p))[0] for p in
             glob.glob(os.path.join(CONTENT, category, "*.md")) + glob.glob(os.path.join(REMOVED, category, "*"))]
    return {int(m.group(1)) for n in names if (m := re.fullmatch(re.escape(prefix) + r"(\d+)", n))}


def existing():
    """original name -> (category, id, comment line or ""), from the pages already written."""
    known = {}
    for md in glob.glob(os.path.join(CONTENT, "*", "*.md")):
        text = open(md, encoding="utf-8").read()
        src = re.search(r'^source:\s*"([^"]+)"', text, re.M)
        if src:
            comment = re.search(r'^comment:.*\n', text, re.M)
            known[src.group(1)] = (os.path.basename(os.path.dirname(md)), os.path.splitext(os.path.basename(md))[0],
                                   comment.group(0) if comment else "")
    return known


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--year", default="2026", help="year for photos with no date taken")
    args = ap.parse_args()

    cats = json.load(open(os.path.join(args.folder, "categories.json"), encoding="utf-8"))
    files = [p for p in sorted(glob.glob(os.path.join(args.folder, "*"))) if p.lower().endswith(EXTS)]
    missing = [os.path.basename(p) for p in files if os.path.splitext(os.path.basename(p))[0] not in cats]
    if missing:
        sys.exit("not in categories.json: " + ", ".join(missing))
    bad = {v for k, v in cats.items() if not k.startswith("_")} - set(PREFIX) - {"skip"}
    if bad:
        sys.exit("unknown categories: " + ", ".join(sorted(bad)))

    photos = []
    for p in files:
        name = os.path.splitext(os.path.basename(p))[0]
        if cats[name] == "skip":
            continue
        with Image.open(p) as im:
            date = taken(im)
        photos.append((date or "9999", name, p, date))
    photos.sort()

    known = existing()
    nxt = {c: max(used_numbers(c), default=0) + 1 for c in PREFIX}
    for _, name, path, date in photos:
        category = cats[name]
        comment = known[name][2] if name in known else ""
        if name in known and known[name][0] == category:
            pid = known[name][1]
        else:
            if name in known:  # moved to another category: drop the old page (its caption moves along)
                os.remove(os.path.join(CONTENT, *known[name][:2]) + ".md")
            pid, nxt[category] = f"{PREFIX[category]}{nxt[category]}", nxt[category] + 1
        with Image.open(path) as im:
            icc = im.info.get("icc_profile")
            im = ImageOps.exif_transpose(im)
            im = im.convert("L") if is_black_and_white(im) else to_srgb(im.convert("RGB"), icc)
            if im.width > WIDTH:
                im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
            os.makedirs(os.path.join(OUT_DIR, category), exist_ok=True)
            # A fresh save with no exif=/icc_profile= drops every tag (GPS, camera, dates).
            im.save(os.path.join(OUT_DIR, category, f"{pid}.jpg"), "JPEG", quality=QUALITY, subsampling=0,
                    optimize=True, progressive=True)
        year = date[:4] if date and date[:4].isdigit() else args.year
        os.makedirs(os.path.join(CONTENT, category), exist_ok=True)
        with open(os.path.join(CONTENT, category, f"{pid}.md"), "w", encoding="utf-8", newline="\n") as f:
            f.write(f'---\nid: "{pid}"\nslug: "{pid}"\ncategory: "{category}"\nyear: {year}\n'
                    f'source: "{name}"\nimage: "{IMAGE_BASE}/{category}/{pid}.jpg"\n{comment}---\n')
        print(f"{category:>11}  {pid:>14}  {name:<12}  {(date or 'no date')[:10]}  {year}")


if __name__ == "__main__":
    main()
