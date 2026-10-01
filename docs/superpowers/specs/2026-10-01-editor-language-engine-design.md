# Editor Language Engine — Design Spec (B)

**Date:** 2026-10-01
**Status:** Implemented. The "As built" section at the end lists where the implementation differs from this design.
**Companion spec:** `2026-10-01-tabs-and-plumbing-design.md` (A). A ships first; B
relies on A's settings store and per-file editor states.

## Goal

Make the prompt editors behave like a code editor for the
[sd-dynamic-prompts](https://github.com/adieyal/sd-dynamic-prompts) template language:
correct highlighting, red underlines for syntax errors, warnings for unresolved
references, a highlight for the `{}` block under the cursor, and a yellow underline
for misspelled words.

## Why replace the current highlighter

`editor/main.js` uses a line-based `StreamLanguage` tokenizer. It resets brace depth
on blank lines and decides "unmatched" by checking only the rest of the current line,
so multi-line `{}` are painted as errors and some unbalanced pairs are missed. Its
wildcard regex (`__[^_\n]+?__`) rejects any path containing an underscore, which is
why `__lib/hair_color__` breaks.

## Approach

A hand-written, whole-document parser in a pure JS module. It mirrors the grammar of
`dynamicprompts/parser/parse.py` and returns everything the editor needs in one pass.
Prompts are small, so the document is re-parsed on every change. (Rejected: patching
the stream tokenizer plus a separate linter — two parsers that can disagree; a Lezer
grammar — extra build step and poor control over error messages.)

## Grammar reference (from `dynamicprompts`)

- **Variant** `{…}`: options separated by `|`; may span lines and nest. Optional
  sampler prefix `~`, `!`, `@`. Optional bound `N$$`, `N-M$$`, `-M$$`, `N-$$`,
  optionally followed by a separator `sep$$` (separator cannot contain `$`, `{`, `}`).
  Each option may start with a weight `number::`.
- **Wildcard** `__path__`: optional sampler prefix, then a path that cannot contain
  `__`, `(`, `$` (except a `${var}` reference), `{`, `}`, `#`; optional
  `(name=value, …)` parameters before the closing `__`. `*` and `**` are globs.
- **Variable assignment** `${name=value}`, `${name=!value}`, `${name?=value}` —
  top level only. **Access** `${name}`, `${name:default}` — anywhere. Names match
  `[A-Za-z_-][A-Za-z0-9_-]*`.
- **Wrap** `%{wrapper$$inner}`.
- **Comments** `# …`, `// …` to end of line, `/* … */`.
- Not part of dynamic prompts but present in prompts: A1111 emphasis `( )`, `[ ]`
  (including `[a|b]` alternation and `[a:b:0.5]` scheduling) and `<lora:name:w>`.

## Components

### `editor/dp_parser.js` (pure, no CodeMirror imports)

`parsePrompt(text, {mode}) → {tokens, diagnostics, blocks, wildcards, variables, words}`

- `mode`: `"prompt"` (whole document is one prompt) or `"wildcard-file"` (each line is
  an independent value; a line starting with `#` is a comment; structures cannot span
  lines).
- `tokens`: `[{from, to, type, depth?}]` for highlighting. Types: `brace`, `paren`,
  `bracket` (with depth 1–5), `pipe`, `weight`, `bound`, `separator`, `sampler`,
  `wildcard`, `wildcardParams`, `variableSet`, `variableUse`, `wrap`, `lora`,
  `comment`.
- `diagnostics`: `[{from, to, severity, code, message}]`.
- `blocks`: `[{from, to, depth}]` for every balanced `{…}` (also `${…}` / `%{…}`).
- `wildcards`: `[{from, to, path}]`; `variables`: assignments and accesses with names.
- `words`: `[{from, to, text}]` — plain-text word ranges eligible for spell check
  (outside wildcards, variables, lora tags, comments, weights and bounds).

Recovery: an unmatched closer is reported and skipped; unmatched openers are reported
at end of input (or end of line in wildcard-file mode); parsing always continues.

### Diagnostics

Errors (red underline):

| Code | Condition |
|---|---|
| `unclosed-brace` / `unmatched-brace` | `{` without `}` / stray `}` (same for `()` and `[]`) |
| `pipe-outside` | `|` outside any `{}` and outside `[]` |
| `wildcard-unclosed` | `__` opens a wildcard that never closes |
| `wildcard-underscore` | path starts or ends with `_` (e.g. `___a__`, `__a___`) or is empty |
| `wildcard-double-underscore` | odd number of `__` delimiters leaves a dangling `__`, e.g. `__lib/hair__color__` — the whole run from the first to the last `__` is underlined |
| `wildcard-char` | path contains `(` without a closing `)`, `{`, `}`, `#`, or whitespace-only |
| `lora-double-underscore` | `__` inside `<lora:…>` (dynamic prompts would read it as a wildcard) |
| `lora-unclosed` | `<lora:` without `>` |
| `variable-in-variant` | `${name=…}` nested inside a `{}` block |
| `variable-unclosed` / `variable-name` | `${` never closed / invalid name |
| `bound-malformed` | `$$` present but the bound is not `N`, `N-M`, `-M` or `N-`, or lower > upper |
| `weight-malformed` | `::` preceded by something that is not a number |
| `wrap-malformed` | `%{…}` without a `$$` |

Warnings (amber underline):

| Code | Condition |
|---|---|
| `wildcard-missing` | no file matches the wildcard path (see resolver) |
| `variable-undefined` | `${name}` with no default and no earlier assignment in the document (skipped in wildcard-file mode, where variables come from the caller) |

Empty variant options such as `{a||b}` or `{|a}` are valid and produce no diagnostic.

### `editor/dp_extensions.js` (CodeMirror glue)

- **Highlighting**: a `StateField` holding the parse result, and a decoration set
  built from `tokens` (`Decoration.mark` with classes `spl-tok-…`, depth classes
  `spl-depth-1…5`). Replaces both `StreamLanguage` definitions. `common_prompts.txt`
  and `unwanted_prompts.txt` highlighting is kept, implemented as decorations over
  comma-separated segments in prompt mode.
- **Linting**: `@codemirror/lint` `linter()` fed from the same parse result (no second
  parse), with hover tooltips showing the message. Underline styles are overridden:
  solid 2px red for errors, amber for warnings. The lint gutter is enabled in Create
  and the Wildcard Editor.
- **Active block**: on selection change, find the innermost `blocks` entry containing
  the cursor and apply `Decoration.mark({class: "spl-active-block"})` over it — a
  lighter background, distinct from the active-line highlight. Only the innermost
  block is marked: in `{dsds {asad|as}}` the cursor in `asad` marks `{asad|as}`, the
  cursor in `dsds` marks the outer block.
- **Wildcard resolver**: fetches the wildcard file list once from
  `GET /sd-prompt-lab/wildcards/editor/tree` (refreshed on a
  `sd-prompt-lab:wildcards-changed` event that the Wildcard Editor fires after
  create/rename/delete). A path resolves if `path.txt` exists, or if a glob (`*`,
  `**`) matches at least one file. Paths containing `${…}` are never flagged. If the
  wildcards directory is absent the check is disabled.
- **Autocomplete, close-brackets, bracket matching, keymaps**: unchanged.

### Spell check

- **Word list**: `editor/dict/en-words.txt` (lower-case English word list, one per
  line), fetched lazily on first use and held as a `Set`. It is a separate file, not
  part of the bundle.
- **Flow**: `words` from the parser → lower-cased, split on `_` and `-` as well →
  skip tokens shorter than 3 characters or containing digits → look up in the local
  set → remaining unknown words are sent in one debounced (400 ms) batch to
  `POST /sd-prompt-lab/spell/check` `{words: [...]}`, which returns the subset still
  unknown after checking the tag cache (`tags.name`, underscores and spaces treated
  alike, plus each tag split into its component words) and `prompt_words`. Results are
  cached client-side for the session.
- The server builds its tag-word lookup lazily as a table inside the tag cache DB
  (`tag_words(word PRIMARY KEY)`), populated during cache rebuild, so a check is an
  indexed lookup. With no tag datasets downloaded, only the English list and saved
  words apply.
- **Rendering**: `Decoration.mark({class: "spl-misspelled"})` — semi-transparent
  yellow wavy underline. No suggestions menu in this version.
- **Setting**: reads `spell_check` from `GET /sd-prompt-lab/settings` (spec A) and
  listens for `sd-prompt-lab:settings-changed`; when off, the extension is
  reconfigured to empty via a `Compartment`.

### Where it applies

| Editor | Mode | Lint | Spell | Active block |
|---|---|---|---|---|
| Create | prompt | yes | yes | yes |
| Wildcard Editor | wildcard-file | yes | yes | yes |
| Tag Validator text mode | prompt | yes | no | yes |
| Browse Preview (read-only) | prompt | underlines only, no gutter | no | no |

`editor/main.js` shrinks to factories (`initCodeMirror6`,
`createSdPromptLabEditorState`, `createSdPromptLabWildcardEditor`,
`createSdPromptLabReadOnlyView`) that assemble these extensions; the language code
lives in the two new modules.

## Design tokens

Added to `editor/style.css`: `.spl-tok-*` colours (reusing the current palette),
`.cm-lintRange-error` red underline, `.cm-lintRange-warning` amber underline,
`.spl-misspelled` `text-decoration: underline wavy rgba(255, 213, 0, .55)`,
`.spl-active-block` `background: rgba(255, 255, 255, .07); border-radius: 3px`.

## Error handling

- The parser never throws; an internal error is caught in the state field, logged
  once, and the editor falls back to no decorations.
- Spell-check and resolver fetch failures disable that check silently for the session
  (console warning), never blocking typing.

## Testing

- `editor/test/dp_parser.test.js` run with `node --test`: one case per diagnostic code
  (positive and negative), plus highlighting cases from the reported bugs —
  `__lib/hair_color__`, `__lib/hair__color__`, multi-line `{…}`, nested blocks,
  `[a|b]`, `<lora:a__b:1>`, `${x=…}` inside `{}`, comments, wrap commands, bounds and
  weights — and `blocks` innermost-lookup cases.
- Python: unit test for the spell-check lookup against a temp tag cache.
- Manual in the WebUI: each editor in the table above; spell switch on/off; a prompt
  of ~5,000 characters stays responsive while typing.

## Out of scope

Spelling suggestions/quick-fixes, auto-fix actions for diagnostics, YAML/JSON wildcard
files, and migrating existing autocompletion words.

## As built

Verified against the real parser: `dynamicprompts` was installed in a scratch environment
and the new parser's verdicts were compared with it on 145 cases (0 mismatches for the
checks that correspond to a dynamic prompts parse failure).

Differences from the design above:

- **Severity.** `weight-malformed` (`{x::a}`) and an inverted range (`{3-1$$a|b}`, code
  `bound-range`) are warnings, not errors: the real parser accepts both.
- **New warnings `stray-dollar` / `stray-percent`.** A lone `$`, `$$` or `%` outside the
  syntax (e.g. `50% off`) makes the real parser fail, so it is flagged.
- **Codes.** `wildcard-empty` (`____`) and `pipe-in-variable` (`${x=a|b}`) are separate
  codes. `wildcard-char` covers `#`, `}`, `$`, `%` and an unclosed `(` in a path; spaces and
  commas in a path are legal and only surface through the missing-file warning.
- **Escapes.** `\(`, `\)`, `\[`, `\]` are literal (A1111). `\{` is not an escape, matching
  dynamic prompts.
- **Wildcards are single-line** in the editor (the real parser lets a path span lines).
- **Wildcard resolver** uses a new `GET /sd-prompt-lab/wildcards/names` (all `.txt` names
  plus key paths of YAML/JSON collections) instead of the editor tree. If a collection
  cannot be read, the missing-file check is switched off rather than risk false warnings.
- **Spell check server lookup** queries the existing tag cache directly (a word is known
  if it is a tag or the first word of a tag) and the saved autocompletion prompts. No
  `tag_words` table, so the tag cache needs no rebuild. Contractions and ALL-CAPS words
  are skipped.
- **English word list** is ENABLE (public domain, 172k words) plus
  `editor/dict/extra-words.txt` for prompt jargon; both are plain files you can edit.
- **Extras.** Multi-line `{}` blocks can be folded from the gutter; auto-closing is limited
  to brackets (no quote pairing); F8 / Shift-F8 jump between diagnostics.
- **Not done.** The ~5,000-character responsiveness check from the Testing section was not
  measured.
