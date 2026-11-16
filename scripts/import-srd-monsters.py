"""Import EVERY printed creature stat block, including spell/item creatures.

Requires PyMuPDF. No network or third-party rules dataset.
Run: python scripts/import-srd-monsters.py [SRD_CC_v5.2.1.pdf] [--check]
--check compares the generated files without writing them.
"""
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
import sys
import fitz

source = Path(next((arg for arg in sys.argv[1:] if arg != "--check"), "SRD_CC_v5.2.1.pdf"))
document = fitz.open(source)
records = []
current = None
heading_count = 0

def prose(text):
    return re.sub(r"([a-z])-\n([a-z])", r"\1\2", text).replace("\u00ad", "").replace("\u00a0", " ")

def flush():
    global current
    if current:
        lines = current.pop("lines")
        current["text"] = "\n".join(line["text"] for line in lines).strip()
        text = prose(current["text"])
        cr = re.search(r"(?m)^CR (\d+(?:/\d+)?)\b", text)
        current["crLabel"] = cr[1] if cr else "Special"
        current["cr"] = float(Fraction(cr[1])) if cr else None
        current["creatureType"] = lines[0]["text"].strip()
        current["id"] = "monster-" + re.sub(r"[^a-z0-9]+", "-", current["name"].lower()).strip("-")
        # Preserve each paragraph verbatim; normalized controls never replace source.
        current["actions"] = []
        section = "Statistics"
        action = None
        for line in lines:
            if line["section"]:
                section = line["text"].strip()
                action = None
            elif line["action"] and not (action and not re.search(r"\.\s|\.$", action["text"])):
                action = {"section": section, "text": line["text"]}
                current["actions"].append(action)
            elif action:
                action["text"] += "\n" + line["text"]
        for action in current["actions"]:
            action["text"] = prose(action["text"]).strip()
            action["name"] = re.split(r"\.\s", action["text"], maxsplit=1)[0].replace("\n", " ").rstrip(".")
        # Each source block must contain a type, AC, HP and the complete ability table.
        assert re.search(r"(?m)^AC ", text), current["name"]
        assert re.search(r"(?m)^HP ", text), current["name"]
        assert all(re.search(r"\b" + key + r"\s", text) for key in ["Str", "Dex", "Con", "Int", "Wis", "Cha"]), current["name"]
        records.append(current)
    current = None

for index, page in enumerate(document):
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = line["spans"]
            text = "".join(span["text"] for span in spans)
            if text == "System Reference Document 5.2.1" or (
                text.strip() == str(index + 1) and all(abs(s["size"] - 11) < .1 for s in spans)
            ):
                continue
            heading = any(s["font"] == "GillSans-SemiBold" and 14.4 < s["size"] < 15.2 for s in spans)
            if heading:
                if current and not current["lines"]:
                    current["name"] += " " + text
                else:
                    flush()
                    heading_count += 1
                    current = {"name": text, "page": index + 1, "endPage": index + 1, "lines": []}
            elif current:
                # Ordinary prose and chapter/species headings are not stat-block content.
                if any(s["font"].startswith("Cambria") or
                       (s["font"] == "GillSans-SemiBold" and s["size"] >= 12) for s in spans):
                    flush()
                    continue
                current["lines"].append({
                    "text": text,
                    "section": any(s["font"] == "GillSans" and 11.9 < s["size"] < 12.1 for s in spans),
                    "action": bool(spans and spans[0]["font"] == "Optima-BoldItalic"),
                })
                current["endPage"] = index + 1
flush()
assert len(records) == heading_count
assert len({r["id"] for r in records}) == len(records)
# Independent inventory: every creature-type line immediately preceding AC must
# belong to an extracted heading. Catches font/heading extraction omissions.
type_count = 0
for page in document:
    lines = page.get_text().splitlines()
    for i, line in enumerate(lines[:-1]):
        if re.match(r"^(?:Tiny|Small|Medium|Large|Huge|Gargantuan|[A-Z][a-z]+ or [A-Z][a-z]+|Swarm of)\b", line) and re.match(r"^AC ", lines[i+1]):
            type_count += 1
assert type_count == len(records), (type_count, len(records))
manifest = {
    "source": source.name,
    "version": "5.2.1",
    "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "count": len(records),
    "statBlockHeadings": heading_count,
    "independentTypeAndAcCount": type_count,
    "outsideMonstersChapter": [r["id"] for r in records if r["page"] < 258],
    "verification": "Every printed 14.8pt stat-block heading and independent type/AC pair counted; raw text retained, controls derived separately. PDF line wrapping retained in source.",
}
out = Path("src/lib/srd-data")
for filename, value in [("monsters.json", records), ("monsters-manifest.json", manifest)]:
    path = out / filename
    if "--check" in sys.argv:
        assert json.loads(path.read_text(encoding="utf-8")) == value, f"{path} differs; rerun importer"
    else:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifest, indent=2))
