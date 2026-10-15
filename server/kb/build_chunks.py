"""
Builds server/kb/chunks.json — the knowledge base the backend retrieves from.
Splits the two Pravilnik texts by "Član N" and the site content by "## " headings.
Run with: python3 -I server/kb/build_chunks.py
"""
import re
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))

def chunk_pravilnik(path, source_label, doc_title):
    text = open(path, encoding="utf-8").read()
    # Drop the Paragraf Lex header boilerplate that repeats before the real title.
    # Split on "Član <number><letters?>" headings (keeps the heading with its chunk).
    pattern = re.compile(r"(Član\s+\d+[a-zA-Z]?)\s*\n", re.UNICODE)
    parts = pattern.split(text)
    # parts alternates: [preamble, "Član 1", body1, "Član 2", body2, ...]
    chunks = []
    preamble = parts[0]
    i = 1
    while i < len(parts) - 1:
        heading = parts[i].strip()
        body = parts[i+1].strip()
        # Strip page-break markers like "--- strana 7 ---" from inside the body
        body_clean = re.sub(r"\n?---\s*strana\s*\d+\s*---\n?", "\n", body).strip()
        if body_clean:
            chunks.append({
                "source": source_label,
                "title": f"{doc_title}, {heading}",
                "text": f"{heading}\n{body_clean}"
            })
        i += 2
    return chunks

def chunk_site_content(path, source_label):
    text = open(path, encoding="utf-8").read()
    parts = re.split(r"\n(##\s+[^\n]+)\n", text)
    chunks = []
    i = 1
    while i < len(parts) - 1:
        heading = parts[i].replace("##", "").strip()
        body = parts[i+1].strip()
        if body:
            chunks.append({
                "source": source_label,
                "title": heading,
                "text": f"{heading}\n{body}"
            })
        i += 2
    return chunks

all_chunks = []
all_chunks += chunk_site_content(
    os.path.join(BASE, "site_content.md"),
    "sajt (autocentarbest.rs)"
)
all_chunks += chunk_pravilnik(
    os.path.join(BASE, "raw_tehnicki_pregled.txt"),
    "Pravilnik o tehničkom pregledu vozila (Sl. glasnik RS 31/2018, 70/2018, 62/2022)",
    "Pravilnik o tehničkom pregledu vozila"
)
all_chunks += chunk_pravilnik(
    os.path.join(BASE, "raw_podela_vozila.txt"),
    "Pravilnik o podeli motornih i priključnih vozila i tehničkim uslovima (Sl. glasnik RS, više izmena)",
    "Pravilnik o podeli vozila"
)

for idx, c in enumerate(all_chunks):
    c["id"] = f"c{idx+1}"

out_path = os.path.join(BASE, "chunks.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(all_chunks, f, ensure_ascii=False, indent=2)

print(f"Wrote {len(all_chunks)} chunks to {out_path}")
sources = {}
for c in all_chunks:
    sources[c["source"]] = sources.get(c["source"], 0) + 1
for s, n in sources.items():
    print(f"  {s}: {n} chunks")
