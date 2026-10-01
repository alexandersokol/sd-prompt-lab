# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the data-loss bugs found in the Create / Browse / Wildcard Editor review, make the editor feel like a code editor (completion, problems bar, quick fixes, sampling, navigation), and bring Create and Browse up to the visual standard of the Wildcard Editor.

**Architecture:** Same pattern as today: Gradio HTML shells, vanilla JS per tab, FastAPI routes over SQLite and the filesystem, one CodeMirror bundle built from `editor/`. New shared browser helpers move into one script; all syntax-aware behaviour is built on `editor/dp_parser.js`.

**Tech Stack:** Python 3 + FastAPI + sqlite3; vanilla JS; CodeMirror 6 (rollup bundle); `node --test` for pure JS modules.

**Scope:** review findings 1–6, 8–13, 14–18, 20–22, 25–31, 33. Findings 7, 19, 23, 24 and 32 are out of scope and must not be implemented.

## Global Constraints

- Python tests run with `../../venv/bin/python` as plain scripts (no pytest in that venv), kept in the session scratchpad; stub `scripts.prompt_lab.sd_promt_lab_env` with `.script_dir = <tmp>`.
- Every new route goes inside `init_api(app)` under `/sd-prompt-lab/` and is registered **before** the catch-all `GET /sd-prompt-lab/{prompt_id}`.
- Routes re-raise `HTTPException` before any `except Exception` handler.
- Pure JS logic lives in `editor/*.js` modules with no CodeMirror imports and is tested with `cd editor && npm test`.
- Rebuild the bundle with `cd editor && npm run build`; never delete `package-lock.json`.
- Text rendered through `innerHTML` goes through `escapeHtml`.
- Finding 7 is skipped: the "Override existing" checkbox and its current behaviour stay.
- One commit per task. Each phase leaves the extension working.

## File Structure

| File | Change |
|---|---|
| `javascript/spl_common.js` | **new** — shared helpers: `escapeHtml`, `copyToClipboard`, icon font, asset URLs, CodeMirror loader, tab helpers, confirm dialog, toasts |
| `javascript/spl_common.css`, `javascript/fonts/` | **new** — dialog/toast styles, local icon font |
| `javascript/index.js` | Create tab only (Browse code moves out) |
| `javascript/browse.js`, `javascript/browse.css` | **new** — Browse tab |
| `javascript/prompt_preview.js` | also used for sample results |
| `javascript/wildcard_editor.js` | blank state, disk-conflict handling, session restore, link opening |
| `editor/dp_format.js` | **new** — syntax-aware Reformat / Clean Up (pure) |
| `editor/dp_spell.js` | **new** — spelling suggestions (pure) |
| `editor/dp_complete.js` | **new** — completion sources |
| `editor/dp_extensions.js` | status bar, quick fixes, wildcard links/hover, spelling tooltip |
| `editor/main.js` | wires the above; exposes new globals |
| `scripts/prompt_lab/ui/ui_tab_create.py`, `ui_tab_browse.py` | HTML shells replacing Gradio widgets |
| `scripts/prompt_lab/sd_prompt_lab_api.py`, `_db.py`, `_utils.py`, `_tags_db.py` | routes and helpers listed per task |
| `tools/update_icons.sh` | **new** — regenerates the icon font subset |

---

## Phase 0 — Shared foundations (findings 13, 27, 29, 30, 33)

### Task 0.1: `spl_common.js`

**Produces (on `window.spl`):**
- `escapeHtml(value) -> string`, `copyToClipboard(text) -> Promise<boolean>`
- `assetUrl(path) -> string` — `/file=extensions/sd-prompt-lab/<path>?v=<mtime>` using versions from `GET /sd-prompt-lab/assets`; falls back to no version if the request fails
- `ready -> Promise<void>` — resolves when asset versions and the icon font are loaded
- `loadCodeMirror() -> Promise<void>` — the single loader (replaces the two copies in `index.js` and `wildcard_editor.js`; `window.sdPromptLabLoadCodeMirror` stays as an alias)
- `onTabOpened(panelElemId, callback)` and `openTab(panelElemId)` — locate the tab button by the index of its panel among sibling `.tabitem` elements, never by label text
- `openTxt2Img()` — calls A1111's global `switch_to_txt2img()` when defined, else `openTab` on `#tab_txt2img`
- `confirm({title, message, confirmLabel, danger}) -> Promise<boolean>`
- `toast(message, tone)` — `tone` is `ok | warn | error`; stacked bottom-right, auto-dismiss after 4 s

- [ ] Server: `GET /sd-prompt-lab/assets` returns `{path: mtime}` for `javascript/lib/codemirror6.bundle.js`, every `.css` under `javascript/` and `editor/`, `editor/dict/*.txt`, `common_prompts.txt`, `unwanted_prompts.txt`. Scratchpad test.
- [ ] Write `spl_common.js` and `spl_common.css` (dialog and toast appended to `document.body`, colours from the `--spl-*` palette in `editor/style.css`).
- [ ] Replace every `?v=${Date.now()}` (10 occurrences across `javascript/*.js` and `editor/dp_extensions.js`) with `spl.assetUrl(...)`. In the bundle, read it as `window.spl.assetUrl`.
- [ ] Replace label-based tab lookups (`startsWith('create')`, `'tag browser'`, `'tag validator'`, `'settings'`, `'txt2img'`) with `spl.onTabOpened` / `spl.openTab` / `spl.openTxt2Img`.
- [ ] Replace native `confirm()` / `alert()` in `index.js` with `spl.confirm` / `spl.toast`; replace `showPopupMessage` and its three wrappers with `spl.toast`.
- [ ] Verify in the harness: all tabs still lazy-initialise; no request URL contains a changing timestamp across two reloads.

### Task 0.2: Local icon font (finding 29)

- [ ] `tools/update_icons.sh`: collect icon names (`grep -ohE "material-symbols-rounded[^>]*>[a-z_]+" …` plus names set from JS), request the Google Fonts CSS with `icon_names=<sorted list>`, download the `woff2` it references to `javascript/fonts/material-symbols-rounded.woff2`.
- [ ] `@font-face` and the `.material-symbols-rounded` class in `spl_common.css`; remove the four Google Fonts `<link>` injections.
- [ ] Verify with the network panel that no request goes to `fonts.googleapis.com` / `fonts.gstatic.com` and icons render.

---

## Phase 1 — Bugs (findings 1–6, 8, 10–12)

### Task 1.1: Syntax-aware Reformat and Clean Up (finding 1)

**Produces:** `editor/dp_format.js` exporting `reformatPrompt(text) -> string` and `cleanUpPrompt(text) -> string`; bundle exposes `window.sdPromptLabFormat = {reformat, cleanUp}`.

Rules for `reformatPrompt` (built on `parsePrompt(text)`):
1. Line breaks, comments, `{}` / `${}` / `%{}` blocks, wildcards and `<…>` tags are never altered internally.
2. In plain text at brace depth 0: collapse runs of spaces/tabs to one, normalise `,` spacing to `", "`, drop empty comma segments, trim trailing whitespace per line.
3. Remove brackets the parser reports as `unmatched-*` or `unclosed-paren|bracket|brace`.
4. `BREAK` is kept and only recognised as a whole upper-case word.
5. Top-level `<lora:…>` tags (not inside any block) are moved to a final line, as today.

`cleanUpPrompt` = `reformatPrompt`, then remove case-insensitive duplicate segments among depth-0 comma segments (first occurrence wins; a segment containing a comment is never removed).

- [ ] Tests in `editor/test/dp_format.test.js`: `breakfast table` unchanged; `a # note\nb` keeps both lines; `{red, blue|red, green}` untouched; `a [b c` → `a b c`; `cat, cat, Cat` → `cat`; lora moved only from top level; idempotence (`f(f(x)) === f(x)`) over the parser test corpus.
- [ ] Implement; `index.js` buttons call `window.sdPromptLabFormat` and apply the result as one transaction (single undo step).

### Task 1.2: Unsaved-changes guard in Create (finding 2)

- [ ] `index.js`: `baseline = {name, description, image, prompt}` captured after load, successful save and clear; `isDirty()` compares current values.
- [ ] Before `fillCreateTabFields` (Edit) and before Clear fields, if dirty: `spl.confirm({title: 'Discard unsaved changes?', danger: true})`.

### Task 1.3: Wildcard links use the parser (finding 3)

**Produces:** `window.sdPromptLabWildcardAt(view, pos) -> {path, from, to} | null`.

- [ ] Implement in `dp_extensions.js` from `parseField.wildcards`; `handleEditorLinkClick` in `wildcard_editor.js` uses it instead of the regex. Test: `__lib/hair_color__` opens `lib/hair_color.txt`.

### Task 1.4: Remote image download (finding 4)

- [ ] `save_prompt_endpoint`: `os.makedirs(pics_dir, exist_ok=True)`; download to `tempfile.NamedTemporaryFile(dir=pics_dir, suffix=ext, delete=False)`; reject non-`image/*` content types and bodies over 20 MB; remove the temp file in `finally`. Scratchpad test with a local HTTP server.

### Task 1.5: Wildcard Editor blank state (finding 5)

- [ ] When no file is open, hide the editor DOM and show the "Open a wildcard file from the explorer" placeholder; show the editor again on `activateFile`. `showBlankEditor` no longer leaves an editable view.

### Task 1.6: Disk-conflict detection (finding 6)

- [ ] `GET /wildcards/content` also returns `modified` (mtime). `POST /wildcards/save` accepts optional `expected_modified`; if the file's mtime differs by more than 1 ms it returns 409 with `{detail, modified}`; on success it returns the new `modified`.
- [ ] File record keeps `modified`. On 409: `spl.confirm` "File changed on disk" with **Overwrite** (resend without `expected_modified`) or cancel; a separate **Reload from disk** action replaces the record's state.
- [ ] On tab activation and window focus, re-fetch `modified` for the active file: if changed and the file is clean, reload silently; if dirty, show the same dialog.

### Task 1.7: Small fixes (findings 8, 10, 11, 12)

- [ ] **8:** delete the weighted-sum check from `validateActiveFile`.
- [ ] **10:** add `except HTTPException: raise` to `get_prompt`, `get_thumbnail`, `delete_prompt`; test that a missing id returns 404.
- [ ] **11:** Browse search debounced 250 ms with a request sequence guard.
- [ ] **12:** `/all` items include `image_version` (thumbnail mtime or null); the card `src` appends `?v=<image_version>`; the thumbnail route sends `Cache-Control: no-cache`.

---

## Phase 2 — Editor feel (findings 14–18, 20–22)

### Task 2.1: Completion sources (finding 14)

**Server:**
- `GET /sd-prompt-lab/complete?q=&limit=20` → `{items: [{label, kind: 'saved'|'tag', count, category}]}`. Saved words first (substring match), then tags by **prefix** range scan on the `tags` primary key (`name >= q AND name < q + '￿'`), ordered by `post_count DESC`. Minimum 2 characters. Read-only: never triggers a cache rebuild.
- `GET /sd-prompt-lab/loras` → `{names: [...]}` from the built-in Lora extension's `networks.available_networks` when importable, else a scan of the lora directory for `.safetensors|.pt|.ckpt`; `[]` if neither is available.

**Client (`editor/dp_complete.js`)**, one source choosing by the text before the cursor:

| Context | Suggestions | Applied text |
|---|---|---|
| after an unclosed `__` on the line | wildcard names (already cached for linting) | `path__` |
| after `${` | variable names assigned in the document | `name}` |
| after `<lora:` | lora names | `name:1>` |
| otherwise, current comma segment ≥ 2 chars | `/complete` results, with post count as detail | tag text |

- [ ] Tag text uses spaces instead of underscores and escapes `(`/`)` when the new setting `tag_underscores` is `false` (default); add the key to `DEFAULT_SETTINGS` and a switch in Settings.
- [ ] Requests are aborted when superseded (`AbortController`).
- [ ] Tests: Python for both routes (temp tag cache); JS unit tests for the context detection function `completionContext(textBefore) -> {kind, from, query}`.

### Task 2.2: Status bar and problems panel (finding 15)

- [ ] Bottom panel (`showPanel`) in Create and the Wildcard Editor: `Ln X, Col Y` · character count · error count · warning count · misspelled count. Clicking the counts runs `openLintPanel`. Counts come from one shared `collectDiagnostics(state)` used by both the linter and the panel.

### Task 2.3: Quick fixes (finding 16)

Lint actions keyed by diagnostic code:

| Code | Action |
|---|---|
| `unmatched-brace/paren/bracket`, `unclosed-paren/bracket` | Remove the bracket |
| `unclosed-brace` | Remove `{` · Close at end of line |
| `pipe-outside` | Wrap the surrounding comma segment in `{}` |
| `wildcard-underscore`, `wildcard-double-underscore` | Fix underscores (inner `__` → `_`, trim edge `_`) |
| `variable-in-variant` | Move definition to the top of the prompt |
| `wildcard-missing` | Create the file (then open it in the Wildcard Editor) |

Spelling (not lint diagnostics, so a hover tooltip on `.spl-misspelled`):
- `editor/dp_spell.js`: `suggest(word, dictionary, limit = 5) -> string[]` using edit-distance-1 candidates, then distance-2 if none.
- Tooltip shows suggestions (click replaces) and **Add to dictionary**.
- Server: table `spell_words(word PRIMARY KEY)`; `POST /sd-prompt-lab/spell/words {word}`; `/spell/check` treats those as known. Client marks the word known in its session cache immediately.

- [ ] Tests: `dp_spell` unit tests; one test per fix as a pure function `applyFix(code, text, diagnostic) -> text`.

### Task 2.4: Sample expansions (finding 17)

- [ ] `POST /sd-prompt-lab/sample {prompt, count}` (`count` 1–10): uses `dynamicprompts` (`WildcardManager` on the wildcards directory + `RandomPromptGenerator`); returns `{samples: [...]}`; 501 with a clear message when the library is not importable; 400 with the parser's message when the prompt does not parse.
- [ ] `prompt_preview.js` gains `sdPromptLabShowSamples({title, load})`: a list of results, each with Copy, plus **Re-roll**.
- [ ] Create: **Sample** button. Wildcard Editor: toolbar button sampling `__<active file>__`; pending autosave is flushed first. A 501 hides nothing — the button shows the message as a toast.

### Task 2.5: Wildcard hover and navigation (finding 18)

- [ ] `GET /sd-prompt-lab/wildcards/preview?name=` → `{files: [...], lines: [first 12 non-comment lines], total}` for a name or glob (`.txt` only).
- [ ] `dp_extensions.js`: `hoverTooltip` over wildcard tokens showing that preview; Ctrl/Cmd-hover underlines the token; Ctrl/Cmd-click calls `window.sdPromptLabOpenWildcard(path)`.
- [ ] `wildcard_editor.js` exposes `sdPromptLabOpenWildcard(path)`: `spl.openTab` on the Wildcard Editor panel, init if needed, `openFile`. Replaces the click handler from Task 1.3 so all editors share one implementation.

### Task 2.6: Shortcuts, height, session (findings 20, 21, 22)

- [ ] **20:** Ctrl/Cmd-S in Create triggers Save. Add `commentTokens: {line: '#'}` to the language data so the existing Ctrl/Cmd-/ binding toggles comments.
- [ ] **21:** Create editor height `clamp(420px, calc(100vh - 260px), 1200px)` with a vertical resize handle on the wrapper; the chosen height is stored in `localStorage` (`sd-prompt-lab:create-height`).
- [ ] **22:** `localStorage` key `sd-prompt-lab:wildcard-editor` holds `{openFiles, activePath, openFolders, autosave, contentSearch}`; written on change (debounced), restored after the first `loadTree`, silently skipping files that no longer exist.

---

## Phase 3 — Design (findings 9, 25, 26, 28, 31, 33)

### Task 3.1: Create side panel (findings 28, 9)

- [ ] `ui_tab_create.py` becomes one HTML shell: editor host on the left; right panel with Name, Description, Image, the Override switch, a primary **Save** button, secondary **Send to txt2img**, **Sample**, **Clear**, and a "Prompt tools" group (**Reformat**, **Clean up**). Icons from the icon font, no emoji. Styles in `editor/style.css` using the `--spl-*` palette (moved to `:root` scope under a `.spl-theme` class shared by Create, Browse and the Wildcard Editor).
- [ ] `index.js` reads plain `<input>` values (ids unchanged where possible).
- [ ] **9 — image handling:** the Image block shows the current thumbnail (when the prompt has one) with a **Remove** button, and an input for a new path or URL with placeholder "Keep current image". Edit no longer copies the thumbnail path into the input.
- [ ] Backend: on override, an empty `image_path` keeps the existing image; new field `remove_image: bool` clears it and deletes the thumbnail. Test all three cases (keep, replace, remove).

### Task 3.2: Browse rewrite (findings 25, 26)

- [ ] Move Browse code from `index.js` to `browse.js`; `ui_tab_browse.py` becomes an HTML shell with its own toolbar: search input, sort select (Newest, Oldest, Name), "Favourites only" toggle, result count, refresh.
- [ ] `GET /sd-prompt-lab/all?search=&sort=&favorites=&limit=40&offset=` returns `{prompts, total}`; favourites stay first within each sort. Old call shape (no params) keeps working.
- [ ] Cards: responsive grid `repeat(auto-fill, minmax(340px, 1fr))`, no fixed minimum height, lazy-loaded thumbnail only when an image exists, title, description, prompt excerpt clamped to 6 lines and highlighted through new bundle helper `window.sdPromptLabHighlightHtml(text) -> string`, icon buttons with tooltips, favourite star in the corner.
- [ ] Infinite scroll in pages of 40; empty states for "no prompts yet" and "no matches"; toggling a favourite reloads the current sort.
- [ ] Theme: all colours through `.spl-theme` variables.

### Task 3.3: Export and import (finding 31)

- [ ] `GET /sd-prompt-lab/export` → attachment `sd-prompt-lab-prompts.json`: `{version: 1, exported_at, prompts: [{name, description, prompt, is_favorite, image}]}` where `image` is the base64 PNG thumbnail or null.
- [ ] `POST /sd-prompt-lab/import {data, on_conflict: 'skip'|'overwrite'}` → `{created, updated, skipped}`; validates `version` and field types; rebuilds autocompletion words for imported prompts.
- [ ] Settings → General: **Export prompts** and **Import prompts** (file picker + conflict choice + result toast). Round-trip test.

### Task 3.4: Autocompletion words follow deletions (finding 33)

- [ ] `delete_prompt`: compute the deleted prompt's words minus the words produced by all remaining prompts, and delete only that difference from `prompt_words`. Test: a word shared with another prompt survives; a unique one is removed.

---

## Verification (after each phase)

- [ ] `cd editor && npm test`; all scratchpad Python tests; `node --check` on every file in `javascript/` (excluding `lib/`).
- [ ] Harness walk-through of the tabs touched in the phase, at 1280 px and 800 px widths, checking the browser console for errors.
- [ ] Phase 2 only: confirm typing stays responsive in a 5,000-character prompt with completion, lint and spell check on.

## Decisions taken as defaults (change before the phase starts if you disagree)

| # | Decision | Default in this plan |
|---|---|---|
| 1 | Reformat moving `<lora:…>` to the last line | Kept, top-level tags only |
| 1 | `BREAK` on Reformat | Kept (today it is removed) |
| 9 | Image handling after Edit | Thumbnail preview + "keep / replace / remove"; original source path is not stored |
| 14 | Tag text inserted by completion | Spaces instead of underscores, parentheses escaped; switchable in Settings |
| 16 | "Add to dictionary" | Included, stored in `prompts.db` |
| 17 | Sampling when `dynamicprompts` is not installed | Button stays, shows an explanatory message |
| 31 | Export contents | Includes thumbnails as base64 |
