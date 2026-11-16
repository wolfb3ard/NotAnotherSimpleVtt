"""Reproduce the SRD catalog from the supplied PDF (requires PyMuPDF).

Usage: python scripts/import-srd.py [path/to/SRD_CC_v5.2.1.pdf]
No network, third-party rules dataset, or proprietary PHB content is used.
"""
import collections
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import fitz

source = Path(sys.argv[1] if len(sys.argv) > 1 else "SRD_CC_v5.2.1.pdf")
document = fitz.open(source)
out = Path("src/lib/srd-data")
out.mkdir(parents=True, exist_ok=True)

def clean(text):
    return re.sub(r"([a-z])-\n([a-z])", r"\1\2", text).replace("\u00ad", "")

def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

pages = []
events = []
previous_heading_size = None
for index in range(len(document)):
    page = document[index]
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = line["spans"]
            text = "".join(s["text"] for s in spans)
            # Running page headers are not part of the licensed rules entry.
            if text == "System Reference Document 5.2.1" or (
                text.strip() == str(index + 1) and all(abs(s["size"] - 11) < 0.1 for s in spans)
            ):
                continue
            heading = any(
                s["size"] >= 11.9 and s["font"] == "GillSans-SemiBold"
                for s in spans
            )
            heading_size = next((round(s["size"]) for s in spans if s["size"] >= 11.9 and s["font"] == "GillSans-SemiBold"), None)
            lines.append(text)
            if heading and events and events[-1][0] == index + 1 and events[-1][2] and previous_heading_size == heading_size == 12:
                events[-1] = (index + 1, events[-1][1].rstrip() + " " + text, True)
            else:
                events.append((index + 1, text, heading))
            previous_heading_size = heading_size
    pages.append({"page": index + 1, "text": "\n".join(lines)})

classes = ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk",
           "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"]
species = ["Dragonborn", "Dwarf", "Elf", "Gnome", "Goliath", "Halfling",
           "Human", "Orc", "Tiefling"]
backgrounds = ["Acolyte", "Criminal", "Sage", "Soldier"]
subclasses = ["Path of the Berserker", "College of Lore", "Life Domain",
              "Circle of the Land", "Champion", "Warrior of the Open Hand",
              "Oath of Devotion", "Hunter", "Thief", "Draconic Sorcery",
              "Fiend Patron", "Evoker"]
entries = []
current = None
owner = None
subclass = None
feat_category = None

def flush():
    global current
    if current:
        current["text"] = clean("\n".join(current.pop("lines"))).strip()
        current["id"] = slug(current["category"] + "-" +
                             (current.get("className", "") + "-" if current["category"] == "feature" else "") +
                             (str(current.get("level", "")) + "-" if current["category"] == "feature" else "") +
                             current["name"])
        # Keep separately named occurrences with page suffix; never overwrite source.
        if any(e["id"] == current["id"] for e in entries):
            current["id"] += "-p" + str(current["page"])
        if current["text"]:
            entries.append(current)
    current = None

for page, text, heading in events:
    if page not in range(28, 104) and page not in range(107, 176) and page not in range(209, 254):
        flush()
        continue
    category = None
    extra = {}
    if 28 <= page <= 82 and heading:
        if text in classes:
            owner = text
            subclass = None
            category = "class"
        elif "Subclass:" in text:
            subclass = subclasses[classes.index(owner)]
            category = "subclass"
            extra["className"] = owner
        elif re.match(r"Level \d+: ", text):
            category = "feature"
            extra = {"className": owner, "level": int(re.search(r"\d+", text)[0])}
            if subclass:
                extra["subclass"] = subclass
        elif 72 <= page <= 74 and 4 <= len(text) <= 60 and text != "Eldritch Invocation Options" and not text.startswith(
            ("As a ", "Becoming", "Cantrips ", "Level ", "Warlock ", "Wizard ")
        ) and text not in classes and not text.endswith(("Features", "Spell List", "Spells")):
            category = "option"
            extra["className"] = owner
        elif 65 <= page <= 68 and "Metamagic" not in text and text.endswith(" Spell"):
            category = "option"
            extra["className"] = owner
    elif page == 83 and heading and text in backgrounds:
        category = "background"
    elif 84 <= page <= 86 and heading and text in species:
        category = "species"
    elif 87 <= page <= 88 and heading:
        if text in ["Origin Feats", "General Feats", "Fighting Style Feats", "Epic Boon Feats"]:
            feat_category = text.removesuffix(" Feats")
            flush()
        elif feat_category and text not in ["Parts of a Feat"]:
            category = "feat"
            extra["featCategory"] = feat_category
    elif 89 <= page <= 103 and heading and len(text) < 80:
        category = "equipment"
    elif 107 <= page <= 175 and heading and text != "Spell Descriptions":
        category = "spell"
    elif 209 <= page <= 253 and heading and len(text) < 80 and text != "Magic Items A–Z":
        category = "magic-item"
    if category:
        flush()
        current = {"name": subclass if category == "subclass" else text, "category": category, "page": page,
                   "endPage": page, "lines": [], **extra}
    elif current:
        current["lines"].append(text)
        current["endPage"] = page

flush()
# Four spell stat-block headings use the same typeface as spell titles. They
# belong to the preceding spell, not separate selectable spells.
merged = []
for entry in entries:
    nested_spell = entry["category"] == "spell" and not re.search(r"(?:Level \d|Cantrip)", entry["text"][:160])
    nested_item = entry["category"] == "magic-item" and entry["name"] in ["Giant Fly", "Avatar of Death"]
    if nested_spell or nested_item:
        assert merged[-1]["category"] == entry["category"], entry["name"]
        merged[-1]["text"] += "\n\n" + entry["name"] + "\n" + entry["text"]
        merged[-1]["endPage"] = entry["endPage"]
    else:
        merged.append(entry)
entries = merged
# Tables use body type rather than headings. Import each weapon/armor row by
# its authoritative name, retaining every printed cell rather than inventing data.
weapon_names = ["Club", "Dagger", "Greatclub", "Handaxe", "Javelin", "Light Hammer",
                "Mace", "Quarterstaff", "Sickle", "Spear", "Dart", "Light Crossbow",
                "Shortbow", "Sling", "Battleaxe", "Flail", "Glaive", "Greataxe",
                "Greatsword", "Halberd", "Lance", "Longsword", "Maul", "Morningstar",
                "Pike", "Rapier", "Scimitar", "Shortsword", "Trident", "Warhammer",
                "War Pick", "Whip", "Blowgun", "Hand Crossbow", "Heavy Crossbow",
                "Longbow", "Musket", "Pistol"]
armor_names = ["Padded Armor", "Leather Armor", "Studded Leather Armor", "Hide Armor",
               "Chain Shirt", "Scale Mail", "Breastplate", "Half Plate Armor",
               "Ring Mail", "Chain Mail", "Splint Armor", "Plate Armor", "Shield"]
for page_number, names, kind in [(91, weapon_names, "weapon"), (92, armor_names, "armor")]:
    lines = document[page_number - 1].get_text().splitlines()
    starts = [(i, line.strip()) for i, line in enumerate(lines) if line.strip() in names]
    # Shield occurs as a prose heading too; the last instance is the table row.
    starts = [(i, name) for i, name in starts if i == max(j for j, n in starts if n == name)]
    for pos, (i, name) in enumerate(starts):
        end = starts[pos + 1][0] if pos + 1 < len(starts) else len(lines)
        cells = [line for line in lines[i + 1:end]
                 if not line.endswith("Weapons") and "to Don" not in line]
        entries.append({"id": slug("equipment-" + kind + "-" + name), "name": name,
                        "category": "equipment", "kind": kind,
                        "page": page_number, "endPage": page_number,
                        "text": "\n".join(cells)})
# Semantic inventory index: a heading is NOT evidence that something is an
# item. Keep rule headings searchable under their original IDs, while only
# priced gear descriptions and actual weapon/armor rows are addable.
coin_value = {"CP": 1, "SP": 10, "EP": 50, "GP": 100, "PP": 1000}
def copper(text):
    match = re.fullmatch(r"([\d,]+)\s*(CP|SP|EP|GP|PP)", text.strip())
    assert match, text
    return int(match[1].replace(",", "")) * coin_value[match[2]]

for entry in entries:
    if entry["category"] != "equipment":
        continue
    if "kind" in entry:
        entry["addable"] = True
        entry["costCopper"] = copper(entry["text"].splitlines()[-1])
    elif 93 <= entry["page"] <= 100 and re.search(r"\((?:[\d,]+ (?:CP|SP|GP)|Varies|Cantrip,)", entry["name"]):
        entry["addable"] = "Varies" not in entry["name"] and not entry["name"].startswith("Spell Scroll")
        price = re.search(r"\(([\d,]+ (?:CP|SP|GP))\)$", entry["name"])
        if price:
            entry["costCopper"] = copper(price[1])
        entry["inventoryName"] = re.sub(r" \([\d,]+ (?:CP|SP|GP)\)$", "", entry["name"])
    else:
        entry["category"] = "rule"
        entry["addable"] = False

def equipment_variant(name, page, cells, *, quantity=1, shop_key=None, parent=None, cost=None):
    """Retain printed row cells, including cost/weight/cargo; no inferred price."""
    entry = {"id": slug("equipment-variant-" + name), "name": name,
             "inventoryName": name, "category": "equipment", "kind": "gear",
             "page": page, "endPage": page, "addable": True,
             "purchaseQuantity": quantity,
             "text": "\n".join(cells)}
    if cost is not None:
        entry["costCopper"] = cost
    elif cells:
        entry["costCopper"] = copper(cells[-1])
    if shop_key:
        entry["shopKey"] = shop_key
    if parent:
        entry["parentId"] = parent["id"]
    assert not any(e["id"] == entry["id"] for e in entries), name
    entries.append(entry)
    return entry

def table_rows(page, rows, width, labels):
    lines = [line.strip() for line in document[page - 1].get_text().splitlines()]
    for printed, name in rows:
        index = lines.index(printed)
        cells = lines[index+1:index+1+width]
        assert len(cells) == width, (page, name)
        copper(cells[-1])
        yield name, [f"{label}: {value}" for label, value in zip(labels[:-1], cells[:-1])] + [cells[-1]]

for name, cells in table_rows(100, [(n,n) for n in [
        "Camel","Elephant","Horse, Draft","Horse, Riding","Mastiff","Mule","Pony","Warhorse"]],
        2, ["Carrying capacity", "Cost"]):
    equipment_variant(name,100,cells)
for name, cells in table_rows(100, [(n,n) for n in ["Carriage","Cart","Chariot","Sled","Wagon"]] +
        [("Feed per day","Feed (1 day)"),("Exotic","Saddle (Exotic)"),
         ("Military","Saddle (Military)"),("Riding","Saddle (Riding)")],
        2, ["Weight","Cost"]):
    equipment_variant(name,100,cells)
# Stabling is a service, not an inventory stack.
for name, cells in table_rows(101, [(n,n) for n in [
        "Airship","Galley","Keelboat","Longship","Rowboat","Sailing Ship","Warship"]],
        8, ["Speed","Crew","Passengers","Cargo (tons)","AC","HP","Damage threshold","Cost"]):
    equipment_variant(name,101,cells)
for name, cells in table_rows(96, [
        ("Arrows","Arrows"),("Bolts","Bolts"),("Bullets, Firearm","Firearm Bullets"),
        ("Bullets, Sling","Sling Bullets"),("Needles","Needles")],
        4, ["Amount","Storage (sold separately)","Weight","Cost"]):
    amount = int(cells[0].split(": ")[1])
    equipment_variant(name,96,cells,quantity=amount,shop_key="variant:"+name)
for page, rows, parent_name in [
    (96, [("Crystal","Arcane Focus (Crystal)"),("Orb","Arcane Focus (Orb)"),
          ("Rod","Arcane Focus (Rod)"),("Staff (also a Quarterstaff)","Quarterstaff (Arcane Focus)"),
          ("Wand","Arcane Focus (Wand)")], "Arcane Focus (Varies)"),
    (97, [("Sprig of mistletoe","Druidic Focus (sprig of mistletoe)"),
          ("Wooden staff (also a Quarterstaff)","Quarterstaff (Druidic Focus)"),
          ("Yew wand","Druidic Focus (yew wand)")], "Druidic Focus (Varies)"),
    (97, [("Amulet (worn or held)","Holy Symbol (Amulet)"),
          ("Emblem (borne on fabric or a Shield)","Holy Symbol (Emblem)"),
          ("Reliquary (held)","Holy Symbol (Reliquary)")], "Holy Symbol (Varies)"),
]:
    parent = next(e for e in entries if e["name"] == parent_name and e["category"] == "equipment")
    for name, cells in table_rows(page, rows, 2, ["Weight","Cost"]):
        equipment_variant(name,page,cells,parent=parent,shop_key="variant:"+name)
for parent_name, names in [
    ("Gaming Set (Varies)", ["Dice","Dragonchess","Playing Cards","Three-Dragon Ante"]),
    ("Musical Instrument (Varies)", ["Bagpipes","Drum","Dulcimer","Flute","Horn",
                                    "Lute","Lyre","Pan Flute","Shawm","Viol"]),
]:
    parent = next(e for e in entries if e["name"] == parent_name and e["category"] == "equipment")
    text = re.sub(r"\s+", " ", parent["text"])
    for name in names:
        match = re.search(re.escape(name) + r" \(([\d,]+ (?:CP|SP|GP))[^)]*\)", text, re.I)
        assert match, name
        equipment_variant(name,94,[match[0],match[1]],parent=parent,shop_key="variant:"+name)
# Printed barding rule, p.100: every body armor, four times cost/twice weight.
for armor in [e for e in entries if e.get("kind") == "armor" and e["name"] != "Shield"]:
    equipment_variant("Barding ("+armor["name"]+")",100,
        ["Barding: four times the armor's cost and twice its weight.",armor["text"]],
        cost=armor["costCopper"]*4)
scroll_gear = next(e for e in entries if e["name"].startswith("Spell Scroll (Cantrip,"))
for level, gp in [(0,30),(1,50)]:
    equipment_variant("Spell Scroll ("+("Cantrip" if level == 0 else "Level 1")+")",
        scroll_gear["page"],[str(gp)+" GP"],parent=scroll_gear)
# Character-creation trinkets are selectable possessions, not priced shop goods.
trinkets = []
for page in [26,27]:
    text = document[page-1].get_text().split("1d100\nTrinket\n",1)[1]
    markers = list(re.finditer(r"(?m)^(\d{2})$",text))
    for index, marker in enumerate(markers):
        end = markers[index+1].start() if index+1<len(markers) else len(text)
        description = clean(text[marker.end():end]).replace("1d100\nTrinket\n","").strip()
        description = re.sub(r"\s+"," ",description)
        roll = marker[1]
        trinkets.append(int(roll) or 100)
        entries.append({"id":"equipment-trinket-"+roll,"name":"Trinket "+roll+" · "+description[:65],
                        "inventoryName":"Trinket "+roll+" · "+description[:60],
                        "category":"equipment","kind":"gear","addable":True,"page":page,"endPage":page,
                        "text":description+"\n\nCharacter-creation Trinkets table, 1d100 result "+roll+
                               ". No purchase price is specified in the SRD."})
assert sorted(trinkets) == list(range(1,101))

# Specific magic item variants keep source-defined rarity instead of silently
# creating a generic Common item. Group entries remain readable, not addable.
rarities = r"Very Rare|Uncommon|Common|Rare|Legendary|Artifact"
def magic_variant(parent, variant, rarity, *, name=None):
    assert re.fullmatch(rarities, rarity), (parent["name"],variant,rarity)
    entry = {**parent, "id": parent["id"]+"-variant-"+slug(variant),
             "name": name or parent["name"]+" ("+variant+")",
             "inventoryName": name or parent["name"]+" ("+variant+")",
             "parentId": parent["id"], "rarity": rarity, "addable": True,
             "text": "Selected variant: "+variant+"; rarity: "+rarity+". See the linked parent entry for full rules."}
    assert not any(e["id"] == entry["id"] for e in entries), entry["id"]
    entries.append(entry)
    parent["addable"] = False

mundane_weapons = [e for e in entries if e.get("kind") == "weapon"]
body_armors = [e for e in entries if e.get("kind") == "armor" and e["name"] != "Shield"]
for parent in [e for e in entries if e["category"] == "magic-item"]:
    header = re.sub(r"\s+", " ", parent["text"].split("\n\n")[0])[:220]
    rarity_match = re.search(r"\b("+rarities+r")\b", header)
    parent["requiresAttunement"] = "Requires Attunement" in header
    parent["addable"] = True
    if rarity_match and "Rarity Varies" not in header:
        parent["rarity"] = rarity_match[1]
    if parent["name"] in ["Armor, +1, +2, or +3","Shield, +1, +2, or +3",
                          "Weapon, +1, +2, or +3","Ammunition, +1, +2, or +3",
                          "Wand of the War Mage, +1, +2, or +3"]:
        bases = ([e["name"] for e in body_armors] if parent["name"].startswith("Armor,")
                 else ["Shield"] if parent["name"].startswith("Shield,")
                 else [e["name"] for e in mundane_weapons] if parent["name"].startswith("Weapon,")
                 else ["Arrows","Bolts","Firearm Bullets","Sling Bullets","Needles"] if parent["name"].startswith("Ammunition,")
                 else ["Wand of the War Mage"])
        for bonus in [1,2,3]:
            rarity = (["Rare","Very Rare","Legendary"] if parent["name"].startswith("Armor,")
                      else ["Uncommon","Rare","Very Rare"])[bonus-1]
            for base in bases:
                magic_variant(parent,base+" +"+str(bonus),rarity,name=base+" +"+str(bonus))
        continue
    if parent["name"] in ["Belt of Giant Strength","Potion of Giant Strength"]:
        for giant in ["hill","frost","stone","fire","cloud","storm"]:
            text = re.sub(r"\s+", " ", parent["text"])
            printed = "frost or stone" if giant in ["frost","stone"] else giant
            match = re.search(re.escape(parent["name"]) + r" \("+printed+r"\)\s+(\d+)\s+("+rarities+r")",text)
            assert match, (parent["name"],giant)
            magic_variant(parent,giant.title(),match[2])
        continue
    if parent["name"] in ["Feather Token","Figurine of Wondrous Power","Ioun Stone"]:
        for label, rarity in re.findall(r"(?:^|\n)\s*([A-Z][A-Za-z ]+) \(("+rarities+r")\)\.",parent["text"]):
            magic_variant(parent,label,rarity)
        assert parent["addable"] is False, parent["name"]
        continue
    if parent["name"] == "Potions of Healing":
        text = re.sub(r"\s+"," ",parent["text"])
        for label, name in [("","Potion of Healing"),("greater","Potion of Greater Healing"),
                            ("superior","Potion of Superior Healing"),("supreme","Potion of Supreme Healing")]:
            match = re.search(r"Potion of Healing"+(r" \("+label+r"\)" if label else "")+
                              r"\s+(\d+d\d+ \+ \d+)\s+("+rarities+r")",text)
            assert match, label
            magic_variant(parent,label or "standard",match[2],name=name)
        continue
    if parent["name"] == "Spell Scroll":
        for level, rarity in enumerate(["Common","Common","Uncommon","Uncommon","Rare","Rare",
                                        "Very Rare","Very Rare","Very Rare","Legendary"]):
            magic_variant(parent,"Cantrip" if level == 0 else "Level "+str(level),rarity)
        continue
    if parent["name"] == "Horn of Valhalla":
        for metal, rarity in [("Silver","Rare"),("Brass","Rare"),("Bronze","Very Rare"),("Iron","Legendary")]:
            magic_variant(parent,metal,rarity)
        continue
    if parent["name"] == "Bag of Tricks":
        for color in ["Gray","Rust","Tan"]:
            magic_variant(parent,color,"Uncommon")
        continue
    # Any weapon/armor type explicitly allowed in an item's printed header.
    match = re.match(r"(Weapon|Armor) \(([^)]+)\)",header)
    if match and parent.get("rarity"):
        kind, allowed = match.groups()
        candidates = mundane_weapons if kind == "Weapon" else body_armors
        if allowed == "Shield":
            continue
        if "Any" in allowed:
            if "Melee" in allowed:
                candidates = [e for e in candidates if e["name"] not in weapon_names[10:14]+weapon_names[31:]]
            elif "Ammunition" in allowed:
                candidates = []
        else:
            candidates = [e for e in candidates if e["name"] in re.split(r", | or ",allowed)]
        for base in candidates:
            magic_variant(parent,base["name"],parent["rarity"],
                          name=base["name"]+" ("+parent["name"]+")")
    if "Rarity Varies" in header and parent["addable"]:
        raise AssertionError("Unmodeled variable-rarity item: "+parent["name"])

progressions = {}
table_pages = [28, 31, 36, 41, 47, 50, 53, 58, 62, 65, 71, 77]
for name, page_number in zip(classes, table_pages):
    text = document[page_number - 1].get_text()
    markers = list(re.finditer(r"(?m)^(\d{1,2})\n\+([2-6])\n(?=[A-Za-z—])", text))
    assert [int(m[1]) for m in markers] == list(range(1, 21)), (name, page_number)
    rows = []
    for i, marker in enumerate(markers):
        body = text[marker.end():markers[i + 1].start() if i < 19 else len(text)]
        lines = body.strip().splitlines()
        # Numeric table columns start after the class features column.
        boundary = next((j for j, line in enumerate(lines)
                        if j > 0 and re.fullmatch(r"(?:\d+|D\d+|\d+d\d+|—)", line)), None)
        assert boundary is not None, (name, i + 1, lines)
        values = []
        for line in lines[boundary:]:
            if not re.fullmatch(r"(?:\d+|D\d+|\d+d\d+|—|\+\d+)", line):
                break
            values.append(line if "d" in line else 0 if line == "—" else int(line.lstrip("D+")))
        rows.append({"level": i + 1, "features": clean(" ".join(lines[:boundary])),
                     "values": values})
    progressions[name] = {"page": page_number, "rows": rows}
# Source spell headers carry spell level and the authoritative class membership.
for entry in entries:
    if entry["category"] == "equipment":
        entry.setdefault("kind", "tool" if "Ability:" in entry["text"][:180] and 93 <= entry["page"] <= 94 else "gear")
    if entry["category"] == "spell":
        intro = entry["text"][:250]
        m = re.search(r"Level (\d)", intro)
        entry["level"] = int(m[1]) if m else 0
        entry["classes"] = [c for c in classes if re.search(r"\b" + c + r"\b", intro)]

manifest = {
    "title": "System Reference Document 5.2.1",
    "sourceFile": source.name,
    "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "pageCount": len(document),
    "importer": "scripts/import-srd.py",
    "license": "CC-BY-4.0",
    "attribution": "This work includes material from the System Reference Document 5.2.1 (SRD 5.2.1) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. Adapted as a searchable catalog and character builder.",
    "counts": dict(sorted(collections.Counter(e["category"] for e in entries).items())),
    "verification": "All 364 PDF pages retained. Structured heading extraction; counts are regression baselines, not independent proof of semantic completeness. Nested tables and conditional rules require separate rule modeling.",
    "implementationCoverage": {
        "startingEquipment": "All 25 class package/currency alternatives and all 8 background package/currency alternatives are explicitly modeled in src/lib/srd-equipment.ts; 7 packs expanded from PDF pp.96–99. Regression tests independently assert printed example quantities and coin amounts.",
        "armor": "12 body armor profiles plus Shields (PDF p.92), training, Strength/Stealth feedback, nonstacking AC formulas and movement application.",
        "weapons": "Owned, explicitly selected ready weapons apply to three existing attack slots; Finesse, Monk Martial Arts, active Pact ability/proficiency/damage and named +1–3 variants are modeled. Blowgun fixed damage is supported; critical hits double dice, never flat damage.",
        "casting": "Each generated spell retains its class, feat and/or species source and chosen casting ability. A shared configurable default is not treated as the source for every spell.",
    },
    "limitations": [
        "Not independently audited as a complete rules implementation; all original page text remains accessible.",
        "The creation shop covers printed mundane prices, mounts/vehicles and explicit equipment variants. Magic-item acquisition prices, spell-component purchases, crafting and encumbrance are not fully modeled. Other manual inventory is preserved.",
        "Conditional encounter effects, resistances, temporary spell buffs, and magic-item effects beyond named +1–3 armor/shield/weapon bonuses remain manual. Defense and ranged Archery bonuses are applied to eligible equipment.",
        "Known Wild Shape choices enforce class-level count/CR/Fly limits; familiar and steed presets retain source references. Active Pact configuration applies one conjured/owned magic weapon, not action timing or bond distance. Transformations, companion actors, copied-spell costs and situational/resource-recovery actions remain manual. Swarms require GM interpretation and are excluded from strict single-Beast selections.",
        "Generic legacy attack/spell defaults remain configurable for homebrew; source-specific spell statistics and metadata are separate. Rest recovery/actions are not an encounter engine.",
    ],
}
for name, data in [("catalog", entries), ("pages", pages), ("manifest", manifest), ("progressions", progressions)]:
    (out / (name + ".json")).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
subprocess.run(["node", "node_modules/prettier/bin/prettier.cjs", "--write", str(out / "*.json")], check=True)
subprocess.run([sys.executable, str(Path(__file__).with_name("import-srd-shapes.py")), str(source)], check=True)
print(json.dumps(manifest, indent=2))
