// CodeMirror glue for the dynamic prompts language: highlighting, error underlines,
// active {} block, folding and spell check. All of it is driven by one parse of the
// document (dp_parser.js), kept in a state field.

import {EditorState, Facet, StateEffect, StateField} from "@codemirror/state";
import {Decoration, EditorView, hoverTooltip, showPanel, ViewPlugin} from "@codemirror/view";
import {foldService} from "@codemirror/language";
import {closeLintPanel, linter, lintGutter, openLintPanel} from "@codemirror/lint";
import {extractWords, innermostBlock, parsePrompt, resolveWildcard} from "./dp_parser.js";
import {completionContext, formatCount, formatTag} from "./dp_complete.js";
import {quickFixes} from "./dp_fixes.js";
import {suggest} from "./dp_spell.js";


// 'prompt' (whole document is one prompt) or 'wildcard-file' (one value per line).
const modeFacet = Facet.define({combine: (values) => values[0] || "prompt"});

// Bumps a counter so decorations that depend on externally loaded data are rebuilt.
const refreshEffect = StateEffect.define();
// Dispatched by the spell checker after it replaced its decorations (forces a redraw).
const spellAppliedEffect = StateEffect.define();

const parseField = StateField.define({
    create: (state) => parsePrompt(state.doc.toString(), {mode: state.facet(modeFacet)}),
    update: (value, tr) => (tr.docChanged
        ? parsePrompt(tr.newDoc.toString(), {mode: tr.state.facet(modeFacet)})
        : value),
});

const refreshField = StateField.define({
    create: () => 0,
    update: (value, tr) => (tr.effects.some((e) => e.is(refreshEffect)) ? value + 1 : value),
});

// ---- live views (so shared data changes can refresh every open editor) -------------

const liveViews = new Set();

const trackView = ViewPlugin.fromClass(class {
    constructor(view) {
        this.view = view;
        liveViews.add(view);
    }

    destroy() {
        liveViews.delete(this.view);
    }
});

function refreshAllViews() {
    for (const view of liveViews) {
        view.dispatch({effects: refreshEffect.of(null)});
    }
}

// ---- shared data: common/unwanted prompts, wildcard names, settings ----------------

const lists = {common: new Set(), unwanted: new Set(), loaded: false};

async function fetchLines(path) {
    // Versioned by file mtime (see spl_common.js) so the browser can cache these files.
    await window.spl.ready;
    const response = await fetch(window.spl.assetUrl(path));
    if (!response.ok) throw new Error(`Failed to load ${path}`);
    return (await response.text())
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
}

export async function loadPromptLists() {
    if (lists.loaded) return;
    lists.loaded = true;
    try {
        lists.common = new Set(await fetchLines("common_prompts.txt"));
    } catch (err) {
        console.error("Could not load common_prompts.txt:", err);
    }
    try {
        lists.unwanted = new Set(await fetchLines("unwanted_prompts.txt"));
    } catch (err) {
        console.error("Could not load unwanted_prompts.txt:", err);
    }
    refreshAllViews();
}

const wildcardNames = {ready: false, names: new Set(), requested: false};

// Hover previews of wildcard files, keyed by path; dropped whenever files change.
const wildcardPreviews = new Map();

async function loadWildcardNames() {
    wildcardPreviews.clear();
    try {
        const response = await fetch("/sd-prompt-lab/wildcards/names");
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const data = await response.json();
        wildcardNames.names = new Set(data.names || []);
        // Without a complete list a "missing file" warning could be wrong, so stay quiet.
        wildcardNames.ready = !!(data.exists && data.complete);
    } catch (err) {
        wildcardNames.ready = false;
        console.warn("[sd-prompt-lab] wildcard file check disabled:", err);
    }
    refreshAllViews();
}

function ensureWildcardNames() {
    if (wildcardNames.requested) return;
    wildcardNames.requested = true;
    loadWildcardNames();
    window.addEventListener("sd-prompt-lab:wildcards-changed", loadWildcardNames);
}

// User settings (Settings tab). Loaded once, then kept current through a window event.
const settings = {spell_check: true, tag_underscores: false, requested: false};

function ensureSettings() {
    if (settings.requested) return;
    settings.requested = true;
    const apply = (values) => {
        settings.spell_check = values?.spell_check !== false;
        settings.tag_underscores = values?.tag_underscores === true;
        refreshAllViews();
    };
    fetch("/sd-prompt-lab/settings")
        .then((response) => (response.ok ? response.json() : {}))
        .then(apply)
        .catch(() => {});
    window.addEventListener("sd-prompt-lab:settings-changed", (event) => apply(event.detail));
}

const spell = {
    dictionary: null,          // Set of known lower-case words, once loaded
    dictionaryPromise: null,
    failed: false,
    verdicts: new Map(),       // word -> true (known) | false (misspelled), from the server
};

function ensureDictionary() {
    if (!spell.dictionaryPromise) {
        spell.dictionaryPromise = Promise.all([
            fetchLines("editor/dict/en-words.txt"),
            fetchLines("editor/dict/extra-words.txt"),
        ]).then(([english, extra]) => {
            spell.dictionary = new Set(english);
            for (const word of extra) spell.dictionary.add(word.toLowerCase());
        }).catch((err) => {
            spell.failed = true;
            console.warn("[sd-prompt-lab] spell check disabled:", err);
        });
    }
    return spell.dictionaryPromise;
}

// Words the English list does not know get a second opinion from the server (tag
// datasets and saved autocompletion prompts). Verdicts are cached for the session.
async function resolveUnknownWords(words) {
    const pending = words.filter((word) => !spell.verdicts.has(word));
    if (!pending.length) return;
    const response = await fetch("/sd-prompt-lab/spell/check", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({words: pending}),
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const unknown = new Set((await response.json()).unknown || []);
    for (const word of pending) spell.verdicts.set(word, !unknown.has(word));
}

// ---- highlighting ------------------------------------------------------------------

const markCache = new Map();

function mark(className) {
    let deco = markCache.get(className);
    if (!deco) {
        deco = Decoration.mark({class: className});
        markCache.set(className, deco);
    }
    return deco;
}

function listDecorations(state, result, ranges) {
    if (!lists.common.size && !lists.unwanted.size) return;
    const doc = state.doc.toString();
    for (const range of result.text) {
        const chunk = doc.slice(range.from, range.to);
        const re = /[^,\n]+/g;
        let m;
        while ((m = re.exec(chunk)) !== null) {
            const raw = m[0];
            const lead = raw.length - raw.trimStart().length;
            // "(masterpiece:1.2)" leaves "masterpiece:1.2" as plain text: ignore the weight.
            const word = raw.trim().replace(/:\s*-?\d*\.?\d+$/, "").trim();
            if (!word) continue;
            const cls = lists.unwanted.has(word) ? "spl-tok-unwanted"
                : lists.common.has(word) ? "spl-tok-common" : null;
            if (!cls) continue;
            const from = range.from + m.index + lead;
            ranges.push(mark(cls).range(from, from + word.length));
        }
    }
}

const highlightDecorations = EditorView.decorations.compute([parseField, refreshField], (state) => {
    const result = state.field(parseField);
    const length = state.doc.length;
    const ranges = [];
    for (const token of result.tokens) {
        if (token.from >= token.to || token.to > length) continue;
        const cls = token.depth ? `spl-tok-${token.type} spl-depth-${token.depth}` : `spl-tok-${token.type}`;
        ranges.push(mark(cls).range(token.from, token.to));
    }
    if (state.facet(modeFacet) === "prompt") listDecorations(state, result, ranges);
    return Decoration.set(ranges, true);
});

// ---- active {} block ----------------------------------------------------------------

const activeBlockMark = Decoration.mark({class: "spl-active-block"});

const activeBlockDecorations = EditorView.decorations.compute(["selection", parseField], (state) => {
    const block = innermostBlock(state.field(parseField).blocks, state.selection.main.head);
    if (!block || block.to > state.doc.length) return Decoration.none;
    return Decoration.set([activeBlockMark.range(block.from, block.to)]);
});

// ---- folding: multi-line {} blocks -------------------------------------------------

const blockFolding = foldService.of((state, lineStart, lineEnd) => {
    let best = null;
    for (const block of state.field(parseField).blocks) {
        if (block.from < lineStart || block.from > lineEnd || block.to - 1 <= lineEnd) continue;
        if (!best || block.from < best.from) best = block;
    }
    return best ? {from: lineEnd, to: best.to - 1} : null;
});

// ---- linting -----------------------------------------------------------------------

// Every problem in the document: parser diagnostics plus unresolved wildcard files.
// Shared by the linter and the status bar so both always agree.
function collectDiagnostics(state) {
    const result = state.field(parseField);
    const length = state.doc.length;
    const diagnostics = [];
    const push = (from, to, severity, message, code, extra) => {
        from = Math.min(from, length);
        to = Math.min(Math.max(to, from), length);
        diagnostics.push({from, to, severity, message, code, ...extra});
    };

    for (const d of result.diagnostics) push(d.from, d.to, d.severity, d.message, d.code);

    if (wildcardNames.ready) {
        for (const wildcard of result.wildcards) {
            if (wildcard.dynamic || resolveWildcard(wildcard.path, wildcardNames.names)) continue;
            push(wildcard.from, wildcard.to, "warning",
                `No wildcard file matches "${wildcard.path}"`, "wildcard-missing", {path: wildcard.path});
        }
    }
    return diagnostics;
}

async function createWildcardFile(path) {
    const toast = (message, tone) => window.spl?.toast(message, tone);
    try {
        const response = await fetch(
            `/sd-prompt-lab/wildcards/editor/file/create?path=${encodeURIComponent(path)}`, {method: "POST"});
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.detail || `Request failed: ${response.status}`);
        }
        toast(`Created ${path}.txt`, "ok");
        window.dispatchEvent(new CustomEvent("sd-prompt-lab:wildcards-changed"));
        window.sdPromptLabOpenWildcard?.(path);
    } catch (err) {
        toast(`Could not create ${path}.txt: ${err.message}`, "error");
    }
}

// Quick fixes shown in the hover tooltip and the problems panel.
function lintActions(diagnostic) {
    if (/[*?]/.test(diagnostic.path)) return [];
    return [{name: "Create file", apply: () => createWildcardFile(diagnostic.path)}];
}

function fixActions(diagnostic) {
    // Offer the fix names now; compute the actual changes against the document as it
    // is when the user clicks (the diagnostic may have moved since).
    const names = FIX_NAMES[diagnostic.code] || [];
    return names.map((name) => ({
        name,
        apply(view, from, to) {
            const text = view.state.doc.toString();
            const fix = quickFixes(text, {code: diagnostic.code, from, to}).find((f) => f.name === name);
            if (fix) view.dispatch({changes: fix.changes, userEvent: "input.fix"});
        },
    }));
}

const FIX_NAMES = {
    "unmatched-brace": ['Remove "}"'],
    "unmatched-paren": ['Remove ")"'],
    "unmatched-bracket": ['Remove "]"'],
    "unclosed-paren": ['Remove "("'],
    "unclosed-bracket": ['Remove "["'],
    "unclosed-brace": ["Close at end of line", 'Remove "{"'],
    "pipe-outside": ["Wrap options in {}"],
    "wildcard-underscore": ["Fix underscores"],
    "wildcard-double-underscore": ["Fix underscores"],
    "variable-in-variant": ["Move definition to the top"],
};

function lintSource(view) {
    return collectDiagnostics(view.state).map((d) => ({
        from: d.from,
        to: d.to,
        severity: d.severity,
        message: d.message,
        source: "Prompt Lab",
        actions: d.code === "wildcard-missing" ? lintActions(d) : fixActions(d),
    }));
}

// ---- spell check -------------------------------------------------------------------

const misspelledMark = Decoration.mark({class: "spl-misspelled"});

const spellChecker = ViewPlugin.fromClass(class {
    constructor(view) {
        this.view = view;
        this.decorations = Decoration.none;
        this.timer = null;
        this.destroyed = false;
        this.schedule(600);
    }

    update(update) {
        if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
            this.schedule(400);
        } else if (update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)))) {
            this.schedule(0);
        }
    }

    schedule(delay) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.run().catch((err) => {
            spell.failed = true;
            console.warn("[sd-prompt-lab] spell check disabled:", err);
        }), delay);
    }

    apply(decorations) {
        if (this.destroyed) return;
        this.decorations = decorations;
        this.view.dispatch({effects: spellAppliedEffect.of(null)});
    }

    async run() {
        if (this.destroyed) return;
        if (!settings.spell_check || spell.failed) {
            if (this.decorations.size) this.apply(Decoration.none);
            return;
        }
        await ensureDictionary();
        if (this.destroyed || !spell.dictionary) return;

        const state = this.view.state;
        const text = state.doc.toString();
        const words = extractWords(text, state.field(parseField).text)
            .map((word) => ({...word, key: word.text.toLowerCase()}))
            .filter((word) => !spell.dictionary.has(word.key));

        await resolveUnknownWords([...new Set(words.map((word) => word.key))]);
        // The document changed while waiting; a newer run is already scheduled.
        if (this.destroyed || this.view.state.doc !== state.doc) return;

        const ranges = words
            .filter((word) => spell.verdicts.get(word.key) === false)
            .map((word) => misspelledMark.range(word.from, word.to));
        this.apply(Decoration.set(ranges, true));
    }

    destroy() {
        this.destroyed = true;
        clearTimeout(this.timer);
    }
}, {
    decorations: (plugin) => plugin.decorations,
});

// ---- spelling tooltip: suggestions + add to dictionary ------------------------------

function misspelledAt(view, pos) {
    const plugin = view.plugin(spellChecker);
    if (!plugin) return null;
    let found = null;
    plugin.decorations.between(pos, pos, (from, to) => {
        found = {from, to};
        return false;
    });
    return found;
}

const spellingTooltip = hoverTooltip((view, pos) => {
    const range = misspelledAt(view, pos);
    if (!range) return null;
    const word = view.state.sliceDoc(range.from, range.to);
    return {
        pos: range.from,
        end: range.to,
        above: true,
        create() {
            const dom = document.createElement("div");
            dom.className = "spl-tip spl-tip-spell";
            const title = dom.appendChild(document.createElement("div"));
            title.className = "spl-tip-title";
            title.textContent = `"${word}" is not in the dictionary`;

            const row = dom.appendChild(document.createElement("div"));
            row.className = "spl-tip-actions";
            for (const candidate of suggest(word, spell.dictionary)) {
                const button = row.appendChild(document.createElement("button"));
                button.type = "button";
                button.className = "spl-tip-btn";
                button.textContent = candidate;
                button.addEventListener("click", () => {
                    const current = misspelledAt(view, view.state.doc.length >= range.from ? range.from : 0) || range;
                    view.dispatch({changes: {from: current.from, to: current.to, insert: candidate}, userEvent: "input.fix"});
                    view.focus();
                });
            }
            const add = row.appendChild(document.createElement("button"));
            add.type = "button";
            add.className = "spl-tip-btn spl-tip-btn-quiet";
            add.textContent = "Add to dictionary";
            add.addEventListener("click", async () => {
                const key = word.toLowerCase();
                try {
                    const response = await fetch("/sd-prompt-lab/spell/words", {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({word: key}),
                    });
                    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
                    spell.verdicts.set(key, true);
                    refreshAllViews();
                } catch (err) {
                    window.spl?.toast(`Could not add "${word}": ${err.message}`, "error");
                }
                view.focus();
            });
            return {dom};
        },
    };
}, {hoverTime: 250});

// ---- wildcard references: hover preview and Ctrl/Cmd-click to open -------------------

async function wildcardPreview(path) {
    if (!wildcardPreviews.has(path)) {
        wildcardPreviews.set(path, fetch(`/sd-prompt-lab/wildcards/preview?name=${encodeURIComponent(path)}`)
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null));
    }
    return wildcardPreviews.get(path);
}

const wildcardTooltip = hoverTooltip((view, pos) => {
    // Problems on the same range already have a lint tooltip; this one adds the preview.
    const link = wildcardAt(view, pos);
    if (!link) return null;
    return {
        pos: link.from,
        end: link.to,
        above: true,
        create() {
            const dom = document.createElement("div");
            dom.className = "spl-tip spl-tip-wildcard";
            dom.textContent = "Loading…";
            wildcardPreview(link.path).then((data) => {
                dom.textContent = "";
                if (!data || !data.files.length) {
                    dom.textContent = `No wildcard file matches "${link.path}"`;
                    return;
                }
                const title = dom.appendChild(document.createElement("div"));
                title.className = "spl-tip-title";
                title.textContent = data.files.length === 1
                    ? `${data.files[0]}.txt · ${data.total} values`
                    : `${data.files.length} files · ${data.total} values`;
                const list = dom.appendChild(document.createElement("div"));
                list.className = "spl-tip-lines";
                for (const line of data.lines) {
                    list.appendChild(document.createElement("div")).textContent = line;
                }
                if (data.total > data.lines.length) {
                    const more = dom.appendChild(document.createElement("div"));
                    more.className = "spl-tip-hint";
                    more.textContent = `… and ${data.total - data.lines.length} more`;
                }
                if (data.files.length === 1 && window.sdPromptLabOpenWildcard) {
                    const hint = dom.appendChild(document.createElement("div"));
                    hint.className = "spl-tip-hint";
                    hint.textContent = "Ctrl/Cmd-click to open";
                }
            });
            return {dom};
        },
    };
}, {hoverTime: 350});

const wildcardLinks = EditorView.domEventHandlers({
    mousedown(event, view) {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({x: event.clientX, y: event.clientY});
        const link = pos == null ? null : wildcardAt(view, pos);
        if (!link || typeof window.sdPromptLabOpenWildcard !== "function") return false;
        event.preventDefault();
        window.sdPromptLabOpenWildcard(link.path);
        return true;
    },
    // Lets CSS show a link cursor/underline on wildcards while Ctrl/Cmd is held.
    mousemove(event, view) {
        view.dom.classList.toggle("spl-mod-down", event.metaKey || event.ctrlKey);
        return false;
    },
});

// ---- status bar --------------------------------------------------------------------

function statusPanel(view) {
    const dom = document.createElement("div");
    dom.className = "spl-status";
    dom.innerHTML = `
        <span class="spl-status-item" data-part="position"></span>
        <span class="spl-status-item" data-part="length"></span>
        <span class="spl-status-spacer"></span>
        <span class="spl-status-item spl-status-spell" data-part="spell" title="Misspelled words"></span>
        <button type="button" class="spl-status-item spl-status-problems" data-part="problems"
                title="Show problems (Ctrl/Cmd-Shift-M)"></button>`;
    const part = (name) => dom.querySelector(`[data-part="${name}"]`);
    const icon = (name) => `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;

    part("problems").addEventListener("click", () => {
        if (view.dom.querySelector(".cm-panel-lint")) closeLintPanel(view);
        else openLintPanel(view);
    });

    const render = () => {
        const state = view.state;
        const head = state.selection.main.head;
        const line = state.doc.lineAt(head);
        part("position").textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
        part("length").textContent = `${state.doc.length.toLocaleString()} chars`;

        const diagnostics = collectDiagnostics(state);
        const errors = diagnostics.filter((d) => d.severity === "error").length;
        const warnings = diagnostics.length - errors;
        const problems = part("problems");
        problems.innerHTML = `${icon("error")}<span>${errors}</span>${icon("warning")}<span>${warnings}</span>`;
        problems.classList.toggle("has-errors", errors > 0);
        problems.classList.toggle("has-warnings", errors === 0 && warnings > 0);

        const misspelled = view.plugin(spellChecker)?.decorations.size || 0;
        const spellPart = part("spell");
        spellPart.hidden = misspelled === 0;
        spellPart.innerHTML = `${icon("spellcheck")}<span>${misspelled}</span>`;
    };
    render();
    return {dom, update: render};
}

// ---- completion --------------------------------------------------------------------

let loraNamesPromise = null;

function loraNames() {
    if (!loraNamesPromise) {
        loraNamesPromise = fetch("/sd-prompt-lab/loras")
            .then((response) => (response.ok ? response.json() : {names: []}))
            .then((data) => data.names || [])
            .catch(() => []);
    }
    return loraNamesPromise;
}

// Insert `text`, adding `closer` unless it already follows the cursor.
function applyWithCloser(text, closer, isPresent) {
    return (view, completion, from, to) => {
        const present = isPresent(view.state.sliceDoc(to, to + closer.length));
        const insert = present ? text : text + closer;
        view.dispatch({
            changes: {from, to, insert},
            selection: {anchor: from + insert.length + (present ? closer.length : 0)},
            userEvent: "input.complete",
        });
    };
}

export async function promptCompletion(context) {
    const line = context.state.doc.lineAt(context.pos);
    const found = completionContext(line.text.slice(0, context.pos - line.from));
    if (!found) return null;
    const from = line.from + found.from;

    if (found.kind === "wildcard") {
        ensureWildcardNames();
        return {
            from,
            validFor: /^[A-Za-z0-9_\/.*\- ]*$/,
            options: [...wildcardNames.names].map((name) => ({
                label: name,
                type: "wildcard",
                apply: applyWithCloser(name, "__", (after) => after === "__"),
            })),
        };
    }

    if (found.kind === "variable") {
        const names = new Set(context.state.field(parseField).variables
            .filter((v) => v.kind === "set").map((v) => v.name));
        return {
            from,
            validFor: /^[A-Za-z0-9_-]*$/,
            options: [...names].map((name) => ({
                label: name,
                type: "variable",
                apply: applyWithCloser(name, "}", (after) => after === "}"),
            })),
        };
    }

    if (found.kind === "lora") {
        const names = await loraNames();
        if (context.aborted) return null;
        return {
            from,
            validFor: /^[^:<>]*$/,
            options: names.map((name) => ({
                label: name,
                type: "lora",
                apply: applyWithCloser(name, ":1>", (after) => after[0] === ":" || after[0] === ">"),
            })),
        };
    }

    // Tags: the server filters and ranks, so the list is used as returned.
    const controller = new AbortController();
    context.addEventListener("abort", () => controller.abort());
    let items = [];
    try {
        const response = await fetch(
            `/sd-prompt-lab/complete?q=${encodeURIComponent(found.query)}`, {signal: controller.signal});
        if (response.ok) items = (await response.json()).items || [];
    } catch (err) {
        return null;
    }
    if (context.aborted || !items.length) return null;
    return {
        from,
        filter: false,
        options: items.map((item, index) => {
            const text = item.kind === "tag" ? formatTag(item.label, settings.tag_underscores) : item.label;
            return {
                label: text,
                detail: item.kind === "tag" ? formatCount(item.count) : "saved",
                type: item.kind === "tag" ? `tag-${item.category ?? "x"}` : "saved",
                boost: -index,
            };
        }),
    };
}

// ---- public ------------------------------------------------------------------------

// The wildcard reference at a document position, or null. Works for every path the
// parser accepts (the old regex missed paths containing "_").
export function wildcardAt(view, pos) {
    const result = view.state.field(parseField, false);
    if (!result) return null;
    const hit = result.wildcards.find((w) => pos >= w.from && pos <= w.to);
    return hit && !hit.dynamic ? {path: hit.path, from: hit.from, to: hit.to} : null;
}

// Language support for a prompt editor.
//   mode         'prompt' | 'wildcard-file'
//   lint         show error/warning underlines (and hover messages)
//   gutter       show the lint marker gutter
//   activeBlock  highlight the {} block around the cursor
//   spellCheck   underline misspelled words (also needs the Settings switch on)
//   statusBar    cursor position, length and problem counts under the editor
//   links        wildcard hover preview and Ctrl/Cmd-click to open the file
export function promptLanguage({
    mode = "prompt",
    lint = true,
    gutter = true,
    activeBlock = true,
    spellCheck = false,
    statusBar = false,
    links = true,
} = {}) {
    const extensions = [
        modeFacet.of(mode),
        parseField,
        refreshField,
        trackView,
        highlightDecorations,
        blockFolding,
        // Only pair brackets: auto-closing quotes gets in the way of prose like "it's".
        // "#" comments also make Ctrl/Cmd-/ (toggle comment) work.
        EditorState.languageData.of(() => [{
            closeBrackets: {brackets: ["(", "[", "{"]},
            commentTokens: {line: "#"},
        }]),
    ];
    ensureSettings();
    if (links) {
        ensureWildcardNames();
        extensions.push(wildcardTooltip, wildcardLinks);
    }
    if (activeBlock) extensions.push(activeBlockDecorations);
    if (lint) {
        ensureWildcardNames();
        extensions.push(linter(lintSource, {
            delay: 200,
            // Re-lint when shared data (e.g. the wildcard file list) changes.
            needsRefresh: (update) => update.transactions.some(
                (tr) => tr.effects.some((e) => e.is(refreshEffect))),
        }));
        if (gutter) extensions.push(lintGutter());
    }
    if (spellCheck) extensions.push(spellChecker, spellingTooltip);
    if (statusBar) extensions.push(showPanel.of(statusPanel));
    return extensions;
}
