#!/usr/bin/env python3
"""Install owner-approved raster evidence policy; never alter PNGs or geometry tolerances.

Usage: python3 tooling/android/prepare-fidelity.py <handoff-directory>
Scaled-text corrections are generated separately by export-scaled-layout.mjs.
"""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

ORIGINAL_COMPARATOR = "15670b31ff0113dd3e02b984f2ff1e05d15050221ab551bab1da4819aa2a1a09"
RASTERS = {
    "B1-Overview": (15, "page-resume-B1.png"),
    "B6-Design": (15, "page-resume-B6.png"),
    "B18-Preview": (10, "page-resume-full.png"),
    "P1-Public": (8, "page-public-full.png"),
    "B7-Template": (14, "thumb-template-onyx.png"),
    "B11-Share": (13, "thumb-resume-B11.png"),
    "L2-LetterDesign": (11, "thumb-letter-L2.png"),
}


def annotate(layout, number, fixture, image):
    """Annotate only actual descendants of the proven raster, using exporter depth."""
    active = False
    parent = next(e for e in layout["elements"] if e["n"] == number)
    parent["raster"] = dict(width=image.width, height=image.height,
        rgbaSha256=hashlib.sha256(image.convert("RGBA").tobytes()).hexdigest(), fixture=fixture)
    for element in layout["elements"]:
        if element is parent:
            active = True
        elif active:
            if element["depth"] <= parent["depth"]:
                active = False
            else:
                element["rasterParent"] = number
    return layout


def prepare(bundle):
    root = Path(__file__).resolve().parents[2]
    tool = bundle / "tools/layout_compare.py"
    replacement = Path(__file__).with_name("layout_compare.py").read_bytes()
    current = tool.read_bytes()
    if current != replacement:
        if hashlib.sha256(current).hexdigest() != ORIGINAL_COMPARATOR:
            raise ValueError("Unknown layout comparator; refusing to overwrite foreign changes")
        tool.with_suffix(".original.py").write_bytes(current)
        tool.write_bytes(replacement)
    corrections = json.loads(Path(__file__).with_name("scaled-layout-corrections.json").read_text())
    for correction in corrections:
        path = bundle / "design/layout" / f"{correction['id']}.json"
        layout = json.loads(path.read_text())
        for change in correction["fields"]:
            element = next(e for e in layout["elements"] if e["n"] == change["n"])
            current = {key: element[key] for key in change["before"]}
            if current not in (change["before"], change["after"]):
                raise ValueError(f"Unknown scaled text change: {correction['id']} n={change['n']}")
            element.update(change["after"])
        path.write_text(json.dumps(layout, indent=1, ensure_ascii=False) + "\n")
    for screen, (number, fixture) in RASTERS.items():
        source = bundle / "design/fixtures" / fixture
        packaged = root / "apps/android/core/page/src/main/resources/storyboard" / fixture
        if source.read_bytes() != packaged.read_bytes():
            raise ValueError(f"Packaged fixture differs: {fixture}")
        path = bundle / "design/layout" / f"{screen}.json"
        layout = json.loads(path.read_text())
        annotate(layout, number, fixture, Image.open(source))
        path.write_text(json.dumps(layout, indent=1, ensure_ascii=False) + "\n")
    print(f"Verified {len(RASTERS)} immutable fixtures; installed exact raster evidence policy")


if __name__ == "__main__":
    prepare(Path(sys.argv[1]).resolve())
