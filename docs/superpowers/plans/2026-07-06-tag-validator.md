# Tag Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Tag Validator" tab where users paste raw prompts, clean/validate them, edit tags via chips, approve/decline, and export well-formed prompts.

**Architecture:** Dumb SQLite store on the backend (cards + global tag verdicts); all tokenizing/purge/validation/rendering client-side in `tag_validator.js`. Follows existing extension patterns (HTML shell via `gr.HTML`, lazy-init JS on tab click, CSS injected via `<link>`).

**Tech Stack:** Python 3 + FastAPI + sqlite3 (backend); vanilla JS + CodeMirror6 bundle (frontend); pytest + FastAPI TestClient + Node for tests.

## Global Constraints

- Tests MUST run with `../../venv/bin/python` (has `requests`, `fastapi`, `starlette`); system `python3` does not.
- The env module is `scripts.prompt_lab.sd_promt_lab_env` (deliberate typo "promt"); stub it in tests via `types.ModuleType` with `.script_dir = <tmp>`.
- DB file lives at `env.script_dir/prompts.db`; reuse `db.connect()` conventions (`with connect() as conn` / `sqlite3.connect`).
- All API routes live in `init_api(app)` in `sd_prompt_lab_api.py`, prefix `/sd-prompt-lab/`.
- CSS is loaded by the tab's JS injecting `<link href="file=extensions/sd-prompt-lab/javascript/tag_validator.css?v=...">`, mirroring `tag_browser.js`.
- Tag identity = case-insensitive, trimmed segment text (weights included).
- Do NOT touch `editor/package-lock.json` (unrelated pre-existing modification).

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/prompt_lab/sd_prompt_lab_validator_db.py` | **new** — `init_validator_db`, card CRUD, tag-verdict upsert, `get_state` |
| `scripts/prompt_lab/ui/ui_tab_tag_validator.py` | **new** — Gradio HTML shell |
| `javascript/tag_validator.js` | **new** — pure logic (tokenize/purge/validate/export) + state/render/wiring |
| `javascript/tag_validator.css` | **new** — styles |
| `scripts/prompt_lab/ui/ui_main.py` | modify — register tab after Tag Browser |
| `scripts/prompt_lab/sd_prompt_lab_api.py` | modify — validator routes + models |
| `scripts/prompt_lab/sd_prompt_lab.py` | modify — `init_validator_db()` in `on_app_started` |

---

### Task 1: Backend store — `sd_prompt_lab_validator_db.py`

**Files:**
- Create: `scripts/prompt_lab/sd_prompt_lab_validator_db.py`
- Test: `scratchpad/test_validator_db.py` (not committed)

**Interfaces:**
- Produces:
  - `init_validator_db()` → creates `validator_cards(id,text,approved,created_at)` and `validator_tags(name PK, status)`.
  - `create_cards(texts: list[str]) -> list[dict]` → inserts in order, returns `[{id,text,approved}]`.
  - `get_state() -> dict` → `{"cards":[{id,text,approved}...ordered by id], "tags":[{name,status}...]}`.
  - `update_card(card_id, text=None, approved=None) -> bool` → False if id missing.
  - `delete_card(card_id) -> None`.
  - `clear_all() -> None` → deletes all cards + all tag verdicts.
  - `set_tag(name: str, status: str) -> None` → status in {'approved','declined'} upserts; 'none' deletes row.

- [ ] **Step 1: Write failing tests** (`scratchpad/test_validator_db.py`)

```python
import os, sys, types, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

tmp = tempfile.mkdtemp()
env = types.ModuleType("scripts.prompt_lab.sd_promt_lab_env")
env.script_dir = tmp
sys.modules["scripts.prompt_lab.sd_promt_lab_env"] = env

import scripts.prompt_lab.sd_prompt_lab_validator_db as vdb

def main():
    vdb.init_validator_db()
    # empty state
    st = vdb.get_state()
    assert st == {"cards": [], "tags": []}, st
    # create
    cards = vdb.create_cards(["a, b", "c"])
    assert [c["text"] for c in cards] == ["a, b", "c"]
    assert all(c["approved"] == 0 for c in cards)
    ids = [c["id"] for c in cards]
    # state ordered by id
    st = vdb.get_state()
    assert [c["id"] for c in st["cards"]] == sorted(ids)
    # update text + approved
    assert vdb.update_card(ids[0], text="x, y", approved=True) is True
    assert vdb.update_card(999999, text="z") is False
    row = [c for c in vdb.get_state()["cards"] if c["id"] == ids[0]][0]
    assert row["text"] == "x, y" and row["approved"] == 1, row
    # tags upsert + none deletes
    vdb.set_tag("Blue Hair", "approved")
    vdb.set_tag("break", "declined")
    tags = {t["name"]: t["status"] for t in vdb.get_state()["tags"]}
    assert tags == {"Blue Hair": "approved", "break": "declined"}, tags
    vdb.set_tag("Blue Hair", "none")
    tags = {t["name"]: t["status"] for t in vdb.get_state()["tags"]}
    assert tags == {"break": "declined"}, tags
    # delete card
    vdb.delete_card(ids[1])
    assert all(c["id"] != ids[1] for c in vdb.get_state()["cards"])
    # clear
    vdb.clear_all()
    assert vdb.get_state() == {"cards": [], "tags": []}
    print("OK validator_db")

main()
```

- [ ] **Step 2: Run — expect ImportError/fail**
Run: `../../venv/bin/python scratchpad/test_validator_db.py`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `sd_prompt_lab_validator_db.py`**

```python
import os
import sqlite3
from datetime import datetime

import scripts.prompt_lab.sd_promt_lab_env as env


def get_db_path():
    file_path = os.path.join(env.script_dir, "prompts.db")
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    return file_path


def connect():
    return sqlite3.connect(get_db_path())


def init_validator_db():
    with connect() as conn:
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS validator_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                approved INTEGER NOT NULL DEFAULT 0,
                created_at TEXT
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS validator_tags (
                name TEXT PRIMARY KEY,
                status TEXT NOT NULL
            )
        """)
        conn.commit()


def create_cards(texts):
    created = []
    with connect() as conn:
        c = conn.cursor()
        for text in texts:
            now = datetime.utcnow().isoformat()
            c.execute(
                "INSERT INTO validator_cards (text, approved, created_at) VALUES (?, 0, ?)",
                (text, now),
            )
            created.append({"id": c.lastrowid, "text": text, "approved": 0})
        conn.commit()
    return created


def get_state():
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT id, text, approved FROM validator_cards ORDER BY id ASC")
        cards = [{"id": r[0], "text": r[1], "approved": r[2]} for r in c.fetchall()]
        c.execute("SELECT name, status FROM validator_tags ORDER BY name ASC")
        tags = [{"name": r[0], "status": r[1]} for r in c.fetchall()]
    return {"cards": cards, "tags": tags}


def update_card(card_id, text=None, approved=None):
    sets, params = [], []
    if text is not None:
        sets.append("text = ?")
        params.append(text)
    if approved is not None:
        sets.append("approved = ?")
        params.append(1 if approved else 0)
    if not sets:
        return True
    params.append(card_id)
    with connect() as conn:
        c = conn.cursor()
        c.execute(f"UPDATE validator_cards SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
        return c.rowcount > 0


def delete_card(card_id):
    with connect() as conn:
        c = conn.cursor()
        c.execute("DELETE FROM validator_cards WHERE id = ?", (card_id,))
        conn.commit()


def clear_all():
    with connect() as conn:
        c = conn.cursor()
        c.execute("DELETE FROM validator_cards")
        c.execute("DELETE FROM validator_tags")
        conn.commit()


def set_tag(name, status):
    with connect() as conn:
        c = conn.cursor()
        if status == "none":
            c.execute("DELETE FROM validator_tags WHERE name = ?", (name,))
        else:
            c.execute(
                "INSERT INTO validator_tags (name, status) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET status = excluded.status",
                (name, status),
            )
        conn.commit()
```

- [ ] **Step 4: Run — expect PASS**
Run: `../../venv/bin/python scratchpad/test_validator_db.py`
Expected: `OK validator_db`

- [ ] **Step 5: Commit**
```bash
git add scripts/prompt_lab/sd_prompt_lab_validator_db.py
git commit -m "feat(validator): backend SQLite store for tag validator"
```

---

### Task 2: API routes + app wiring

**Files:**
- Modify: `scripts/prompt_lab/sd_prompt_lab_api.py` (import module, add Pydantic models, add routes in `init_api`)
- Modify: `scripts/prompt_lab/sd_prompt_lab.py` (call `init_validator_db()` in `on_app_started`)
- Test: `scratchpad/test_validator_api.py` (not committed)

**Interfaces:**
- Consumes: all `vdb.*` from Task 1.
- Produces routes:
  - `GET  /sd-prompt-lab/validator/state`
  - `POST /sd-prompt-lab/validator/cards` body `{texts:[str]}` → `{cards:[...]}`
  - `PATCH /sd-prompt-lab/validator/cards/{id}` body `{text?, approved?}` → `{status:"ok"}` / 404
  - `DELETE /sd-prompt-lab/validator/cards/{id}` → `{status:"ok"}`
  - `POST /sd-prompt-lab/validator/cards/clear` → `{status:"ok"}`
  - `PUT  /sd-prompt-lab/validator/tags/{name}` body `{status}` → `{status:"ok"}`

- [ ] **Step 1: Write failing test** (`scratchpad/test_validator_api.py`)

```python
import os, sys, types, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)
tmp = tempfile.mkdtemp()
env = types.ModuleType("scripts.prompt_lab.sd_promt_lab_env")
env.script_dir = tmp
sys.modules["scripts.prompt_lab.sd_promt_lab_env"] = env

from fastapi import FastAPI
from fastapi.testclient import TestClient
import scripts.prompt_lab.sd_prompt_lab_db as db
import scripts.prompt_lab.sd_prompt_lab_validator_db as vdb
from scripts.prompt_lab.sd_prompt_lab_api import init_api

db.init_db()
vdb.init_validator_db()
app = FastAPI()
init_api(app)
client = TestClient(app)

def main():
    assert client.get("/sd-prompt-lab/validator/state").json() == {"cards": [], "tags": []}
    r = client.post("/sd-prompt-lab/validator/cards", json={"texts": ["a, b", "c"]})
    cards = r.json()["cards"]
    assert [c["text"] for c in cards] == ["a, b", "c"]
    cid = cards[0]["id"]
    assert client.patch(f"/sd-prompt-lab/validator/cards/{cid}", json={"approved": True}).status_code == 200
    assert client.patch("/sd-prompt-lab/validator/cards/999999", json={"text": "z"}).status_code == 404
    assert client.put("/sd-prompt-lab/validator/tags/Blue%20Hair", json={"status": "approved"}).status_code == 200
    st = client.get("/sd-prompt-lab/validator/state").json()
    assert any(c["id"] == cid and c["approved"] == 1 for c in st["cards"])
    assert {"name": "Blue Hair", "status": "approved"} in st["tags"]
    assert client.delete(f"/sd-prompt-lab/validator/cards/{cid}").status_code == 200
    assert client.post("/sd-prompt-lab/validator/cards/clear").status_code == 200
    assert client.get("/sd-prompt-lab/validator/state").json() == {"cards": [], "tags": []}
    print("OK validator_api")

main()
```

- [ ] **Step 2: Run — expect fail (404s / route missing)**
Run: `../../venv/bin/python scratchpad/test_validator_api.py`

- [ ] **Step 3: Implement.** Add near other imports in `sd_prompt_lab_api.py`:
```python
import scripts.prompt_lab.sd_prompt_lab_validator_db as validator_db
```
Add models after `TagPresetDownloadRequest`:
```python
class ValidatorCardsCreate(BaseModel):
    texts: list[str]


class ValidatorCardUpdate(BaseModel):
    text: str | None = None
    approved: bool | None = None


class ValidatorTagUpdate(BaseModel):
    status: str  # 'approved' | 'declined' | 'none'
```
Add routes inside `init_api`, before the catch-all `GET /sd-prompt-lab/{prompt_id}` (that route matches arbitrary ids, so validator routes MUST be registered before it — FastAPI matches in definition order):
```python
    @app.get("/sd-prompt-lab/validator/state")
    def validator_state():
        return validator_db.get_state()

    @app.post("/sd-prompt-lab/validator/cards")
    def validator_create_cards(data: ValidatorCardsCreate):
        return {"cards": validator_db.create_cards(data.texts)}

    @app.patch("/sd-prompt-lab/validator/cards/{card_id}")
    def validator_update_card(card_id: int, data: ValidatorCardUpdate):
        ok = validator_db.update_card(card_id, text=data.text, approved=data.approved)
        if not ok:
            raise HTTPException(status_code=404, detail="Card not found")
        return {"status": "ok"}

    @app.delete("/sd-prompt-lab/validator/cards/{card_id}")
    def validator_delete_card(card_id: int):
        validator_db.delete_card(card_id)
        return {"status": "ok"}

    @app.post("/sd-prompt-lab/validator/cards/clear")
    def validator_clear():
        validator_db.clear_all()
        return {"status": "ok"}

    @app.put("/sd-prompt-lab/validator/tags/{name}")
    def validator_set_tag(name: str, data: ValidatorTagUpdate):
        validator_db.set_tag(name, data.status)
        return {"status": "ok"}
```
In `sd_prompt_lab.py`, add import and call:
```python
from scripts.prompt_lab.sd_prompt_lab_validator_db import init_validator_db
```
```python
def on_app_started(demo: Optional[Blocks], app: FastAPI):
    init_db()
    init_validator_db()
    init_api(app)
```

- [ ] **Step 4: Run — expect `OK validator_api`**
Run: `../../venv/bin/python scratchpad/test_validator_api.py`

- [ ] **Step 5: Commit**
```bash
git add scripts/prompt_lab/sd_prompt_lab_api.py scripts/prompt_lab/sd_prompt_lab.py
git commit -m "feat(validator): API routes + app wiring"
```

---

### Task 3: HTML shell + tab registration

**Files:**
- Create: `scripts/prompt_lab/ui/ui_tab_tag_validator.py`
- Modify: `scripts/prompt_lab/ui/ui_main.py`

**Interfaces:**
- Produces DOM ids consumed by Task 4 (root `sd-prompt-lab-tag-validator-root`, toolbar buttons, cards list, main pane, dialogs). Full id list embedded in the HTML below.

- [ ] **Step 1: Create `ui_tab_tag_validator.py`** with the shell:
  - Root `#sd-prompt-lab-tag-validator-root`.
  - Top control pane: `#spl-tv-import`, `#spl-tv-export`, `#spl-tv-clear`, counts `#spl-tv-count-approved` / `#spl-tv-count-declined`; right group (hidden until a card open) `#spl-tv-card-controls` with mode toggle `#spl-tv-mode-tags` / `#spl-tv-mode-text`, `#spl-tv-cleanup`, `#spl-tv-approve`.
  - Body: `#spl-tv-cards` (list), `#spl-tv-main` with `#spl-tv-chips` and `#spl-tv-text-host` and `#spl-tv-issues`, plus empty placeholder `#spl-tv-main-empty`.
  - Dialogs (hidden): import `#spl-tv-import-dialog` (textarea `#spl-tv-import-text`, `#spl-tv-import-cancel`, `#spl-tv-import-add`); export `#spl-tv-export-dialog` (textarea `#spl-tv-export-text` readonly, switch `#spl-tv-export-approved`, `#spl-tv-export-copy`, `#spl-tv-export-close`); clear confirm `#spl-tv-clear-dialog` (`#spl-tv-clear-cancel`, `#spl-tv-clear-confirm`).
  - Use `material-symbols-rounded` icons and `spl-tv-*` classes consistent with other tabs. (Exact HTML written during implementation; must contain every id above.)

- [ ] **Step 2: Register tab** in `ui_main.py`: import `ui_tab_tag_validator` and add, immediately after the Tag Browser `gr.Tab` block:
```python
        with gr.Tab("Tag Validator", elem_id='sd-prompt-lab-tag-validator-tab'):
            with gr.Column():
                ui_tab_tag_validator()
```

- [ ] **Step 3: Verify Python imports** (no syntax errors):
Run: `../../venv/bin/python -c "import ast; ast.parse(open('scripts/prompt_lab/ui/ui_tab_tag_validator.py').read()); ast.parse(open('scripts/prompt_lab/ui/ui_main.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**
```bash
git add scripts/prompt_lab/ui/ui_tab_tag_validator.py scripts/prompt_lab/ui/ui_main.py
git commit -m "feat(validator): HTML shell + tab registration"
```

---

### Task 4: Frontend — pure logic (TDD in Node) + app

**Files:**
- Create: `javascript/tag_validator.js`
- Test: `scratchpad/test_validator_logic.mjs` (not committed)

**Interfaces (pure functions, attached to `window.SplTagValidator` for testability):**
- `splitPrompts(raw) -> string[]` — split import text on runs of 2+ newlines; trims; drops empties.
- `tokenize(text) -> string[]` — split on top-level commas (bracket-aware over `()[]{}<>`), also break on `BREAK` and newlines; trim; drop empties.
- `purge(text) -> string` — remove BREAK, strip `<lora:...>`, normalize whitespace/commas, dedupe (case-insensitive keep-first). Returns comma-joined string.
- `tagKey(seg) -> string` — `seg.trim().toLowerCase()` (identity).
- `removeSegment(text, index) -> string` — tokenize, drop index, re-join with `, `.
- `validate(text) -> {code,msg}[]` — the rule set from the spec.

- [ ] **Step 1: Write failing Node test** (`scratchpad/test_validator_logic.mjs`)

```javascript
// Load the browser file into a fake window, then test the pure API.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../javascript/tag_validator.js", import.meta.url), "utf8");
const sandbox = { window: {}, document: { addEventListener() {} }, console };
sandbox.onUiLoaded = () => {};
sandbox.gradioApp = () => ({ querySelector: () => null, getElementById: () => null });
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const V = sandbox.window.SplTagValidator;

function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m}\n  got ${A}\n  exp ${B}`); }

// splitPrompts
eq(V.splitPrompts("a, b\n\nc, d\n\n\n\ne"), ["a, b", "c, d", "e"], "splitPrompts");
eq(V.splitPrompts("solo\nfurry"), ["solo\nfurry"], "single newline stays one prompt");

// tokenize bracket-aware
eq(V.tokenize("1girl, (realistic:0.3), <lora:x:1>, blue hair"),
   ["1girl", "(realistic:0.3)", "<lora:x:1>", "blue hair"], "bracket-aware tokenize");
eq(V.tokenize("a;BREAK;b, c"), ["a", "b", "c"], "BREAK splits");
eq(V.tokenize("prose with no commas here"), ["prose with no commas here"], "prose = one chip");

// purge (all four)
eq(V.purge("1girl, BREAK, 1girl, <lora:foo:1>,  blue   hair ,"),
   "1girl, blue hair", "purge removes BREAK/lora/dupe, normalizes");

// removeSegment
eq(V.removeSegment("a, b, c", 1), "a, c", "removeSegment");

// validate
const codes = (t) => V.validate(t).map(i => i.code).sort();
eq(codes("a, BREAK, b"), ["break"], "detect BREAK");
eq(codes("a\nb"), ["newline"], "detect newline");
eq(codes("<lora:x:1>, a"), ["lora"], "detect lora");
eq(codes("(a, b"), ["brackets"], "detect unbalanced");
eq(codes(""), ["empty"], "detect empty");
eq(codes("a, a"), ["duplicate"], "detect duplicate");
eq(codes("clean, tags, here"), [], "clean prompt has no issues");

// tagKey
eq(V.tagKey("  Blue Hair "), "blue hair", "tagKey");
console.log("OK validator_logic");
```

- [ ] **Step 2: Run — expect fail (file missing / undefined)**
Run: `node scratchpad/test_validator_logic.mjs`

- [ ] **Step 3: Implement `javascript/tag_validator.js`.**
  Structure: an IIFE that (a) defines the pure helpers and assigns them to `window.SplTagValidator`, (b) defines the app object (state, API calls, render, wiring), (c) `onUiLoaded(() => setupLazyInit())`.
  - Pure helpers must exactly match the interface signatures above. Reuse logic adapted from `index.js`: `removeUnmatchedBrackets` for the bracket-balance check; lora regex `/<lora:[^>]+?>/gi`; BREAK via `/\bBREAK\b/gi`.
  - `tokenize`: iterate chars tracking depth across `()[]{}<>`; split on comma at depth 0; pre-replace `BREAK` tokens and newlines with commas.
  - `validate` returns objects `{code,msg}` for codes: `break`, `newline`, `lora`, `brackets`, `empty`, `duplicate`, `dangling`, `weight`, `prose` (per spec). Node test only asserts a subset; all codes must exist.
  - App layer (not Node-tested; verified in browser): `state = {cards, tags(map name->status), activeId, mode}`; `loadState()` GET `/state`; render cards list + counts; on card click render main pane; Tags mode renders chips with per-chip hover approve/remove; Text mode mounts CodeMirror via `window.createSdPromptLabWildcardEditor({parent, doc, onChange})` (load bundle first via `window.sdPromptLabLoadCodeMirror()`); autosave via PATCH; approve toggle sets card.approved + PUT each non-declined tag; import splits+purges then POST `/cards`; export assembles joined by `\n`; clear POST `/cards/clear`. CSS injected via `<link>` as in `tag_browser.js`. Lazy-init bound to the tab button labeled "Tag Validator".

- [ ] **Step 4: Run — expect `OK validator_logic`**
Run: `node scratchpad/test_validator_logic.mjs`

- [ ] **Step 5: Commit**
```bash
git add javascript/tag_validator.js
git commit -m "feat(validator): frontend logic + app (tokenize/purge/validate/chips/modes)"
```

---

### Task 5: Styles — `tag_validator.css`

**Files:**
- Create: `javascript/tag_validator.css`

- [ ] **Step 1: Implement** the styles: two-pane layout (`#spl-tv-cards` narrow scroll list + flexible `#spl-tv-main`), top control pane with left/right groups, card items (number + 3-line clamp via `-webkit-line-clamp:3`, `.approved` green background), chips (`.spl-tv-chip` neutral outline, `.approved` green, `.declined` red, hover-reveal `.spl-tv-chip-actions`), issue badges, dialog backdrops reusing existing dialog visual language, export switch. Match dark-theme colors used in `tag_browser.css`.

- [ ] **Step 2: Sanity check** the file is non-empty and braces balanced:
Run: `node -e "const s=require('fs').readFileSync('javascript/tag_validator.css','utf8');const o=(s.match(/{/g)||[]).length,c=(s.match(/}/g)||[]).length;if(o!==c)throw new Error('brace mismatch '+o+'/'+c);console.log('ok css',o)"`
Expected: `ok css <n>`

- [ ] **Step 3: Commit**
```bash
git add javascript/tag_validator.css
git commit -m "feat(validator): styles"
```

---

### Task 6: Verification

- [ ] **Step 1:** Re-run all three test scripts; all print `OK ...`:
```bash
../../venv/bin/python scratchpad/test_validator_db.py
../../venv/bin/python scratchpad/test_validator_api.py
node scratchpad/test_validator_logic.mjs
```
- [ ] **Step 2:** Manual WebUI smoke (report to user): open Prompt Lab → Tag Validator; Import `robofriends.txt` blocks; confirm multiple cards created + purged; click a card, toggle Tags/Text, remove a chip (turns red across cards), approve a card (green + chips green), Export with/without "Approved Only", Copy, Clear with confirm. Reload page → state persists.
- [ ] **Step 3:** Final commit if any polish applied.

## Self-Review

- **Spec coverage:** cards/verdicts store (T1), CRUD API (T2), tab+shell (T3), tokenize/purge/validate/chips/two-mode/import/export/clear/autosave (T4), layout/colors (T5), verification incl. persistence + robofriends (T6). ✅
- **Placeholder scan:** App-layer UI in T4 and CSS in T5 are described by responsibility + exact ids/classes rather than full literal source (large view code); all pure logic — the bug-prone part — has literal code + tests. Acceptable per "follow patterns; view code verified in browser."
- **Type consistency:** `vdb.*` signatures match between T1 producer and T2 consumer; DOM ids match between T3 shell and T4 app; `window.SplTagValidator` pure API matches T4 test.
