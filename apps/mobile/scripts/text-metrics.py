#!/usr/bin/env python3
"""Compare glyph placement of the metrics probe with the storyboard PNG (BUILD.md §6.1.3).

Usage: text-metrics.py <storyboard.png> <capture.png> <x,y,w,h in dp> [...]
For each rectangle it finds the bounding box of the ink (pixels that differ from the background at the rect's
top-left corner) in both images at 2 px per dp and prints the offsets in dp: capture minus storyboard.
"""
import sys
from PIL import Image, ImageChops

def ink(img, rect):
    x, y, w, h = [int(round(v * 2)) for v in rect]
    crop = img.crop((x, y - 12, x + w, y + h + 12))
    bg = Image.new('RGB', crop.size, crop.getpixel((0, 0)))
    diff = ImageChops.difference(crop, bg).convert('L').point(lambda p: 255 if p > 40 else 0)
    box = diff.getbbox()
    return None if not box else (box[0] / 2, (box[1] - 12) / 2, box[2] / 2, (box[3] - 12) / 2)

design = Image.open(sys.argv[1]).convert('RGB')
actual = Image.open(sys.argv[2]).convert('RGB').resize(design.size, Image.LANCZOS)
for arg in sys.argv[3:]:
    rect = [float(v) for v in arg.split(',')]
    d, a = ink(design, rect), ink(actual, rect)
    if not d or not a:
        print(arg, 'no ink', d, a); continue
    print(f"{arg:>18}  left {a[0]-d[0]:+.1f}  top {a[1]-d[1]:+.1f}  right {a[2]-d[2]:+.1f}  bottom {a[3]-d[3]:+.1f}   (design ink top {d[1]:.1f} bottom {d[3]:.1f} of {rect[3]})")
