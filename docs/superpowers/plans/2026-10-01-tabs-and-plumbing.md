# Tabs and Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy Wildcards tab, fix cross-tab edits and add search-in-files in the Wildcard Editor, add a Settings tab and a Browse preview, and fix three Create-tab behaviours.

**Architecture:** Gradio HTML shells + vanilla JS + FastAPI routes over SQLite/filesystem, as in the rest of the extension. The CodeMirror bundle gains two factories (per-file editor state, read-only view). Spec: `docs/superpowers/specs/2026-10-01-tabs-and-plumbing-design.md`.

**Tech Stack:** Python 3 + FastAPI + sqlite3; vanilla JS; CodeMirror 6 bundled with rollup (`cd editor && npm run build`).

## Global Constraints

- Python tests run with `../../venv/bin/python` and live in the session scratchpad (not committed); stub `scripts.prompt_lab.sd_promt_lab_env` with `.script_dir = <tmp>`.
- All routes are added inside `init_api(app)` with prefix `/sd-prompt-lab/`, and every new route is registered **before** the catch-all `GET /sd-prompt-lab/{prompt_id}`.
- Per-tab CSS is injected by the tab's JS via `<link href="file=extensions/sd-prompt-lab/javascript/<name>.css?v=...">`.
- Rebuild the bundle with `npm run build` only; do not delete `package-lock.json`.
- All user-supplied text rendered via `innerHTML` goes through `escapeHtml`.
- One commit per task.

## File Structure

| File | Change |
|---|---|
| `scripts/prompt_lab/ui/ui_tab_wildcards.py`, `javascript/wildcards.js` | delete |
| `scripts/prompt_lab/ui/ui_main.py` | drop Wildcards tab, add Settings tab |
| `scripts/prompt_lab/sd_prompt_lab_api.py` | remove legacy routes; add search, words, settings routes |
| `scripts/prompt_lab/sd_prompt_lab_utils.py` | rewrite `parse_prompts`; remove `list_txt_files`; add `search_wildcard_files` |
| `scripts/prompt_lab/sd_prompt_lab_db.py` | words list/rename/delete/clear; settings table + get/set |
| `scripts/prompt_lab/ui/ui_tab_settings.py` | new — Settings shell |
| `scripts/prompt_lab/ui/ui_tab_wildcard_editor.py` | search-in-files toggle button |
| `javascript/settings.js`, `javascript/settings.css` | new — Settings tab |
| `javascript/prompt_preview.js` | new — Browse preview modal |
| `javascript/index.js` | escape cards, preview button, override checkbox, refresh after save |
| `javascript/wildcard_editor.js` | per-file editor state, per-file autosave, content search |
| `editor/main.js`, `editor/style.css` | `createSdPromptLabEditorState`, `createSdPromptLabReadOnlyView`; preview + toggle styles |

---

### Task 1: Backend — word extraction, words/settings store, content search

**Interfaces (produced):**
- `utils.parse_prompts(raw: str) -> list[str]` — rules in spec §6.
- `utils.search_wildcard_files(root: str, query: str) -> list[str]` — posix-relative `.txt` paths whose content contains `query` (case-insensitive); `[]` for an empty query; skips files > 5 MB.
- `db.list_prompt_words(q=None, limit=200, offset=0) -> {"words": [{"id","word"}], "total": int}`
- `db.rename_prompt_word(word_id, word) -> "ok" | "missing" | "conflict"`
- `db.delete_prompt_word(word_id)`, `db.clear_prompt_words()`
- `db.get_settings() -> dict` (defaults `{"spell_check": True}` applied), `db.set_settings(values: dict)` (known keys only)

- [ ] Write scratchpad tests: `parse_prompts` cases (`hello {`, nested variants, weights, bounds, lora, wildcards, variables, comments, `BREAK`, numeric-only, dedupe), DB helpers on a temp DB, `search_wildcard_files` on a temp dir.
- [ ] Run them, confirm they fail.
- [ ] Implement in `sd_prompt_lab_utils.py` and `sd_prompt_lab_db.py` (`init_db` creates `settings`).
- [ ] Run tests, confirm pass. Commit.

### Task 2: API — remove legacy routes, add new ones

- [ ] Delete `/wildcards/tree`, `/wildcards/create`, `/wildcards/delete`, `/wildcards/remove-duplicates`, `/wildcards/cleanup`, `WildcardFileData`, and `utils.list_txt_files`; switch `/wildcards/content` and `/wildcards/save` to `_resolve_wildcard_path`.
- [ ] Add `GET /wildcards/editor/search?q=`, `GET /words`, `PATCH /words/{id}`, `DELETE /words/{id}`, `POST /words/clear`, `GET /settings`, `PUT /settings` — before the catch-all.
- [ ] Scratchpad test with FastAPI `TestClient` covering each new route and that `GET /sd-prompt-lab/words` is not swallowed by the catch-all. Commit.

### Task 3: Remove the Wildcards tab UI

- [ ] Delete `ui_tab_wildcards.py` and `wildcards.js`; remove the tab from `ui_main.py`.
- [ ] `grep -rn "wildcards-tab\|ui_tab_wildcards\|wildcards.js"` returns nothing. Commit.

### Task 4: Bundle factories

**Interfaces (produced):**
- `window.createSdPromptLabEditorState({doc, onChange}) -> EditorState` — same extensions as the wildcard editor view.
- `window.createSdPromptLabWildcardEditor({parent, doc, onChange})` — unchanged signature, built on the state factory.
- `window.createSdPromptLabReadOnlyView({parent, doc}) -> EditorView` — prompt language, wrapping, no gutters, not editable.

- [ ] Implement in `editor/main.js`; `cd editor && npm run build`; confirm the three globals are in the bundle. Commit.

### Task 5: Wildcard Editor — per-file state and autosave

- [ ] File record gains `editorState` and `autosaveTimer`; `activateFile` swaps states with `view.setState`; `onChange` is bound per record; `scheduleAutosave(file)` / `saveFile(file, isAuto)`; flush on switch/close; rename moves the record; delete/close cancel the timer.
- [ ] Dispatch `sd-prompt-lab:wildcards-changed` after create/rename/delete (consumed by spec B).
- [ ] Manual acceptance (spec §2). Commit.

### Task 6: Wildcard Editor — search in files

- [ ] Add the toggle button to the shell; styles in `editor/style.css`.
- [ ] JS: `state.contentSearch`, `state.contentMatches` (Set or null), debounced fetch with a sequence guard; `createTreeNode` uses the match set when the toggle is on; status shows "N files match". Commit.

### Task 7: Settings tab

- [ ] `ui_tab_settings.py` shell (two columns, confirm dialog), registered last in `ui_main.py`.
- [ ] `settings.js`: lazy init on tab click, paged word list with filter, inline edit/remove, clean-all with confirm, spell-check switch that `PUT`s and dispatches `sd-prompt-lab:settings-changed`. `settings.css`. Commit.

### Task 8: Browse preview and Create fixes

- [ ] `index.js`: `escapeHtml` for cards, prompt lookup by id instead of `data-prompt`, Preview button, uncheck Override on edit-load and clear, `loadCards()` after save.
- [ ] `prompt_preview.js`: modal with read-only view, Copy/Close, Esc/backdrop, `<pre>` fallback. Styles in `editor/style.css`. Commit.

### Task 9: Verification

- [ ] Re-run all scratchpad tests; `node --check` every JS file under `javascript/` (excluding `lib/`); import-check the Python modules.
- [ ] Manual checklist from the spec's Testing section in the running WebUI.
