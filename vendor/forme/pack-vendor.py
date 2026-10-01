#!/usr/bin/env python3
"""Pack wrappers and generated bindings without removing SemVer build metadata."""
import gzip
import io
import sys
import tarfile
from pathlib import Path

vendor = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
allowed = ["dist", "pkg", "pkg-web", "pkg-node", "scripts", "LICENSE", "README.md", "REACTIVE_RESUME_BUILD.md", "package.json"]
files = []
for name in allowed:
    path = vendor / name
    if path.is_dir():
        files.extend(file for file in path.rglob("*") if file.is_file() and file.name != ".gitignore")
    elif path.is_file():
        files.append(path)

with output.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
    with tarfile.open(fileobj=zipped, mode="w") as archive:
        for path in sorted(set(files)):
            data = path.read_bytes()
            info = tarfile.TarInfo("package/" + path.relative_to(vendor).as_posix())
            info.size = len(data)
            info.mode = path.stat().st_mode & 0o777
            info.mtime = 0
            archive.addfile(info, io.BytesIO(data))
print(output)
