# Tabs and Plumbing — Design Spec (A)

**Date:** 2026-10-01
**Status:** Approved (design), pending implementation plan
**Companion spec:** `2026-10-01-editor-language-engine-design.md` (B). A ships first.

## Goal

Tidy the tab set and fix the plumbing around the editors: remove the legacy Wildcards
tab, fix cross-tab edits in the Wildcard Editor, add search-in-files, add a Settings
tab, add a prompt Preview in Browse, and fix three Create-tab behaviours (Override
checkbox, Browse refresh, autocompletion word extraction).

Everything about highlighting, error underlines, active-block highlight and the spell
check engine itself belongs to spec B.

## Architecture

Unchanged pattern: Gradio renders static HTML shells, vanilla JS drives them, FastAPI
routes under `/sd-prompt-lab/...` are a dumb store over SQLite / the filesystem.

New files:

- `scripts/prompt_lab/ui/ui_tab_settings.py` — Settings tab HTML shell.
- `javascript/settings.js`, `javascript/settings.css` — Settings tab logic and style.
- `javascript/prompt_preview.js` — Browse preview modal (styles live in
  `editor/style.css`, which is already loaded with the CodeMirror bundle).

Removed files: `scripts/prompt_lab/ui/ui_tab_wildcards.py`, `javascript/wildcards.js`.

## 1. Remove the legacy Wildcards tab

- Drop the tab from `ui_main.py` and delete its UI module and `wildcards.js`.
- Delete the routes only it used: `GET /wildcards/tree`, `POST /wildcards/create`,
  `POST /wildcards/delete`, `POST /wildcards/remove-duplicates`,
  `POST /wildcards/cleanup`, plus `utils.list_txt_files` and the `WildcardFileData`
  model.
- Keep `GET /wildcards/content` and `POST /wildcards/save` (used by the Wildcard
  Editor) and switch their path guard from `startswith` to `_resolve_wildcard_path`.
- "Wildcard Editor" stays conditional on the wildcards directory existing.

## 2. Wildcard Editor: per-file editor state

**Root cause.** All tabs share one CodeMirror state, so undo history crosses files
(Ctrl+Z after a tab switch replays the previous file's edits into the current file),
and the autosave timer saves whichever file is active when it fires rather than the
file that was edited.

**Fix.**

- The bundle exposes `createSdPromptLabEditorState({doc, onChange, ...})`, returning an
  `EditorState` built with the same extensions as the view. Each open file record
  keeps its own `editorState` (document, history, selection, scroll position).
- `activateFile(path)` stores `view.state` on the outgoing file record, then calls
  `view.setState(file.editorState)`. `setEditorDocument` / `silentChange` are no longer
  used for tab switches.
- Each state's `onChange` closure is bound to its file record, so content and dirty
  flags are always written to the file that actually changed.
- Autosave becomes per file: `scheduleAutosave(file)` keeps a timer on the file record
  and `saveFile(file, isAuto)` saves that record. Switching or closing a tab flushes
  the outgoing file's pending autosave immediately.
- Rename moves the record (including its state and timer) to the new path. Delete and
  close cancel the timer.

**Acceptance.** Edit A, switch to B within 900 ms: A is saved, B untouched. Edit A,
switch to B, press Ctrl+Z: nothing changes in B; switching back to A, Ctrl+Z undoes
A's edit.

## 3. Wildcard Editor: search in files

- A toggle button sits inside the explorer search field, right-aligned.
  Off: `find_in_page` icon, muted. On: same icon, accent colour and filled background,
  `aria-pressed="true"`. Tooltip: "Search in file contents".
- Off: current behaviour (name/path match).
- On: the query is sent, debounced 250 ms, to
  `GET /sd-prompt-lab/wildcards/editor/search?q=...` which returns
  `{"paths": [...]}` — posix-relative paths of `.txt` files whose content contains the
  query (case-insensitive substring; empty query returns nothing and the full tree is
  shown). The tree filters to those files, with ancestor folders forced open, exactly
  as name search does today.
- Server: walks the wildcards root, reads each `.txt` as UTF-8 with
  `errors="ignore"`, skips files over 5 MB. Stale responses are ignored client-side
  (request sequence number). Status bar shows "N files match".

## 4. Settings tab

New last tab "Settings". Two columns.

**Left — Autocompletion prompts.** Filter input, total count, and a scrollable list of
saved words (paged 200 at a time, loaded on scroll). Each row: the word, an edit
button (inline input; Enter saves, Esc cancels) and a remove button.

**Right — General.**

- "Clean autocompletion prompts" danger button → confirm dialog → deletes all words.
- "Spell check" switch (default on). Stored server-side; spec B's spell-check
  extension reads it. Changing it dispatches a
  `sd-prompt-lab:settings-changed` window event so open editors react without reload.

**Storage.** New table in `prompts.db`:
`settings (k TEXT PRIMARY KEY, v TEXT)`; values are JSON-encoded.

**Routes** (all registered before the catch-all `GET /sd-prompt-lab/{prompt_id}`):

| Route | Purpose |
|---|---|
| `GET /sd-prompt-lab/words?q=&limit=&offset=` | `{words: [{id, word}], total}` ordered by word |
| `PATCH /sd-prompt-lab/words/{id}` body `{word}` | rename; 400 if empty, 409 if it already exists |
| `DELETE /sd-prompt-lab/words/{id}` | remove one |
| `POST /sd-prompt-lab/words/clear` | remove all |
| `GET /sd-prompt-lab/settings` | `{spell_check: true, ...}` with defaults applied |
| `PUT /sd-prompt-lab/settings` body `{key: value}` | upsert known keys only |

## 5. Browse: Preview

- Each card gets a "👁 preview" button.
- It opens a modal: bold title, optional description, and the full prompt in a
  read-only CodeMirror view (same language/highlighting as Create, line wrapping, no
  gutters, `EditorState.readOnly` + `EditorView.editable.of(false)`), scrollable, max
  80vh. Footer: Copy, Close. Closes on Esc and backdrop click. If the bundle fails to
  load, it falls back to a `<pre>`.
- The bundle exposes `createSdPromptLabReadOnlyView({parent, doc})`.
- Card rendering escapes name, description and prompt text, and buttons no longer
  carry the prompt in `data-prompt`; handlers look the prompt up by id from the last
  loaded list. (Prompts containing `<lora:…>` or quotes currently break the markup.)

## 6. Create tab fixes

- **Override existing.** Unchecked by "Clear fields" and whenever a prompt is loaded
  into the editor via Browse → edit (today that path force-checks it). The checkbox
  change is dispatched so Gradio sees it.
- **Browse refresh.** After a successful save, `loadCards()` runs so Browse is current.
- **Autocompletion word extraction.** `utils.parse_prompts` is rewritten:
  1. Strip comments (`#`, `//`, `/* */`), `<lora:…>` / `<…>` tags, wildcards
     (`__…__`), variable assignments and accesses (`${…}`), and `BREAK`.
  2. Expand variants recursively: every option of `{a|b}` becomes a candidate; weights
     (`0.5::`), bounds and separators (`2$$ and $$`), and sampler prefixes are dropped.
  3. Split on commas, newlines and `|`.
  4. Per candidate: drop A1111 weights (`:1.2`), strip all `()[]{}<>`, collapse
     whitespace, trim surrounding punctuation.
  5. Reject candidates that are empty, purely numeric, longer than 80 characters, or
     still contain any of `{}()[]<>|$#` or `__`.
  6. De-duplicate case-insensitively, keeping the first spelling.

  Existing rows are not migrated; the Settings tab is the tool for cleaning them.

## Error handling

- Settings and search requests surface failures in the tab's status line; lists keep
  their previous content.
- Word rename conflicts show the server's message inline on the row.

## Testing

- Python: unit tests for `parse_prompts` (the cases above, including `hello {`,
  nested variants, weights, lora, wildcards), the words/settings DB helpers against a
  temp DB, and the content-search helper against a temp directory.
- Manual in the WebUI: the two acceptance scenarios in §2, search toggle on/off,
  Settings edit/remove/clean/spell switch, Preview with a long multi-line prompt, and
  the three Create behaviours.

## Out of scope

Highlighting, validation, active-block highlight and the spell-check engine (spec B).
