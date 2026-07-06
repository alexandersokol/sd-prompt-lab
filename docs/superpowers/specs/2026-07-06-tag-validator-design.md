# Tag Validator — Design Spec

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation plan

## Goal

Add a new **Tag Validator** tab (next to "Tag Browser") that lets a user paste raw
prompts collected from other sites/images, validate and clean them, edit or remove
individual tags via chips, and export well-formed prompts (single- or multi-prompt /
wildcard-style). It is a persistent scratch workspace for turning messy prompts into
approved, well-formed ones.

## Glossary

- **Prompt** — a comma-separated list of tags (or free text).
- **Prompt card** — the entity that holds one prompt: its text, approval status, and
  insertion order.
- **Approved prompt card** — a card the user marked approved (all its non-declined tags
  become approved).
- **Import** — adding raw prompt text, producing one or more cards.
- **Export** — assembling cards back into raw prompt text (newline-separated if multiple).
- **Tag verdict** — a global approved/declined marking on a tag name, shared across all
  cards.

## Architecture

A dumb-store backend plus all interactive logic client-side — mirroring how Tag Browser
and Wildcard Editor split responsibilities in this extension.

- **Backend** persists exactly two things: the cards and the global tag verdicts. It does
  **not** tokenize, purge, validate, or assemble exports.
- **Frontend** (`tag_validator.js`) owns tokenizing, purge, validation, chip rendering,
  two-mode sync, and export assembly. It reuses the cleanup primitives already present in
  `javascript/index.js` (BREAK strip, `<lora:...>` extraction, `removeUnmatchedBrackets`,
  dedupe).

### New files

| File | Purpose |
|------|---------|
| `scripts/prompt_lab/sd_prompt_lab_validator_db.py` | SQLite table + accessor functions |
| `scripts/prompt_lab/ui/ui_tab_tag_validator.py` | Gradio HTML shell for the tab |
| `javascript/tag_validator.js` | All interaction logic (lazy-init on tab click) |
| `javascript/tag_validator.css` | Styles (injected via `<link>` by the JS, like `tag_browser.css`) |

### Edited files

- `scripts/prompt_lab/ui/ui_main.py` — register the tab immediately after "Tag Browser".
- `scripts/prompt_lab/sd_prompt_lab_api.py` — add the validator routes in `init_api`.
- `scripts/prompt_lab/sd_prompt_lab.py` — call `init_validator_db()` in `on_app_started`
  alongside `init_db()`.

## Data model

```
validator_cards(
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT    NOT NULL,
    approved   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
)

validator_tags(
    name   TEXT PRIMARY KEY,        -- normalized tag identity
    status TEXT NOT NULL            -- 'approved' | 'declined'
)
```

- A card's **display number** is its 1-based row index when cards are ordered by `id`; it
  is not stored.
- **Tag identity** = the case-insensitive, trimmed segment text, **including** weight
  wrappers. So `(realistic:0.3)` and `realistic` are distinct tags.
- Tag verdicts are **global** (keyed by name), which drives the global approved/declined
  counts and the cross-card red/green chip coloring.

## API

All routes under `/sd-prompt-lab/validator/`. Sync `def` handlers (FastAPI threadpool),
consistent with the existing endpoints.

| Method | Path | Body | Effect / Response |
|--------|------|------|-------------------|
| GET | `/state` | — | `{cards:[{id,text,approved}], tags:[{name,status}]}` (cards ordered by `id`) |
| POST | `/cards` | `{texts:[str,...]}` | Bulk-insert cards (client has already split + purged); returns the created rows with ids |
| PATCH | `/cards/{id}` | `{text?, approved?}` | Autosave a single field or both |
| DELETE | `/cards/{id}` | — | Remove one card |
| POST | `/cards/clear` | — | Delete all cards **and** all tag verdicts |
| PUT | `/tags/{name}` | `{status:'approved'\|'declined'\|'none'}` | Upsert the verdict; `'none'` deletes the row |

Notes:
- `name` in the tag route is URL-encoded (tag names can contain arbitrary characters).
- Unknown card id on PATCH/DELETE → 404.

## Tokenizer / purge / validation (client-side)

### Tokenize (bracket-aware)

Split the prompt text on **top-level commas only** — commas inside `()`, `[]`, `{}`, or
`<>` do not split. Each resulting segment becomes one chip. `BREAK` tokens and newlines
act as separators. A prose prompt with no commas becomes a single large chip (and is
flagged by validation as oversized).

### Auto-purge

Runs on **Import** and on the manual **Clean-up** button. Applies all four:

1. Remove `BREAK` / `;BREAK;` tokens.
2. Strip `<lora:...>` tags entirely.
3. Normalize whitespace and commas (collapse newlines/repeated spaces, ensure single
   `, ` between tags, drop empty segments).
4. Deduplicate tags case-insensitively, keeping first occurrence.

### Validation rules (live)

Surfaced as issue badges (see Layout). The user's four rules plus proposed extras:

- No `BREAK` words.
- No newlines within a single prompt's text.
- No `<lora:...>` tags.
- Balanced `()`, `[]`, `{}`, `<>`.
- **(proposed)** Empty prompt (no tags at all).
- **(proposed)** Duplicate tags still present.
- **(proposed)** Dangling / empty segments (`,,` or trailing comma).
- **(proposed)** Malformed weight syntax, e.g. `(tag:abc)` or `(:1.2)`.
- **(proposed)** Oversized single segment (> ~120 chars → likely un-split prose).

Validation **never blocks approval** — issues are surfaced but the user stays in control.

## Interaction semantics

- **Text is the source of truth.** Tag mode is a projection of the text. Removing a chip
  deletes that segment from the text; approving a chip changes no text. Switching
  Tags ↔ Text re-parses the current text.
- **Card approve** → sets `approved=1` (green card) and adds every non-declined chip's
  name to the global **approved** set, so matching chips in other cards also turn green.
  Un-approve → `approved=0` and removes those names from the approved set.
- **Chip remove** → the segment is deleted from **this card's text only** (per-card export
  semantics), and the tag name is added to the global **declined** set, turning it red in
  every card that contains it.
- **Chip coloring precedence**: declined (red) > approved (green) > neutral (outline).
- **Decline recovery**: the hover **Approve** button on a chip is an explicit override —
  it moves the tag declined → approved. The automatic card-level bulk-approve still
  respects "a declined tag never auto-approves."
- **Global counts**: the top control pane shows the count of distinct approved tag names
  and distinct declined tag names (sizes of the two global sets), across all cards.

## Layout

```
┌ Top control pane ───────────────────────────────────────────────────────────┐
│ [+ Import] [Export] [🗑 Clear]                    approved: N   declined: M   │
│                     (when a card is open →) [Tags | Text] [Clean-up] [✓ Approve] │
├──────────────┬───────────────────────────────────────────────────────────────┤
│ Cards list   │ Main pane (selected card)                                      │
│ ┌──────────┐ │  Tag mode:  [chip] [chip red] [chip green] …                   │
│ │ 1  text… │ │             hover a chip → (✓ approve) (✕ remove)              │
│ │  (≤3 ln) │ │  Text mode: CodeMirror editor bound to the card text          │
│ ├──────────┤ │                                                                │
│ │ 2  text… │◄─ green background when the card is approved                     │
│ └──────────┘ │  (validation issues shown as badges here / on the card)        │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

- **Card**: line 1 = display number; line 2 = prompt text clamped to 3 lines with
  ellipsis. Regular background normally; green when approved. Clicking a card loads it
  into the main pane.
- **Main pane right-side controls** (mode toggle, Clean-up, Approve/Unapprove) appear only
  when a card is loaded. **Approve** toggles: shown when the loaded card is not approved;
  when already approved it un-approves.

### Dialogs

Plain `<textarea>` (not CodeMirror), matching the request:

- **Import** — big textarea + Cancel / Add. Cancel dismisses without adding. Add splits
  the input on runs of 2+ newlines into separate cards, auto-purges each, and POSTs them.
- **Export** — big read-only textarea + an **Approved Only** switch + Copy / Close.
  Content is the assembled prompts joined by single `\n`. When "Approved Only" is checked,
  only approved cards are included; unchecked includes all cards. Copy writes to clipboard;
  Close dismisses.
- **Clear** — confirmation dialog before deleting all cards + verdicts.

## Autosave

There is no explicit save action. Every text edit, chip removal, and approve toggle
immediately persists via PATCH/PUT. Cards and verdicts survive reloads and restarts
(backend SQLite).

## Non-goals

- No manual card reordering (display order is insertion order).
- No editing of individual chip text in Tag mode (edit text in Text mode instead;
  chips offer only approve/remove).
- No autocomplete / dataset lookups in this tab (that lives in Tag Browser).
- Export does not de-duplicate across cards; each card exports its own current text.
