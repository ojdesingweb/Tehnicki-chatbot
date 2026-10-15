"""
Builds server/kb/chunks.json — the knowledge base the backend retrieves from.
Splits the two Pravilnik texts by "Član N" and the site content by "## " headings.
Run with: python3 -I server/kb/build_chunks.py
"""
import re
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))

# The backend truncates each retrieved chunk's text to a few hundred
# characters before sending it to the (free-tier, rate-limited) AI model, so
# a chunk longer than this would get cut off before reaching content further
# down (e.g. a numeric table near the end of a long legal article) — the
# model would then never see the actual answer. To avoid that, any article
# body longer than this target gets split into smaller sub-chunks on
# paragraph boundaries below, so retrieval can land directly on the
# paragraph that has the real content instead of always starting from the
# top of a long article.
MAX_SUBCHUNK_CHARS = 500

def pack_units(units, max_chars, joiner):
    """Greedily pack a list of text units (paragraphs or lines) into pieces
    no longer than max_chars, without ever splitting a unit in half. A
    single unit longer than max_chars is kept whole as its own piece (the
    caller may split it further by a smaller unit)."""
    pieces = []
    current = ""
    for u in units:
        candidate = (current + joiner + u) if current else u
        if len(candidate) <= max_chars or not current:
            current = candidate
        else:
            pieces.append(current)
            current = u
    if current:
        pieces.append(current)
    return pieces

def split_long_body(body, max_chars):
    """Split body into pieces close to max_chars, without ever cutting a
    line in half. Some legal articles are mostly one big table with no
    blank lines in it at all (so paragraph-splitting alone wouldn't break
    it up), so this first packs by paragraph (blank-line groups) and then,
    for any resulting piece still over max_chars (e.g. one huge table),
    re-packs that piece line-by-line so it still gets split down further."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    pieces = pack_units(paragraphs, max_chars, "\n\n")
    final_pieces = []
    for piece in pieces:
        if len(piece) <= max_chars:
            final_pieces.append(piece)
        else:
            lines = [l for l in piece.split("\n") if l.strip()]
            final_pieces.extend(pack_units(lines, max_chars, "\n"))
    return final_pieces

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
        if not body_clean:
            i += 2
            continue
        if len(body_clean) <= MAX_SUBCHUNK_CHARS:
            chunks.append({
                "source": source_label,
                "title": f"{doc_title}, {heading}",
                "text": f"{heading}\n{body_clean}"
            })
        else:
            pieces = split_long_body(body_clean, MAX_SUBCHUNK_CHARS)
            n = len(pieces)
            for idx, piece in enumerate(pieces, start=1):
                chunks.append({
                    "source": source_label,
                    "title": f"{doc_title}, {heading} (deo {idx}/{n})",
                    # Repeat the heading in every sub-chunk's text too, so a
                    # query that names the article number still matches
                    # whichever piece actually has the relevant paragraph.
                    "text": f"{heading}\n{piece}"
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
