"""Read the installed Zotero source archive without changing the installation."""
import json
import zipfile
from pathlib import Path

target = Path(__file__).resolve().parent.parent / 'docs/evidence/dataflow-2026-10-12/host'
target.mkdir(parents=True, exist_ok=True)
names = ['pdfWorker.js', 'pdfWorkerManager.js', 'reader.js', 'itemPaneManager.js', 'menuManager.js',
         'search.js', 'items.js', 'item.js', 'db.js', 'http.js', 'retractions.js', 'translate.js']
inventory = []
with zipfile.ZipFile(r'C:\Program Files\Zotero\app\omni.ja') as archive:
    for name in archive.namelist():
        if name == 'chrome/content/zotero/xpcom/pdfWorker/manager.js':
            data = archive.read(name)
            output = target / 'pdfWorkerManager.js'
            output.write_bytes(data)
            inventory.append({'archiveEntry':name,'output':str(output),'bytes':len(data)})
            continue
        if not name.startswith('chrome/content/zotero/xpcom/') or '/translate/src/http.js' in name:
            continue
        if name.rsplit('/', 1)[-1] not in names:
            continue
        data = archive.read(name)
        output = target / name.rsplit('/', 1)[-1]
        output.write_bytes(data)
        inventory.append({'archiveEntry': name, 'output': str(output), 'bytes': len(data)})
(target / 'inventory.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
print(json.dumps(inventory, indent=2))
with zipfile.ZipFile(r'C:\Program Files\Zotero\app\omni.ja') as archive:
    print('PDF worker entries:', [name for name in archive.namelist() if 'pdf' in name.lower() and 'worker' in name.lower() and 'xpcom/' in name])
