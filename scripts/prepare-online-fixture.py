"""Fetch and verify the public PDF required by native-online.js."""
from pathlib import Path
import hashlib
import urllib.request

URL = "https://arxiv.org/pdf/1706.03762"
SHA256 = "bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697"
TARGET = Path(__file__).resolve().parent.parent / "tests/native-fixtures/real-arxiv-1706.03762.pdf"

def prepare():
    if TARGET.exists():
        if hashlib.sha256(TARGET.read_bytes()).hexdigest() != SHA256:
            raise RuntimeError("Existing PDF differs from the verified fixture; preserve it and inspect manually")
        print("Verified existing public PDF fixture")
        return
    req = urllib.request.Request(URL, headers={"User-Agent": "RefFlow-native-acceptance"})
    with urllib.request.urlopen(req, timeout=60) as response:
        data = response.read(8 * 1024 * 1024 + 1)
    if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != SHA256:
        raise RuntimeError("Public PDF changed or download was incomplete; no fixture was written")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with TARGET.open("xb") as stream:
        stream.write(data)
    print("Downloaded and verified public PDF fixture")

if __name__ == "__main__":
    prepare()
