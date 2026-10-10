"""Generate mock notes + .board databases into a test vault.

Usage: py scripts/make-test-notes.py "F:/Note/Obsidian Note"

Writes everything under `<vault>/R Board Test/` (wiped and rebuilt each run):
  Games/      tagged #backlog — every property type, plus edge cases
  Recipes/    tagged #recipe  — ```recipe blocks, incl. tokens that should warn
  Covers/     generated SVG cover art
  Games.board, Recipes.board
"""
import json
import shutil
import sys
from pathlib import Path

vault = Path(sys.argv[1] if len(sys.argv) > 1 else "F:/Note/Obsidian Note")
root = vault / "R Board Test"
if root.exists():
    shutil.rmtree(root)
for sub in ("Games", "Recipes", "Covers"):
    (root / sub).mkdir(parents=True)


def yaml_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        if not v:
            return "[]"
        return "\n" + "\n".join(f"  - {json.dumps(x, ensure_ascii=False)}" for x in v)
    return json.dumps(v, ensure_ascii=False)


def write_note(path, fm, body):
    if not fm:
        path.write_text(body.strip() + "\n", encoding="utf-8")
        return
    lines = ["---"]
    for k, v in fm.items():
        if v is None:
            continue
        lines.append(f"{k}: {yaml_value(v)}")
    lines.append("---")
    path.write_text("\n".join(lines) + "\n\n" + body.strip() + "\n", encoding="utf-8")


def cover(name, title, hue, w=300, h=420):
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl({hue},70%,55%)"/><stop offset="1" stop-color="hsl({(hue + 60) % 360},70%,25%)"/>
</linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="{w * 0.7}" cy="{h * 0.3}" r="{w * 0.25}" fill="rgba(255,255,255,0.15)"/>
<text x="20" y="{h - 40}" font-family="sans-serif" font-size="26" font-weight="bold" fill="white">{title}</text>
</svg>"""
    (root / "Covers" / name).write_text(svg, encoding="utf-8")
    return f"[[{name}]]"


# --- Games ------------------------------------------------------------------
# (title, status, genres, rating, score, platform, finished, hue, cover-size)
games = [
    ("Hades", "completed", ["roguelike", "action"], 5, 93, "PC", True, 10, None),
    ("Hollow Knight", "completed", ["metroidvania", "platformer"], 4.5, 90, "Switch", True, 220, None),
    ("Elden Ring", "playing", ["rpg", "open-world", "soulslike"], 4.8, 96, "PC", False, 40, None),
    ("Celeste", "completed", ["platformer"], 4.3, 92, "Switch", True, 300, None),
    ("Disco Elysium", "to-play", ["rpg", "narrative"], None, 91, "PC", False, 180, None),
    ("Stardew Valley", "on-hold", ["sim", "farming", "cozy"], 4, 89, "PC", False, 100, None),
    ("Outer Wilds", "to-play", ["exploration", "puzzle"], None, 85, "PS5", False, 260, None),
    ("Cyberpunk 2077", "dropped", ["rpg", "open-world"], 2.5, 70, "PC", False, 330, None),
    ("Baldur's Gate 3", "playing", ["rpg", "turn-based", "co-op"], 5, 97, "PC", False, 20, None),
    ("Tunic", "to-play", ["adventure", "puzzle"], None, 85, "Switch", False, 160, None),
    ("Dead Cells", "completed", ["roguelike", "action", "metroidvania"], 3.7, 89, "PC", True, 0, None),
    ("Return of the Obra Dinn", "completed", ["puzzle", "mystery"], 4.9, 89, "PC", True, 50, None),
    # Wide cover, to check masonry / fit vs fill.
    ("Factorio", "playing", ["automation", "sim"], 4.6, 90, "PC", False, 120, (600, 300)),
    # Tall cover.
    ("Inscryption", "on-hold", ["deckbuilder", "horror"], 4.1, 85, "PC", False, 280, (300, 700)),
]

for title, status, genre, rating, score, platform, finished, hue, size in games:
    w, h = size or (300, 420)
    slug = title.lower().replace(" ", "-").replace("'", "")
    others = [g[0] for g in games if g[0] != title and set(g[2]) & set(genre)][:2]
    write_note(
        root / "Games" / f"{title}.md",
        {
            "tags": ["backlog"],
            "cover": cover(f"{slug}.svg", title, hue, w, h),
            "genre": genre,
            "status": status,
            "rating": rating,
            "score": score,
            "platform": platform,
            "finished": finished,
            "related": [f"[[{o}]]" for o in others],
        },
        f"""
# {title}

Mock note for **R Board** testing. Genres: {", ".join(genre)}.

## Thoughts

{title} is a {genre[0]} game on {platform}. This paragraph exists so the
"show content" excerpt on gallery and kanban cards has some text to display.
It runs a little long on purpose to check that excerpts truncate cleanly.

- Status: {status}
- Score: {score}
""",
    )

# Edge cases ------------------------------------------------------------------
write_note(  # No frontmatter properties at all, only an inline tag.
    root / "Games" / "Inline Tag Only.md",
    {},
    "# Inline Tag Only\n\nMatched through an inline #backlog tag; has no properties, "
    "so it should land in Uncategorized on the kanban.",
)
write_note(  # Status value not listed in `columns` -> should still get a column.
    root / "Games" / "Unknown Status.md",
    {"tags": ["backlog"], "status": "wishlist", "genre": [], "rating": 0, "score": 0},
    "Status is `wishlist`, which isn't in the board's explicit column list.",
)
write_note(  # Frontmatter `title` overrides the file name.
    root / "Games" / "custom-title-file.md",
    {"tags": ["backlog", "Favorite"], "title": "Title From Frontmatter", "status": "completed",
     "genre": ["indie"], "rating": 3.2, "score": 150, "platform": "Mobile", "finished": True,
     "related": ["[[Hades]]", "[Wikipedia](https://en.wikipedia.org/wiki/Video_game)", "https://store.steampowered.com"]},
    "File name is `custom-title-file`, but the card should say **Title From Frontmatter**. "
    "Score 150 exceeds max 100 (bar should clamp). Related has a wikilink, a markdown link and a bare URL.",
)
write_note(  # Broken cover link + very long title + many genres.
    root / "Games" / "A Game With An Extremely Long Title That Should Wrap Or Truncate Nicely.md",
    {"tags": ["backlog"], "cover": "[[missing-image.png]]", "status": "to-play",
     "genre": ["one", "two", "three", "four", "five", "six", "seven", "eight"],
     "rating": 1, "score": 12, "platform": "PC", "finished": False},
    "Cover points at a file that doesn't exist; genre has eight pills.",
)
write_note(  # External image URL as cover.
    root / "Games" / "External Cover.md",
    {"tags": ["backlog"], "cover": "https://picsum.photos/seed/rboard/300/420", "status": "playing",
     "genre": ["web"], "rating": 3, "score": 60, "platform": "Browser", "finished": False},
    "Cover is an external URL.",
)
write_note(  # Wrong value types.
    root / "Games" / "Wrong Types.md",
    {"tags": ["backlog"], "status": "playing", "genre": "single-string-not-list",
     "rating": "five", "score": "n/a", "finished": "yes"},
    "Every property has the wrong type — nothing should crash.",
)
write_note(  # Excluded from every database.
    root / "Games" / "_template.md",
    {"tags": ["backlog"], "status": "to-play", "genre": [], "rating": None, "score": None},
    "Notes named `_template` must NOT appear on the board.",
)
write_note(  # Not tagged -> must not appear.
    root / "Games" / "Not Tagged.md",
    {"status": "playing", "genre": ["rpg"], "rating": 5, "score": 99},
    "No #backlog tag, so this must NOT appear on the board.",
)

games_board = {
    "name": "Game Backlog",
    "sourceTag": "backlog",
    "newNoteFolder": "R Board Test/Games",
    "properties": [
        {"name": "cover", "type": "image", "render": "fill"},
        {"name": "genre", "type": "multi", "render": "pills", "searchable": True},
        {"name": "status", "type": "text", "render": "badge"},
        {"name": "rating", "type": "number", "render": "stars", "max": 5},
        {"name": "score", "type": "number", "render": "bar", "max": 100, "suffix": "%"},
        {"name": "platform", "type": "text", "render": "pill"},
        {"name": "finished", "type": "checkbox", "render": "check"},
        {"name": "related", "type": "links", "render": "list"},
    ],
    "views": [
        {"name": "Gallery", "type": "gallery", "limit": 10, "showContent": True,
         "properties": ["cover", "genre", "rating", "score"]},
        {"name": "Grid", "type": "gallery", "layout": "grid", "cardSize": "small", "limit": "none",
         "group": "platform", "properties": ["cover", "status", "rating"]},
        {"name": "Board", "type": "kanban", "limit": "none", "group": "status",
         "columns": ["to-play", "playing", "completed", "on-hold", "dropped"],
         "groupConfig": {"dropped": {"label": "Dropped 💀", "color": "#e5534b"},
                         "completed": {"label": "Done", "color": "#57ab5a"}},
         "properties": ["cover", "score"]},
        {"name": "Table", "type": "table", "limit": 50, "sort": {"property": "score", "dir": "desc"},
         "properties": ["status", "genre", "rating", "score", "platform", "finished", "related"]},
        {"name": "Top rated", "type": "table", "limit": "none",
         "filter": {"conjunction": "and", "conditions": [
             {"property": "rating", "op": "gte", "value": 4},
             {"conjunction": "or", "conditions": [
                 {"property": "platform", "op": "eq", "value": "PC"},
                 {"property": "genre", "op": "contains", "value": "platformer"}]}]},
         "properties": ["rating", "platform", "genre"]},
    ],
    "defaultView": "Gallery",
}
(root / "Games.board").write_text(json.dumps(games_board, indent=2, ensure_ascii=False), encoding="utf-8")

# --- Recipes ------------------------------------------------------------------
recipes = {
    "Carbonara": ("italian", 25, 120, """
portions: 2
ingredients:
  - 200 g spaghetti
  - 100 g guanciale
  - 2 egg yolks
  - 1 whole egg
  - 40 g pecorino
  - {0.5 tsp:sqrt} black pepper
  - salt to taste
steps:
  - Boil the pasta for {9 min:const} in salted water.
  - Fry the guanciale for {6 min:sqrt} until crisp.
  - Whisk yolks, egg and pecorino; toss off the heat with a splash of pasta water.
"""),
    "Pancakes": ("breakfast", 20, 60, """
portions: 4
ingredients:
  - 250 g flour
  - {2 egg:linear:int:min=1} eggs
  - 500 ml milk
  - {1 tbsp:linear:round=0.5} sugar
  - {1 pinch:const} salt
steps:
  - Whisk everything into a smooth batter and rest it for {10 min:const}.
  - Cook each pancake for {2 min:const} per side.
"""),
    "Rice": ("basics", 30, 10, """
portions: 2
ingredients:
  - 150 g rice
  - 300 ml water
steps:
  - Simmer covered for {12:1p, 15:2p, 18:>=3p} min.
  - Rest for {5 min:const} off the heat.
"""),
    "Slow Roast": ("meat", 240, 15, """
portions: 6
ingredients:
  - 2 kg pork shoulder
  - {1 tbsp:pow=0.7} smoked paprika
  - {3 clove:linear:int:min=1} garlic
steps:
  - Roast at 150°C for {4 hr:pow=0.3}.
  - Rest for {20 min:const}.
"""),
    "Broken Tokens": ("test", 5, 5, """
portions: 2
ingredients:
  - {abc:linear} nonsense amount
  - {2:1p, 3:1p} conflicting anchors
  - {1 cup:unknowntag} unknown tag
  - {unterminated token
steps:
  - This step has a {bad:pow=x} token; every broken token should show the base value with a ⚠.
"""),
}
for title, (cuisine, minutes, kcal, block) in recipes.items():
    write_note(
        root / "Recipes" / f"{title}.md",
        {"tags": ["recipe"], "cuisine": cuisine, "time": minutes, "kcal": kcal},
        f"# {title}\n\nA short intro line before the block.\n\n```recipe{block}```\n\nNotes after the block.",
    )

recipes_board = {
    "name": "Recipes",
    "sourceTag": "recipe",
    "newNoteFolder": "R Board Test/Recipes",
    "properties": [
        {"name": "cuisine", "type": "text", "render": "badge"},
        {"name": "time", "type": "number", "render": "text", "suffix": " min"},
        {"name": "kcal", "type": "number", "render": "circle", "max": 200},
    ],
    "views": [
        {"name": "Recipes", "type": "recipe", "limit": "none"},
        {"name": "Cards", "type": "gallery", "showContent": True, "limit": "none"},
        {"name": "Table", "type": "table", "limit": "none", "sort": {"property": "time", "dir": "asc"}},
    ],
}
(root / "Recipes.board").write_text(json.dumps(recipes_board, indent=2, ensure_ascii=False), encoding="utf-8")

print(f"Wrote mock R Board content to {root}")
