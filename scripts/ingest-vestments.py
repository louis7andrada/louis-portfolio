"""
Turns photos of clothes into the Vestments section (L', l.andrada.one).

For every photo in the folder it:
  1. cuts the garment out, full size, on a transparent background:
     private/vestments-cutouts/<name>.png. BiRefNet (rembg "birefnet-general") finds the
     garment. If <folder>/hangers.json has clicks for the photo, SAM (rembg "sam") finds the
     hanger from them; the hanger is cut away where it was over the floor, painted over with
     the surrounding fabric where it was over the garment, and the edge there is redrawn
     smooth. Edge colours are cleaned so no light floor fringe shows on the dark site.
     An existing cutout is kept: re-runs never redo it, and one can be fixed by hand.
  2. writes the web copy vestments-images/vestmentN.png (1600px wide, never enlarged,
     transparent, sRGB, NO metadata: iPhone photos carry GPS) and the page
     content/vestments/vestmentN.md (title in lowercase roman numerals, like Photography).

Numbering follows the date the photo was taken (EXIF), oldest = vestment1 / i. Pages already
in content/vestments/ keep their number (matched by `source`, the original file name).

hangers.json: {"IMG_0823": [{"pos": [[x, y], ...], "neg": [[x, y], ...]}, ...]}, points on the
upright photo. pos: on the hanger (hook, arch, any bar showing through the front opening);
neg: on the fabric or floor right next to it. One group per separate piece of hanger.

The web copies are not served from this repo: upload vestments-images/* to vestments/ in
louis7andrada/louis-andrada-images, then run scripts/image-dims.py. Originals stay in private/.

Usage (from the repo root; needs pip install "rembg[cpu]" opencv-python-headless, whose
models download on first use, about 1 GB):
    python scripts/ingest-vestments.py private/vestments-originals
"""

import argparse
import glob
import io
import json
import os
import re
import sys

from PIL import Image, ImageCms, ImageOps

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(REPO_ROOT, "content", "vestments")
OUT_DIR = os.path.join(REPO_ROOT, "vestments-images")
CUTOUTS = os.path.join(REPO_ROOT, "private", "vestments-cutouts")
IMAGE_BASE = "https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/vestments"
WIDTH = 1600
EXTS = (".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff", ".webp")
SRGB = ImageCms.createProfile("sRGB")
RIM = 12      # the hanger mask grows by this much (its lighter rim)
SMOOTH = 30   # radius that redraws the garment's edge where the hanger was


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


def upright_srgb(path):
    with Image.open(path) as im:
        icc = im.info.get("icc_profile")
        im = ImageOps.exif_transpose(im).convert("RGB")
    if icc:  # iPhones shoot in Display P3
        try:
            im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), SRGB, outputMode="RGB")
        except Exception:  # noqa: BLE001 - an unreadable profile: keep the pixels as they are
            pass
    return im


def cut_out(im, clicks, sessions):
    import cv2
    import numpy as np
    from pymatting import estimate_foreground_ml
    from rembg import new_session, remove
    from scipy import ndimage as ndi

    if "garment" not in sessions:
        sessions["garment"] = new_session("birefnet-general")
    rgb = np.array(im)
    alpha = np.array(remove(im, session=sessions["garment"], only_mask=True).convert("L")).astype(np.float32) / 255
    a = alpha.copy()
    disk = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    R = np.zeros(alpha.shape, bool)

    if clicks:
        if "hanger" not in sessions:
            sessions["hanger"] = new_session("sam")
        # SAM sees a crop around the clicks, so the hanger is large in its view.
        pts = [p for g in clicks for p in g["pos"] + g["neg"]]
        x0 = max(min(p[0] for p in pts) - 300, 0); x1 = min(max(p[0] for p in pts) + 300, im.width)
        y0 = max(min(p[1] for p in pts) - 300, 0); y1 = min(max(p[1] for p in pts) + 300, im.height)
        crop = im.crop((x0, y0, x1, y1))
        H = np.zeros(alpha.shape, bool)
        for g in clicks:
            prompt = [{"type": "point", "label": 1, "data": [p[0] - x0, p[1] - y0]} for p in g["pos"]] \
                   + [{"type": "point", "label": 0, "data": [p[0] - x0, p[1] - y0]} for p in g["neg"]]
            m = np.array(remove(crop, session=sessions["hanger"], sam_prompt=prompt, only_mask=True).convert("L")) > 128
            H[y0:y1, x0:x1] |= m
        H = cv2.dilate(H.astype(np.uint8), disk(RIM)) > 0
        Z = cv2.dilate(H.astype(np.uint8), disk(SMOOTH + 15)) > 0             # the zone around the hanger
        core = cv2.erode(((alpha > 0.95) & ~H).astype(np.uint8), disk(3)) > 0  # solid fabric only
        floor = (alpha < 0.05) & ~H
        # Each hanger pixel takes the side it is closest to: fabric (painted over) or floor (cut away).
        fab = (ndi.distance_transform_edt(~core) < ndi.distance_transform_edt(~floor)).astype(np.float32)
        sil = ((alpha >= 0.5) & ~H) | (H & (cv2.GaussianBlur(fab, (0, 0), 6) >= 0.5))
        sm = cv2.morphologyEx(cv2.morphologyEx(sil.astype(np.uint8), cv2.MORPH_OPEN, disk(SMOOTH)), cv2.MORPH_CLOSE, disk(SMOOTH)) > 0
        a[Z] = cv2.GaussianBlur(sm.astype(np.float32), (0, 0), 1.5)[Z]
        # Paint everything in the zone that isn't solid fabric from solid fabric colours only.
        _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
        src = cv2.cvtColor(rgb[iy, ix], cv2.COLOR_RGB2BGR)
        R = Z & (a > 0) & ~core
        inp = cv2.cvtColor(cv2.inpaint(src, (R * 255).astype(np.uint8), 9, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB)
        rgb = rgb.copy()
        rgb[R] = inp[R]

    # Keep only the garment: every fragment not attached to it (a bit of hook, a speck) goes.
    n, lab, stats, _ = cv2.connectedComponentsWithStats((a > 0.05).astype(np.uint8), connectivity=8)
    if n > 1:
        a[lab != 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))] = 0
    # Clean edge colours: the soft edge mixes in the floor, which would glow on the dark site.
    fg = estimate_foreground_ml(rgb.astype(np.float64) / 255, a.astype(np.float64))
    fg[R] = rgb[R] / 255
    out = np.dstack([np.clip(fg * 255 + 0.5, 0, 255).astype(np.uint8), np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)])
    out[out[..., 3] == 0, :3] = 0
    ys, xs = np.nonzero(out[..., 3] > 8)
    pad = int(0.025 * max(out.shape[:2]))
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, out.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, out.shape[1])
    return Image.fromarray(out[y0:y1, x0:x1], "RGBA")


def existing():
    """original name (e.g. IMG_0823) -> order, from the pages already written."""
    known = {}
    for md in glob.glob(os.path.join(CONTENT, "*.md")):
        if md.endswith("_index.md"):
            continue
        text = open(md, encoding="utf-8").read()
        src = re.search(r'^source:\s*"([^"]+)"', text, re.M)
        order = re.search(r"^order:\s*(\d+)", text, re.M)
        if src and order:
            known[src.group(1)] = int(order.group(1))
    return known


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    args = ap.parse_args()

    files = [p for p in sorted(glob.glob(os.path.join(args.folder, "*"))) if p.lower().endswith(EXTS)]
    if not files:
        sys.exit(f"no photos in {args.folder}")
    hangers_path = os.path.join(args.folder, "hangers.json")
    hangers = json.load(open(hangers_path, encoding="utf-8")) if os.path.exists(hangers_path) else {}
    for d in (OUT_DIR, CONTENT, CUTOUTS):
        os.makedirs(d, exist_ok=True)

    photos = []
    for p in files:
        with Image.open(p) as im:
            photos.append((taken(im, p), os.path.splitext(os.path.basename(p))[0], p))
    photos.sort()

    known = existing()
    next_order = max(known.values(), default=0) + 1
    sessions = {}
    for date, name, path in photos:
        order = known.get(name)
        if order is None:
            order, next_order = next_order, next_order + 1
        vid = f"vestment{order}"
        cut_path = os.path.join(CUTOUTS, f"{name}.png")
        if not os.path.exists(cut_path):
            cut_out(upright_srgb(path), hangers.get(name), sessions).save(cut_path, optimize=True)
        with Image.open(cut_path) as im:
            im = im.convert("RGBA")
            if im.width > WIDTH:
                im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
            # A fresh save with no exif=/icc_profile= drops every tag; untagged = sRGB, which the pixels are.
            im.save(os.path.join(OUT_DIR, f"{vid}.png"), "PNG", optimize=True)
        year = date[:4] if date[:4].isdigit() and date[0] != "9" else "2026"
        with open(os.path.join(CONTENT, f"{vid}.md"), "w", encoding="utf-8", newline="\n") as f:
            f.write(f'---\nid: "{vid}"\ntitle: "{roman(order)}"\norder: {order}\nyear: {year}\n'
                    f'source: "{name}"\nimage: "{IMAGE_BASE}/{vid}.png"\n---\n')
        print(f"{vid:>11}  {roman(order):>6}  {name}  {date[:10]}")


if __name__ == "__main__":
    main()
