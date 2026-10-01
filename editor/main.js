import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    rectangularSelection
} from "@codemirror/view";
import {EditorState} from "@codemirror/state";
import {oneDark} from "@codemirror/theme-one-dark";
import {autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap} from "@codemirror/autocomplete";
import {bracketMatching, foldGutter, foldKeymap} from "@codemirror/language";
import {highlightSelectionMatches, searchKeymap} from "@codemirror/search";
import {defaultKeymap, history, historyKeymap, indentWithTab} from "@codemirror/commands";
import {lintKeymap} from "@codemirror/lint";
import {loadPromptLists, promptLanguage, wildcardAt} from "./dp_extensions.js";
import {cleanUpPrompt, reformatPrompt} from "./dp_format.js";

function promptWordsAutocomplete(context) {
    let word = context.matchBefore(/\w+/);

    if (!word) return null;

    const query = word.text;

    // Only trigger if query is at least 3 letters and contains only letters
    if (query.length < 3 || !/^[a-zA-Z]+$/.test(query)) return null;

    return fetch(`/sd-prompt-lab/autocomplete?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => {
            return {
                from: word.from,
                options: data.results.map(w => ({label: w, type: "keyword"})),
                validFor: /^\w*$/
            };
        });
}

// Shared editor setup. `language` is the promptLanguage() configuration for this editor.
function editorExtensions({language, onChange} = {}) {
    return [
        oneDark,
        EditorView.lineWrapping,
        lineNumbers(),
        foldGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        promptLanguage(language),
        bracketMatching(),
        closeBrackets(),
        autocompletion({override: [promptWordsAutocomplete], activateOnTyping: true}),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        EditorView.updateListener.of((update) => {
            if (update.docChanged && typeof onChange === "function") {
                onChange(update.state.doc.toString());
            }
        }),
        keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap
        ])
    ];
}

// Create tab editor.
window.initCodeMirror6 = (selector) => {
    const textarea = document.querySelector(selector);
    if (!textarea) return;

    loadPromptLists();

    textarea.style.display = "none";

    const view = new EditorView({
        state: EditorState.create({
            doc: textarea.value,
            extensions: editorExtensions({language: {mode: "prompt", spellCheck: true}})
        }),
        parent: textarea.parentNode
    });

    view.dom.classList.add("sd-prompt-lab-create-codemirror");
    view.dom.style.height = "600px"; // 40 * 15px line height approx
    view.dom.style.overflow = "auto"; // Optional: scroll inside view

    window.sdPromptLabEditor = view;
};

// A standalone editor state (own document, undo history and selection). The Wildcard
// Editor keeps one per open file and swaps them into its single view with setState().
//   mode        'wildcard-file' (one value per line, default) | 'prompt'
//   spellCheck  underline misspelled words (default on)
window.createSdPromptLabEditorState = ({doc = "", onChange, mode = "wildcard-file", spellCheck = true} = {}) => {
    return EditorState.create({
        doc,
        extensions: editorExtensions({language: {mode, spellCheck}, onChange})
    });
};

window.createSdPromptLabWildcardEditor = ({parent, doc = "", onChange, mode, spellCheck} = {}) => {
    if (!parent) return null;

    loadPromptLists();

    const view = new EditorView({
        state: window.createSdPromptLabEditorState({doc, onChange, mode, spellCheck}),
        parent
    });

    view.dom.classList.add("sd-prompt-lab-wildcard-codemirror");
    return view;
};

// Read-only, highlighted prompt view (Browse preview popup).
window.createSdPromptLabReadOnlyView = ({parent, doc = ""} = {}) => {
    if (!parent) return null;

    loadPromptLists();

    const view = new EditorView({
        state: EditorState.create({
            doc,
            extensions: [
                oneDark,
                EditorView.lineWrapping,
                EditorState.readOnly.of(true),
                EditorView.editable.of(false),
                highlightSpecialChars(),
                promptLanguage({mode: "prompt", gutter: false, activeBlock: false, spellCheck: false})
            ]
        }),
        parent
    });

    view.dom.classList.add("sd-prompt-lab-readonly-codemirror");
    return view;
};

window.setSdPromptLabEditorDocument = (view, doc = "") => {
    if (!view) return;
    view.dispatch({
        changes: {from: 0, to: view.state.doc.length, insert: doc}
    });
};

// Syntax-aware tidying used by the Create tab's Reformat / Clean Up buttons.
window.sdPromptLabFormat = {reformat: reformatPrompt, cleanUp: cleanUpPrompt};

// {path, from, to} of the wildcard reference at a document position, or null.
window.sdPromptLabWildcardAt = wildcardAt;

// npm install
// npm run build
