"""Build a local-install ZIP without hosting URLs or external dependencies."""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "module.json").read_text(encoding="utf-8"))
destination = root.parent / f"sheet-ping-{manifest['version']}.zip"
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob("*")):
        if not file.is_file() or any(p in {"node_modules", "__pycache__", ".git"} for p in file.parts):
            continue
        archive.write(file, Path("sheet-ping") / file.relative_to(root))
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert "sheet-ping/module.json" in archive.namelist()
print(destination)
