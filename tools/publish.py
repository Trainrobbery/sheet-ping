"""Publish the prepared bundle from the authorized GitHub Actions release job."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
manifest_bytes = (dist / "module.json").read_bytes()
manifest = json.loads(manifest_bytes)
version = manifest["version"]
if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
    raise ValueError("Invalid release version")
tag = f"v{version}"
repository = os.environ["GITHUB_REPOSITORY"]
assert repository == "Trainrobbery/sheet-ping"
assert manifest["manifest"] == "https://raw.githubusercontent.com/Trainrobbery/sheet-ping/main/module.json"
assert manifest["download"] == f"https://github.com/{repository}/releases/download/{tag}/sheet-ping.zip"
bundle = dist / "sheet-ping.zip"

# Notes are read from a file, never interpolated into a shell command.
changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
section = next((part for part in changelog.split("\n## ")[1:] if part.startswith(version + " ")), None)
if section is None:
    raise ValueError("No changelog section for this version")
notes = dist / "RELEASE-NOTES.md"
notes.write_text(section.split("\n", 1)[1].strip() + "\n\n"
                 "설치 매니페스트: " + manifest["manifest"] + "\n\n"
                 "대상: Foundry VTT 13.351 / D&D5e 5.3.3. 알파 버전이며 실제 FVTT 검증은 미완료입니다.\n",
                 encoding="utf-8")

def gh(*arguments, capture=False, check=True):
    return subprocess.run(["gh", *arguments], cwd=root, text=True, check=check,
                          capture_output=capture)

existing = gh("release", "view", tag, "--json", "isDraft,url", capture=True, check=False)
if existing.returncode == 0:
    release = json.loads(existing.stdout)
    if not release["isDraft"]:
        raise RuntimeError("This version is already published. Bump the version instead of replacing it.")
    gh("release", "upload", tag, str(bundle), str(dist / "module.json"), "--clobber")
else:
    arguments = ["release", "create", tag, str(bundle), str(dist / "module.json"),
                 "--target", os.environ["GITHUB_SHA"], "--title", f"Sheet Ping {version}",
                 "--notes-file", str(notes), "--draft"]
    if "-" in version:
        arguments += ["--prerelease", "--latest=false"]
    gh(*arguments)

# Both files have uploaded while the release is a draft. Now make it public.
gh("release", "edit", tag, "--draft=false")

def public_download(url):
    # No Authorization header or GitHub credentials: verify anonymous installs.
    error = None
    for attempt in range(6):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Sheet-Ping-release-check"})
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except Exception as exc:
            error = exc
            if attempt < 5:
                time.sleep(3)
    raise error

release_manifest_url = f"https://github.com/{repository}/releases/download/{tag}/module.json"
assert json.loads(public_download(release_manifest_url)) == manifest
download = public_download(manifest["download"])
assert hashlib.sha256(download).digest() == hashlib.sha256(bundle.read_bytes()).digest()
with zipfile.ZipFile(io.BytesIO(download)) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read("module.json")) == manifest
print(f"Published and anonymously verified https://github.com/{repository}/releases/tag/{tag}")
