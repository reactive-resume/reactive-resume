#!/usr/bin/env python3
"""Prepare the published wrappers for a rebuilt Forme engine."""
import base64
import hashlib
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

vendor = Path(sys.argv[1]).resolve()
if vendor.exists():
    raise SystemExit("Choose a fresh vendor directory")

with urllib.request.urlopen("https://registry.npmjs.org/@formepdf%2fcore/0.26.0", timeout=30) as response:
    metadata = json.load(response)
with urllib.request.urlopen(metadata["dist"]["tarball"], timeout=30) as response:
    archive = response.read()
algorithm, encoded = metadata["dist"]["integrity"].split("-", 1)
if hashlib.new(algorithm, archive).digest() != base64.b64decode(encoded):
    raise SystemExit("Published package integrity check failed")

with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
    for item in package:
        relative = Path(item.name).relative_to("package")
        if ".." in relative.parts:
            raise SystemExit("Invalid package path")
        if item.isfile():
            source = package.extractfile(item)
            if source is None:
                raise SystemExit("Missing package file")
            target = vendor / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read())
            target.chmod(item.mode)

manifest_path = vendor / "package.json"
manifest = json.loads(manifest_path.read_text())
manifest["version"] = "0.26.0+reactive.1"
manifest["files"].append("REACTIVE_RESUME_BUILD.md")
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
(vendor / "REACTIVE_RESUME_BUILD.md").write_text(
    "# Reactive Resume PDF engine build\n\n"
    "JavaScript and TypeScript wrapper files remain from published @formepdf/core 0.26.0.\n"
    "Generated Node, web, and bundler WASM bindings use Forme engine commit\n"
    "86f0d67781c6265e3796995a7755ddc62b980d67 (v0.26.0), plus Reactive Resume Unicode mapping fixes.\n"
    "The engine source patch and build recipe live with the vendored artifact.\n\n"
    "Changes preserve source text in Unicode CMaps, distinct CIDs for contextual glyph mappings,\n"
    "and supplementary-plane font coverage. Non-text cluster glyphs keep their shaped outlines;\n"
    "combining and RTL source suffixes use invisible font text so independent extraction stays intact.\n"
    "Fallback measurement and positioning use the same font segments; shaping controls stay with\n"
    "the base font. RTL lines with leading marks use standard Form XObjects to isolate text context.\n"
)
if not (vendor / "LICENSE").exists():
    (vendor / "LICENSE").write_bytes((vendor / "pkg" / "LICENSE").read_bytes())
print(vendor)
