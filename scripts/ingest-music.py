"""
Turns a folder of songs (Suno MP3s) into Ny's Production section (ny.andrada.one).

For every .mp3 in the folder:
  1. reads its tags: title, length, the date Suno made it, and the words (lyrics) without
     Suno's [Verse]/[Drop] section markers. The title is the file name (a renamed download
     keeps Louis's name; the tag inside stays as Suno wrote it);
  2. copies the MP3 untouched to music-images/<slug>.mp3;
  3. makes its cover, music-images/<slug>.jpg: an Ambiguous photograph from the Photography
     section, cut square from the full-size original (private/photography-originals/), 1600px,
     with the name small in AndradaMono (bottom left) and, for a song with two sides, the side
     letter in the top right corner;
  4. writes content/production/<slug>.md.

Two files with the same title are the two sides of one song (Louis, Oct 2026): the file without
a number ("Ritual Annihilation.mp3") is Side A, the browser's duplicate ("Ritual Annihilation
(1).mp3") Side B, (2) Side C... Both sides share one cover. A .wav next to an .mp3 of the same
name is the same recording and is ignored.

Covers are chosen by hand: --cover "Title=photoN" (optionally "@0.3": where the square sits on a
portrait photo, 0 = top, 1 = bottom; default 0.5). Pages already written keep their number, cover,
crop and description (matched by `source`, the original file name), so re-runs only add.

Numbering follows the date Suno made each song, oldest = 1; `order` is that number (higher shows
first), and Side A always sits just before Side B.

The files are not served from this repo: upload music-images/* to music/ in
louis7andrada/louis-andrada-images. Hugo then publishes each MP3 from there under /audio/
(_partials/audio-url.html), so it plays from the site's own address (the CSP allows no other).

Usage (from the repo root; needs mutagen, Pillow and fonttools):
    python scripts/ingest-music.py private/music-originals --cover "Omnipulse=photo124@0.3"
"""

import argparse
import glob
import io
import os
import re
import sys
import unicodedata

import mutagen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(REPO_ROOT, "content", "production")
OUT_DIR = os.path.join(REPO_ROOT, "music-images")
PHOTO_CONTENT = os.path.join(REPO_ROOT, "content", "photography")
ORIGINALS = os.path.join(REPO_ROOT, "private", "photography-originals")
FONT = os.path.join(REPO_ROOT, "static", "fonts", "AndradaMono.woff")
BASE = "https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/music"
SIZE = 1600        # covers are square, like a record sleeve
TEXT = 0.026       # name and side letter: ~42px on 1600 - small, it isn't a title card
MARGIN = 0.055


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def words(raw):
    """Suno's lyrics with the [Section] markers dropped; a marker between lines starts a new stanza."""
    stanzas, cur = [], []
    for line in raw.replace("�", " ").splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if not line or re.fullmatch(r"\[[^\]]*\]", line):
            if cur:
                stanzas.append(cur)
                cur = []
            continue
        cur.append(line)
    if cur:
        stanzas.append(cur)
    return "\n\n".join("\n".join(s) for s in stanzas)


def read(path):
    m = mutagen.File(path)
    tags = m.tags or {}
    def first(prefix):
        for k, v in tags.items():
            if k.startswith(prefix):
                return v
        return None
    title = str(first("TIT2") or os.path.splitext(os.path.basename(path))[0])
    comm = str(first("COMM") or "")
    made = re.search(r"created=([0-9T:.\-]+)", comm)
    lyr = first("USLT")
    return {
        "title": title.strip(),
        "made": made.group(1) if made else "9999",
        "length": int(round(m.info.length)),
        "words": words(lyr.text) if lyr else "",
    }


def existing():
    """source (original file name) -> the hand-kept fields of the page already written."""
    known = {}
    for md in glob.glob(os.path.join(CONTENT, "*.md")):
        if md.endswith("_index.md"):
            continue
        text = open(md, encoding="utf-8").read()
        fm = re.match(r"---\n(.*?)\n---", text, re.S)
        fm = fm.group(1) if fm else ""
        def field(k):
            m = re.search(rf'^{k}:\s*"?(.*?)"?\s*$', fm, re.M)
            return m.group(1) if m else None
        src = field("source")
        if src:
            elements = re.search(r"^elements:\s*(\[.*\])\s*$", fm, re.M)
            known[src] = {"order": int(field("order") or 0), "cover": field("cover"),
                          "coverCrop": field("coverCrop"), "description": field("description") or "",
                          "style": field("style") or "", "voice": field("voice") or "",
                          "elements": elements.group(1) if elements else "[]"}
    return known


def photo_original(pid):
    md = os.path.join(PHOTO_CONTENT, f"{pid}.md")
    if not os.path.exists(md):
        sys.exit(f"no photograph {pid} (content/photography/{pid}.md)")
    text = open(md, encoding="utf-8").read()
    if not re.search(r'^collection:\s*"Ambiguous"', text, re.M):
        print(f"  note: {pid} is not in Ambiguous")
    src = re.search(r'^source:\s*"([^"]+)"', text, re.M).group(1)
    hits = [p for p in glob.glob(os.path.join(ORIGINALS, src + ".*"))]
    if not hits:
        sys.exit(f"original of {pid} ({src}) not found in {ORIGINALS}")
    return hits[0]


def font(px):
    tt = TTFont(FONT)
    tt.flavor = None  # WOFF -> plain TrueType, which Pillow reads
    buf = io.BytesIO()
    tt.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, px)


def make_cover(pid, crop, name, side, out):
    with Image.open(photo_original(pid)) as im:
        im = ImageOps.exif_transpose(im).convert("L")
        s = min(im.size)
        x0 = (im.width - s) // 2
        y0 = round((im.height - s) * crop)
        im = im.crop((x0, y0, x0 + s, y0 + s)).resize((SIZE, SIZE), Image.LANCZOS)
    f = font(round(SIZE * TEXT))
    m = round(SIZE * MARGIN)
    def letters(d, fill):
        d.text((m, SIZE - m), name, font=f, fill=fill, anchor="ls")
        if side:
            d.text((SIZE - m, m), side, font=f, fill=fill, anchor="rt")
    # a soft dark halo under the letters: invisible on black, keeps them readable where light crosses
    halo = Image.new("L", im.size, 0)
    letters(ImageDraw.Draw(halo), 255)
    halo = halo.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(10))
    im = Image.composite(Image.new("L", im.size, 0), im, halo.point(lambda v: int(min(255, v * 2) * 0.85)))
    letters(ImageDraw.Draw(im), 236)
    # a fresh save carries no tags; grey is all these photographs are
    im.save(out, "JPEG", quality=90, optimize=True, progressive=True)


def q(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--cover", action="append", default=[], help='"Title=photoN[@crop]"')
    args = ap.parse_args()

    chosen = {}
    for c in args.cover:
        t, _, spec = c.partition("=")
        pid, _, crop = spec.partition("@")
        chosen[t.strip()] = (pid.strip(), crop.strip() or "0.5")

    files = sorted(glob.glob(os.path.join(args.folder, "*.mp3")))
    if not files:
        sys.exit(f"no .mp3 in {args.folder}")
    songs = []
    for p in files:
        stem = os.path.splitext(os.path.basename(p))[0]
        n = re.search(r" \((\d+)\)$", stem)
        song = dict(read(p), path=p, source=stem, copy=int(n.group(1)) if n else 0)
        # A file Louis renamed carries the title he wants ("Near-Sacred.mp3" holds Suno's "Sacred
        # Near-Death"): the file name wins over the tag. The tag inside the MP3 stays as Suno wrote it.
        named = stem[:n.start()] if n else stem
        if named != song["title"]:
            print(f'  note: "{os.path.basename(p)}" is titled "{song["title"]}" inside; using "{named}"')
            song["title"] = named
        songs.append(song)

    # same title = sides of one song, in file order: no number = A, (1) = B, (2) = C ...
    by_title = {}
    for s in songs:
        by_title.setdefault(s["title"], []).append(s)
    for group in by_title.values():
        group.sort(key=lambda s: s["copy"])
        for i, s in enumerate(group):
            s["side"] = chr(ord("A") + i) if len(group) > 1 else ""
            s["slug"] = slugify(s["title"]) + (f"-{s['side'].lower()}" if s["side"] else "")

    # oldest first; the sides of one song together, B before A so A gets the higher order (shows first)
    songs.sort(key=lambda s: (min(x["made"] for x in by_title[s["title"]]), s["title"], -ord(s["side"] or "A")))
    known = existing()
    next_order = max((k["order"] for k in known.values()), default=0) + 1
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(CONTENT, exist_ok=True)

    for s in songs:
        kept = known.get(s["source"], {})
        order = kept.get("order")
        if not order:
            order, next_order = next_order, next_order + 1
        pick = chosen.get(s["title"]) or ((kept["cover"], kept.get("coverCrop") or "0.5") if kept.get("cover") else None)
        if not pick:
            sibling = next((known.get(x["source"]) for x in by_title[s["title"]] if known.get(x["source"], {}).get("cover")), None)
            pick = (sibling["cover"], sibling.get("coverCrop") or "0.5") if sibling else None
        if not pick:
            sys.exit(f'choose a cover for "{s["title"]}": --cover "{s["title"]}=photoN"')
        pid, crop = pick

        with open(s["path"], "rb") as fin, open(os.path.join(OUT_DIR, f"{s['slug']}.mp3"), "wb") as fout:
            fout.write(fin.read())
        make_cover(pid, float(crop), s["title"], s["side"], os.path.join(OUT_DIR, f"{s['slug']}.jpg"))

        lines = ["---", f'id: "{s["slug"]}"', f'title: {q(s["title"])}']
        if s["side"]:
            lines.append(f'side: "{s["side"]}"')
        lines += [f"order: {order}", f"year: {s['made'][:4] if s['made'][0] != '9' else '2026'}",
                  f"duration: {s['length']}",
                  # the Filters (set BY HAND per page from the song's Suno style prompt; re-runs keep them)
                  f'style: {q(kept.get("style", ""))}', f'elements: {kept.get("elements", "[]")}',
                  f'voice: {q(kept.get("voice", "") or ("Vocals" if s["words"] else "Instrumental"))}',
                  f'cover: "{pid}"', f"coverCrop: {crop}",
                  f'source: {q(s["source"])}', f'description: {q(kept.get("description", ""))}',
                  f'image: "{BASE}/{s["slug"]}.jpg"', f'audio: "{BASE}/{s["slug"]}.mp3"']
        if s["words"]:
            lines.append("words: |")
            lines += [("  " + l) if l else "" for l in s["words"].split("\n")]
        lines.append("---")
        with open(os.path.join(CONTENT, f"{s['slug']}.md"), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + "\n")
        m, sec = divmod(s["length"], 60)
        print(f"{order:>3}  {s['slug']:<24} {s['side'] or '-':<2} {m}:{sec:02d}  {pid}@{crop}  {s['made'][:16]}")


if __name__ == "__main__":
    main()
