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
import {loadPromptLists, promptCompletion, promptLanguage, wildcardAt} from "./dp_extensions.js";
import {cleanUpPrompt, reformatPrompt} from "./dp_format.js";

// Shared editor setup. `language` is the promptLanguage() configuration for this editor.
function editorExtensions({language, onChange, onSave} = {}) {
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
        autocompletion({override: [promptCompletion], activateOnTyping: true}),
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
            {
                key: "Mod-s",
                preventDefault: true,
                run: () => {
                    if (typeof onSave === "function") onSave();
                    return true;
                }
            },
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

const CREATE_HEIGHT_KEY = "sd-prompt-lab:create-height";
const CREATE_MIN_HEIGHT = 360;
const CREATE_BOTTOM_GAP = 24;   // breathing room between the editor and the window edge

// Create tab editor. `onSave` runs on Ctrl/Cmd-S.
window.initCodeMirror6 = (selector, {onSave} = {}) => {
    const textarea = document.querySelector(selector);
    if (!textarea) return;

    loadPromptLists();

    textarea.style.display = "none";

    const view = new EditorView({
        state: EditorState.create({
            doc: textarea.value,
            extensions: editorExtensions({
                language: {mode: "prompt", spellCheck: true, statusBar: true},
                onSave
            })
        }),
        parent: textarea.parentNode
    });

    // The editor fills the space from its top edge down to the bottom of the window.
    // Dragging the resize handle sets an inline height instead, which is remembered;
    // double-clicking the handle corner goes back to filling.
    view.dom.classList.add("sd-prompt-lab-create-codemirror");
    const fitHeight = () => {
        const rect = view.dom.getBoundingClientRect();
        if (!rect.width) return;    // tab is hidden; measured again once it is shown
        const top = rect.top + window.scrollY;
        const height = Math.max(CREATE_MIN_HEIGHT, Math.floor(window.innerHeight - top - CREATE_BOTTOM_GAP));
        view.dom.style.setProperty("--spl-create-fill", `${height}px`);
        view.requestMeasure();
    };
    try {
        const saved = Number(localStorage.getItem(CREATE_HEIGHT_KEY));
        if (saved >= 200) view.dom.style.height = `${saved}px`;
        new ResizeObserver(() => {
            if (view.dom.style.height) localStorage.setItem(CREATE_HEIGHT_KEY, String(parseInt(view.dom.style.height, 10)));
            view.requestMeasure();
        }).observe(view.dom);
        // Fires when the tab holding the editor becomes visible.
        new IntersectionObserver(fitHeight).observe(view.dom);
        view.dom.addEventListener("dblclick", (event) => {
            const rect = view.dom.getBoundingClientRect();
            if (rect.right - event.clientX > 18 || rect.bottom - event.clientY > 18) return;
            view.dom.style.removeProperty("height");
            localStorage.removeItem(CREATE_HEIGHT_KEY);
            fitHeight();
        });
    } catch (err) {
        // localStorage / observers unavailable: the CSS fallback height still applies.
    }
    window.addEventListener("resize", fitHeight);
    fitHeight();

    window.sdPromptLabEditor = view;
};

// A standalone editor state (own document, undo history and selection). The Wildcard
// Editor keeps one per open file and swaps them into its single view with setState().
//   mode        'wildcard-file' (one value per line, default) | 'prompt'
//   spellCheck  underline misspelled words (default on)
//   statusBar   cursor position and problem counts under the editor (default on)
window.createSdPromptLabEditorState = ({
    doc = "", onChange, onSave, mode = "wildcard-file", spellCheck = true, statusBar = true
} = {}) => {
    return EditorState.create({
        doc,
        extensions: editorExtensions({language: {mode, spellCheck, statusBar}, onChange, onSave})
    });
};

window.createSdPromptLabWildcardEditor = ({parent, doc = "", onChange, onSave, mode, spellCheck, statusBar} = {}) => {
    if (!parent) return null;

    loadPromptLists();

    const view = new EditorView({
        state: window.createSdPromptLabEditorState({doc, onChange, onSave, mode, spellCheck, statusBar}),
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
                promptLanguage({mode: "prompt", gutter: false, activeBlock: false, spellCheck: false, links: false})
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
