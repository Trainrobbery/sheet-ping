"""Build either a source ZIP or an installable Foundry release bundle."""
import argparse
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "module.json").read_text(encoding="utf-8"))
parser = argparse.ArgumentParser()
parser.add_argument("--release", action="store_true", help="Write dist/sheet-ping.zip and dist/module.json for FVTT URL installation")
args = parser.parse_args()
destination = root / "dist" / "sheet-ping.zip" if args.release else root.parent / f"sheet-ping-{manifest['version']}.zip"
destination.parent.mkdir(parents=True, exist_ok=True)
excluded = {"node_modules", "__pycache__", ".git", "dist", "test-results", "playwright-report"}
if args.release:
    excluded |= {"tests", "tools", "docs", ".github"}
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob("*")):
        relative = file.relative_to(root)
        if not file.is_file() or any(p in excluded for p in relative.parts) or file.suffix == ".zip":
            continue
        if args.release and relative.parts[0].startswith("."):
            continue
        archive.write(file, relative if args.release else Path("sheet-ping") / relative)
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    prefix = "" if args.release else "sheet-ping/"
    assert prefix + "module.json" in archive.namelist()
    assert json.loads(archive.read(prefix + "module.json")) == manifest
    paths = [*manifest.get("esmodules", []), *manifest.get("styles", []),
             *(entry["path"] for entry in manifest.get("languages", [])), manifest["readme"]]
    assert all(prefix + name in archive.namelist() for name in paths)
    assert all(not name.startswith("/") and ".." not in Path(name).parts for name in archive.namelist())
if args.release:
    (destination.parent / "module.json").write_bytes((root / "module.json").read_bytes())
print(destination)
