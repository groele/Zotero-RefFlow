"""Remove machine-specific locations from JSON verification records."""
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
if not root.is_dir():
    raise SystemExit(f"Evidence directory does not exist: {root}")

patterns = [
    (re.compile(r"(?i)[A-Z]:/Users/[^/]+/AppData/Local/Temp/refnexus-z10-release-[^/\s:]+"), "<isolated-zotero-profile>"),
    (re.compile(r"(?i)<local-user>/AppData/Local/Temp/refnexus-z10-release-[^/\s:]+"), "<isolated-zotero-profile>"),
    (re.compile(r"(?i)[A-Z]:/Users/[^/]+/AppData/Local/Temp"), "<local-temp>"),
    (re.compile(r"(?i)<local-user>/AppData/Local/Temp"), "<local-temp>"),
    (re.compile(r"(?i)[A-Z]:/Users/[^/]+"), "<local-user>"),
    (re.compile(r"(?i)[A-Z]:/Dev Studio/Reference in zotero/zotero-reference"), "<source-checkout>"),
    (re.compile(r"(?i)[A-Z]:/Dev Studio/zotero-diy-refnexus-v11\.0\.2"), "<release-worktree>"),
]

def scrub(value):
    if isinstance(value, str):
        value = value.replace("\\", "/")
        value = re.sub(r"/{2,}", "/", value)
        for pattern, replacement in patterns:
            value = pattern.sub(replacement, value)
        return value
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, dict):
        return {key: scrub(item) for key, item in value.items()}
    return value

for path in root.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in {".json", ".log", ".txt"}:
        continue
    text = path.read_text(encoding="utf-8-sig")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        value = None
    if value is not None or path.suffix.lower() == ".json":
        if value is None:
            raise SystemExit(f"Invalid JSON evidence: {path}")
        path.write_text(json.dumps(scrub(value), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        text = scrub(text)
        text = re.sub(r"(?i)[A-Z]:\\\\Users\\\\[^\\\s]+", "<local-user>", text)
        text = re.sub(r"(?i)[A-Z]:\\\\Dev Studio\\\\Reference in zotero\\\\zotero-reference", "<source-checkout>", text)
        path.write_text(text, encoding="utf-8")

print(f"Sanitized JSON evidence below {root}")
