"""Extract auditable Beast / Pact of the Chain stat blocks from the supplied SRD.
Requires PyMuPDF. Run: python scripts/import-srd-shapes.py [source.pdf]
"""
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import fitz

source = Path(sys.argv[1] if len(sys.argv) > 1 else "SRD_CC_v5.2.1.pdf")
document = fitz.open(source)
special = {"Imp", "Pseudodragon", "Quasit", "Skeleton", "Sphinx of Wonder", "Sprite", "Venomous Snake"}
forms = []
current = None

def flush():
    global current
    if not current:
        return
    text = "\n".join(current.pop("lines"))
    cr = re.search(r"(?m)^CR (\d+(?:/\d+)?)\b", text)
    creature = text.splitlines()[0] if text else ""
    is_beast = bool(re.search(r"\bBeasts?\b", creature))
    if cr and (is_beast or current["name"] in special):
        speed = re.search(r"Speed ([\s\S]*?)(?:MOD SAVE|Str\s+\d)", text)
        current.update({
            "id": "shape-" + re.sub(r"[^a-z0-9]+", "-", current["name"].lower()).strip("-"),
            "text": text,
            "cr": float(Fraction(cr[1])),
            "crLabel": cr[1],
            "creatureType": creature,
            "beast": is_beast,
            "swarm": "Swarm" in creature,
            "fly": bool(speed and re.search(r"\bFly \d", speed[1])),
            "pactChain": current["name"] in special,
        })
        forms.append(current)
    current = None

for index in range(257, len(document)):
    for block in document[index].get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            if text == "System Reference Document 5.2.1" or (text.strip() == str(index+1) and all(abs(span["size"]-11)<0.1 for span in line["spans"])):
                continue
            heading = any(span["font"] == "GillSans-SemiBold" and 14.4 < span["size"] < 15.2 for span in line["spans"])
            if heading:
                if current and not current["lines"] and current["endPage"] == index+1:
                    current["name"] += " " + text
                else:
                    flush()
                    current = {"name": text, "page": index+1, "endPage": index+1, "lines": []}
            elif current:
                current["lines"].append(text)
                current["endPage"] = index+1
flush()
# The Figurine of Wondrous Power includes an additional eligible Beast stat
# block outside the Monsters chapter. Its 12pt heading differs from monster
# headings; end it at CR so following figurine variants aren't swallowed.
fly_lines = [line.strip() for line in document[221].get_text().splitlines()]
start = fly_lines.index("Giant Fly")
end = next(i for i in range(start+1, len(fly_lines)) if fly_lines[i].startswith("CR "))
current = {"name": "Giant Fly", "page": 222, "endPage": 222, "lines": fly_lines[start+1:end+1]}
flush()
assert special <= {form["name"] for form in forms}, special - {form["name"] for form in forms}
assert len({form["id"] for form in forms}) == len(forms)
manifest = {
    "source": source.name,
    "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "sourcePages": "SRD Monsters pp.258–364 and Giant Fly stat block p.222; class limits p.42, Find Familiar description and Pact of the Chain p.74",
    "counts": {"beastStatBlocks": sum(form["beast"] for form in forms), "pactChainSpecials": len(special), "totalDistinct": len(forms)},
    "verification": "Printed stat-block headings, CR and Fly Speed are retained and regression-tested. Not independent proof of catalog completeness. Swarms are exposed as source records but excluded from strict single-Beast Wild Shape selection; ask the GM about ambiguous eligibility.",
}
out = Path("src/lib/srd-data")
(out/"shapes.json").write_text(json.dumps(forms, ensure_ascii=False, indent=2)+"\n",encoding="utf-8")
(out/"shapes-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n",encoding="utf-8")
subprocess.run(["node","node_modules/prettier/bin/prettier.cjs","--write",str(out/"shapes*.json")],check=True)
print(json.dumps(manifest,indent=2))
