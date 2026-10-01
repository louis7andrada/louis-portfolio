"""
Records the real width x height of every remotely hosted image the site shows
(artworks, archive photos, book covers) into data/imageDims.json.

Why: the artwork/archive/book grids place items using each image's proportions.
Without them the browser guesses until every image has downloaded, so items
land in the wrong place and then jump as images arrive - and the blurred
background layers that copy the page jump with them. With the sizes known up
front, templates write width/height on every <img> and the grids lay out
correctly on the first frame.

Also stores an 8px preview of each image (data: URI). The blurred background
layer paints that instead of downloading the real image, so it can be there
from the first moment. Already-known URLs are skipped, so re-running is cheap.

Usage (from the repo root; needs Pillow):
    python scripts/image-dims.py            # add anything new
    python scripts/image-dims.py --refresh  # re-measure everything

Run it after adding or replacing artwork / archive images or books.
"""

import argparse
import base64
import glob
import io
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageOps

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO_ROOT, "data", "imageDims.json")
IMG_RE = re.compile(r"https?://[^\s\"']+\.(?:jpe?g|png|webp|gif)", re.I)


def frontmatter(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"---\r?\n(.*?)\r?\n---", text, re.S)
    return m.group(1) if m else ""


def collect_urls():
    urls = set()
    for path in glob.glob(os.path.join(REPO_ROOT, "content", "**", "*.md"), recursive=True):
        fm = frontmatter(path)
        for u in IMG_RE.findall(fm):
            urls.add(u)
        # books: the grid shows imageBase/cover.jpg (page size, same for every page)
        m = re.search(r'^imageBase:\s*"?([^"\s]+)"?', fm, re.M)
        if m:
            urls.add(m.group(1).rstrip("/") + "/cover.jpg")
    return sorted(urls)


def tiny(im):
    """8px-wide preview (as a data: URI) the background fog uses instead of the real image."""
    im.draft("RGB", (64, 64))
    im = im.convert("RGB")
    im.thumbnail((8, 8), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def measure(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "portfolio-dims/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            im = ImageOps.exif_transpose(im)  # browsers show photos upright: sizes must match
            w, h = im.size
            return url, [w, h, tiny(im)]
    except Exception as e:  # noqa: BLE001
        return url, str(e)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    known = {}
    if os.path.exists(OUT) and not args.refresh:
        known = json.load(open(OUT, encoding="utf-8"))

    urls = collect_urls()
    todo = [u for u in urls if len(known.get(u, [])) < 3]
    print(f"{len(urls)} image URLs in content, {len(known)} already known, {len(todo)} to measure")

    failed = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        for url, res in pool.map(measure, todo):
            if isinstance(res, list):
                known[url] = res
            else:
                failed.append((url, res))

    # drop entries no longer referenced anywhere
    known = {u: known[u] for u in sorted(known) if u in set(urls)}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(known, f, indent=0, ensure_ascii=False)
    print(f"wrote {len(known)} sizes -> {OUT}")
    for u, e in failed:
        print(f"  could not measure {u}: {e}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
