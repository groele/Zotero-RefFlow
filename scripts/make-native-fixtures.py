"""Deterministic text-layer PDFs for native Zotero regression (no third-party libraries)."""
from pathlib import Path
import sys

def make_pdf(path, pages):
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    children = []
    for rows in pages:
        page_id = len(objects) + 1
        children.append(f"{page_id} 0 R")
        content_id = page_id + 1
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode())
        parts = []
        for x, y, text in rows:
            escaped = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            parts.append(f"BT /F1 10 Tf 1 0 0 1 {x} {y} Tm ({escaped}) Tj ET")
        stream = '\n'.join(parts).encode('ascii')
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    objects[1] = f"<< /Type /Pages /Count {len(pages)} /Kids [{' '.join(children)}] >>".encode()
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(pdf)
    pdf.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF".encode())
    path.write_bytes(pdf)

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'tests/native-fixtures')
out.mkdir(parents=True, exist_ok=True)
make_pdf(out/'single.pdf', [[(40,740,'References')] + [(40,710-i*36,f'[{i+1}] Smith, J. Citation fixture {i+1}. Journal A, 2024.') for i in range(4)]])
make_pdf(out/'columns.pdf', [[(40,750,'References')] + [(x,720-i*45,f'[{offset+i+1}] Smith, J. Column citation {offset+i+1}.') for x,offset in [(40,0),(330,3)] for i in range(3)] + [(x,705-i*45,'Journal A, 2024. DOI: 10.1234/fixture'+str(offset+i+1)) for x,offset in [(40,0),(330,3)] for i in range(3)]])
make_pdf(out/'author-year.pdf', [[(40,740,'Bibliography'), (40,710,'Smith, J., Doe, A. (2024). First author-year citation.'), (40,695,'Journal A, 10, 123-130.'), (40,665,'Brown, A. B. (2023). Second author-year citation.'), (40,650,'Journal B, 20, 200-210.'), (40,620,'Lee, K., and Chen, Q. (2022). Third author-year citation.'), (40,605,'Journal C, 30, 300-310.')]])
make_pdf(out/'numbered-prose.pdf', [[(40,740,'Procedure'), (40,710,'1. Heat the sample for two minutes.'), (40,680,'2. Cool the sample and measure the current.'), (40,650,'3. Record the observation and repeat the steps.')]])
make_pdf(out/'large.pdf', [[(40,740,f'Body page {i+1}'),(40,710,'This body text has no bibliography.')] for i in range(119)] + [[(40,740,'References')] + [(40,710-i*25,f'[{i+1}] Smith, J. Large document citation {i+1}. Journal A, 2024.') for i in range(12)]])
print(f'Wrote 5 fixture PDFs to {out.resolve()}')
