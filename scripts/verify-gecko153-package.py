"""Verify the evaluation XPI without promoting a package or update manifest."""
from hashlib import sha256
from pathlib import Path
import json
import re
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
xpi = root / "build" / (package["name"] + ".xpi")
with ZipFile(xpi) as archive:
    assert archive.testzip() is None, "Corrupt archive"
    entries = [entry for entry in archive.namelist() if not entry.endswith("/")]
    for entry in entries:
        assert archive.read(entry) == (root / "build" / "addon" / entry).read_bytes(), entry
        assert not re.search(r"(^|/)(tests|node_modules|\.git)(/|$)", entry), entry
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["version"] == package["version"]
    assert manifest["applications"]["zotero"]["id"] == package["config"]["addonID"]
    assert manifest["applications"]["zotero"]["strict_max_version"] == "11.*"
    preferences = archive.read("chrome/content/preferences.xhtml").decode()
    prefs_script = archive.read("chrome/content/scripts/preferences.js").decode()
    bootstrap = archive.read("bootstrap.js").decode()
    bundle = archive.read("chrome/content/scripts/refflow.js").decode()
    assert not re.search(r"\son(?:load|click|command)\s*=", preferences, re.I)
    assert "zotero-prefpane-refflow" in prefs_script and "Zotero.ZoteroRefFlow" in prefs_script
    assert not re.search(r"__(addonRef|addonInstance|buildVersion)__", preferences + prefs_script + bootstrap)
    assert "defaultXUL: true" in bundle
    assert "prototype.constructor = constructor" not in bundle
    assert not re.search(r"ownerGlobal|CheckboxStateChange|\.findLogins\(|\.searchLogins\(", bundle)
    assert not re.search(r'setAttribute\("(?:hidden|checked|disabled|selected|collapsed)",\s*(?:String\(|false)', bundle)

result = {"version": manifest["version"], "addonID": package["config"]["addonID"],
          "filesVerified": len(entries), "bytes": xpi.stat().st_size,
          "sha256": sha256(xpi.read_bytes()).hexdigest(),
          "compatibility": manifest["applications"]["zotero"], "evaluationOnly": True}
update_path = root / "build" / "update.json"
if update_path.exists():
    update = json.loads(update_path.read_text(encoding="utf-8"))["addons"][package["config"]["addonID"]]["updates"][0]
    assert update["version"] == package["version"]
    assert update["update_hash"] == "sha256:" + result["sha256"]
    assert update["applications"]["zotero"]["strict_max_version"] == "11.*"
(root / "build" / "verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
