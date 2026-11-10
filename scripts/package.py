"""Package the built extension and offline viewer for a GitHub release."""

import argparse
import json
import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path, help="Directory for the release assets")
args = parser.parse_args()

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
manifest = json.loads((dist / "manifest.json").read_text(encoding="utf-8"))
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
if manifest["version"] != version:
    parser.error("Run npm run build before packaging this version.")

args.output.mkdir(parents=True, exist_ok=True)
offline_viewer = dist / "capsule-viewer.html"
shutil.copyfile(offline_viewer, args.output / offline_viewer.name)
archive = args.output / f"localhost-dashcam-{version}.zip"
with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
    for path in sorted(dist.iterdir()):
        if path.is_file() and path != offline_viewer:
            bundle.write(path, path.name)
print(archive)
