"""Turn a black-on-white signature drawing into a header/door logo (black on transparent).

    python scripts/make-logo.py <drawing.png> static/<name>.png

- Alpha comes from the darkness of each pixel (255 - grey), so the pen's soft edges stay soft; the colour is
  pure black, like logoold/halogo/odilogo (dark mode turns them white with a CSS invert).
- Near-white noise is dropped, and so are tiny specks (stray dots under SPECK_AREA pixels), not the i-dots.
- The sides are trimmed to the drawing plus MARGIN, the height is kept: Louis draws the signatures on the
  same 3240x1440 canvas, so keeping the height keeps every logo at the same handwriting size (the header
  scales them all to the same height). Its width ratio to 3240 is printed for the header CSS.
"""
import sys
from collections import deque

import numpy as np
from PIL import Image

NOISE = 8          # alpha below this (near-white) becomes fully transparent
SPECK_AREA = 60    # connected marks smaller than this many pixels are removed
MARGIN = 34        # px kept left and right of the drawing (halogo's own left margin)


def main(src, dst):
    grey = np.asarray(Image.open(src).convert("L"), dtype=np.int16)
    alpha = (255 - grey).clip(0, 255).astype(np.uint8)
    alpha[alpha < NOISE] = 0

    # Remove specks: label 8-connected marks, clear the small ones.
    h, w = alpha.shape
    seen = np.zeros(alpha.shape, dtype=bool)
    removed = 0
    for y0, x0 in zip(*np.nonzero(alpha)):
        if seen[y0, x0]:
            continue
        comp, q = [], deque([(y0, x0)])
        seen[y0, x0] = True
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and alpha[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        if len(comp) < SPECK_AREA:
            ys, xs = zip(*comp)
            alpha[list(ys), list(xs)] = 0
            removed += 1

    cols = np.nonzero(alpha.any(axis=0))[0]
    left, right = max(0, cols[0] - MARGIN), min(w, cols[-1] + 1 + MARGIN)
    out = np.zeros((h, right - left, 4), dtype=np.uint8)
    out[..., 3] = alpha[:, left:right]
    Image.fromarray(out, "RGBA").save(dst, optimize=True)
    print(f"{dst}: {right - left}x{h}, {removed} speck(s) removed, width ratio to 3240 = {(right - left) / 3240:.4f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
