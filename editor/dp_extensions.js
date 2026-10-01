// CodeMirror glue for the dynamic prompts language: highlighting, error underlines,
// active {} block, folding and spell check. All of it is driven by one parse of the
// document (dp_parser.js), kept in a state field.

import {EditorState, Facet, StateEffect, StateField} from "@codemirror/state";
import {Decoration, EditorView, ViewPlugin} from "@codemirror/view";
import {foldService} from "@codemirror/language";
import {linter, lintGutter} from "@codemirror/lint";
import {extractWords, innermostBlock, parsePrompt, resolveWildcard} from "./dp_parser.js";


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

async function loadWildcardNames() {
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

const spell = {
    enabled: true,
    settingsRequested: false,
    dictionary: null,          // Set of known lower-case words, once loaded
    dictionaryPromise: null,
    failed: false,
    verdicts: new Map(),       // word -> true (known) | false (misspelled), from the server
};

function ensureSpellSettings() {
    if (spell.settingsRequested) return;
    spell.settingsRequested = true;
    fetch("/sd-prompt-lab/settings")
        .then((response) => (response.ok ? response.json() : {}))
        .then((settings) => {
            spell.enabled = settings.spell_check !== false;
            refreshAllViews();
        })
        .catch(() => {});
    window.addEventListener("sd-prompt-lab:settings-changed", (event) => {
        spell.enabled = event.detail?.spell_check !== false;
        refreshAllViews();
    });
}

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

function lintSource(view) {
    const state = view.state;
    const result = state.field(parseField);
    const length = state.doc.length;
    const diagnostics = [];
    const push = (from, to, severity, message) => {
        from = Math.min(from, length);
        to = Math.min(Math.max(to, from), length);
        diagnostics.push({from, to, severity, message, source: "Prompt Lab"});
    };

    for (const d of result.diagnostics) push(d.from, d.to, d.severity, d.message);

    if (wildcardNames.ready) {
        for (const wildcard of result.wildcards) {
            if (wildcard.dynamic || resolveWildcard(wildcard.path, wildcardNames.names)) continue;
            push(wildcard.from, wildcard.to, "warning",
                `No wildcard file matches "${wildcard.path}"`);
        }
    }
    return diagnostics;
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
        if (!spell.enabled || spell.failed) {
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
export function promptLanguage({
    mode = "prompt",
    lint = true,
    gutter = true,
    activeBlock = true,
    spellCheck = false,
} = {}) {
    const extensions = [
        modeFacet.of(mode),
        parseField,
        refreshField,
        trackView,
        highlightDecorations,
        blockFolding,
        // Only pair brackets: auto-closing quotes gets in the way of prose like "it's".
        EditorState.languageData.of(() => [{closeBrackets: {brackets: ["(", "[", "{"]}}]),
    ];
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
    if (spellCheck) {
        ensureSpellSettings();
        extensions.push(spellChecker);
    }
    return extensions;
}
