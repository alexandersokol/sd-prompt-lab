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
import {
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput,
    StreamLanguage,
    syntaxHighlighting
} from "@codemirror/language";
import {highlightSelectionMatches, searchKeymap} from "@codemirror/search";
import {defaultKeymap, history, historyKeymap, indentWithTab} from "@codemirror/commands";
import {classHighlighter, tags as defaultTags} from "@lezer/highlight";

// link --
// heading --
// emphasis --
// strong --
// keyword --
// atom --
// bool --
// url --
// labelName --
// inserted --
// deleted --
// literal
// string
// number --
// variableName
// typeName
// namespace --
// className
// macroName --
// propertyName
// operator --
// comment --
// meta
// punctuation
// invalid --


const customTags = {
    loraEmbedding: defaultTags.comment,
    commonPrompt: defaultTags.keyword,
    unwantedPrompt: defaultTags.namespace,
    wildcardLink: defaultTags.url,
    wildcardPipe: defaultTags.operator,
    wildcardWeight: defaultTags.number,
    wildcardPick: defaultTags.atom,
    wildcardSeparator: defaultTags.string,
    variableSet: defaultTags.definition(defaultTags.variableName),
    variableUse: defaultTags.variableName,
    unmatched: defaultTags.invalid,

    brace1: defaultTags.macroName,
    brace2: defaultTags.heading,
    brace3: defaultTags.operator,
    brace4: defaultTags.strong,
    brace5: defaultTags.atom,

    paren1: defaultTags.bool,
    paren2: defaultTags.url,
    paren3: defaultTags.labelName,
    paren4: defaultTags.inserted,
    paren5: defaultTags.deleted,
};

const wildcardTags = {
    wildcardLink: defaultTags.url,
    wildcardPipe: defaultTags.operator,
    wildcardWeight: defaultTags.number,
    wildcardPick: defaultTags.atom,
    wildcardSeparator: defaultTags.string,
    variableSet: defaultTags.definition(defaultTags.variableName),
    variableUse: defaultTags.variableName,
    unmatched: defaultTags.invalid,

    brace1: defaultTags.macroName,
    brace2: defaultTags.heading,
    brace3: defaultTags.operator,
    brace4: defaultTags.strong,
    brace5: defaultTags.atom,

    paren1: defaultTags.bool,
    paren2: defaultTags.url,
    paren3: defaultTags.labelName,
    paren4: defaultTags.inserted,
    paren5: defaultTags.deleted,
};

let commonPrompts = [];
let unwantedPrompts = [];

// Define a simple tokenizer using StreamLanguage
const customLanguage = StreamLanguage.define({
    startState: () => ({
        braceDepth: 0,
        parenDepth: 0
    }),
    token: (stream, state) => {
        // Skip spaces
        if (stream.eatSpace()) return null;

        // LORA pattern search
        if (stream.peek() === "<") {
            const startPos = stream.pos;
            const rest = stream.string.slice(startPos);
            const match = rest.match(/^<lora:[^>]+>/);
            if (match) {
                stream.pos += match[0].length; // advance the stream
                return "loraEmbedding";
            }
        }

        const wildcardToken = tryWildcardToken(stream, state);
        if (wildcardToken) return wildcardToken;

        if (stream.match(/[^,{}()|]+(?=,|$)/)) {
            const word = stream.current().trim();
            if (commonPrompts.includes(word)) {
                return "commonPrompt";
            }
            if (unwantedPrompts.includes(word)) {
                return "unwantedPrompt";
            }
        }

        stream.next();
        return null;
    },
    tokenTable: customTags,
    blankLine: (state) => {
        state.braceDepth = 0;
        state.parenDepth = 0;
    },
});

function consumeVariableToken(stream) {
    const rest = stream.string.slice(stream.pos);
    if (!rest.startsWith("${")) return null;

    let innerBraceDepth = 0;
    for (let i = 2; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === "{") {
            innerBraceDepth++;
        } else if (ch === "}") {
            if (innerBraceDepth > 0) {
                innerBraceDepth--;
            } else {
                const token = rest.slice(0, i + 1);
                stream.pos += token.length;
                return token.includes("=") ? "variableSet" : "variableUse";
            }
        }
    }

    stream.pos = stream.string.length;
    return "unmatched";
}

function tryWildcardToken(stream, state) {
    const variableToken = consumeVariableToken(stream);
    if (variableToken) return variableToken;

    const rest = stream.string.slice(stream.pos);

    if (stream.match(/^__[^_\n]+?__/)) {
        return "wildcardLink";
    }

    const weightModifier = rest.match(/^\(:-?\d+(?:\.\d+)?\)/);
    if (weightModifier) {
        stream.pos += weightModifier[0].length;
        return "wildcardWeight";
    }

    if (state.braceDepth > 0 && stream.match(/^-?\d+(?:\.\d+)?::/)) {
        return "wildcardWeight";
    }

    if (state.braceDepth > 0 && stream.match(/^\d+\$\$/)) {
        return "wildcardPick";
    }

    if (state.braceDepth > 0 && stream.match(/^[^|{}$]*\$\$/)) {
        return "wildcardSeparator";
    }

    if (stream.match("{")) {
        if (!stream.string.slice(stream.pos).includes("}")) return "unmatched";
        state.braceDepth++;
        return `brace${Math.min(state.braceDepth, 5)}`;
    }
    if (stream.match("}")) {
        if (state.braceDepth === 0) return "unmatched";
        const depth = state.braceDepth;
        state.braceDepth--;
        return `brace${Math.min(depth, 5)}`;
    }
    if (stream.match("(")) {
        if (!stream.string.slice(stream.pos).includes(")")) return "unmatched";
        state.parenDepth++;
        return `paren${Math.min(state.parenDepth, 5)}`;
    }
    if (stream.match(")")) {
        if (state.parenDepth === 0) return "unmatched";
        const depth = state.parenDepth;
        state.parenDepth--;
        return `paren${Math.min(depth, 5)}`;
    }

    if (stream.match("|")) {
        return "wildcardPipe";
    }

    return null;
}

const wildcardLanguage = StreamLanguage.define({
    startState: () => ({
        braceDepth: 0,
        parenDepth: 0
    }),
    token: (stream, state) => {
        if (stream.eatSpace()) return null;

        const wildcardToken = tryWildcardToken(stream, state);
        if (wildcardToken) return wildcardToken;

        stream.next();
        return null;
    },
    tokenTable: wildcardTags,
    blankLine: (state) => {
        state.braceDepth = 0;
        state.parenDepth = 0;
    },
});

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

async function loadPredefinedPrompts() {
    try {
        const response = await fetch(`/file/extensions/sd-prompt-lab/common_prompts.txt?v=${Date.now()}`);
        if (!response.ok) throw new Error("Failed to load prompts");

        const text = await response.text();

        // Split lines, trim, and filter empty ones
        commonPrompts = text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#')); // ignore empty lines and comments
    } catch (err) {
        console.error("Could not load common_prompts.txt:", err);
    }

    try {
        const response = await fetch(`/file/extensions/sd-prompt-lab/unwanted_prompts.txt?v=${Date.now()}`);
        if (!response.ok) throw new Error("Failed to load prompts");

        const text = await response.text();

        // Split lines, trim, and filter empty ones
        unwantedPrompts = text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#')); // ignore empty lines and comments
    } catch (err) {
        console.error("Could not load unwanted_prompts.txt:", err);
    }
}

window.initCodeMirror6 = (selector) => {
    const textarea = document.querySelector(selector);
    if (!textarea) return;

    loadPredefinedPrompts();

    textarea.style.display = "none";

    const view = new EditorView({
        state: EditorState.create({
            doc: textarea.value,
            extensions: [
                oneDark,
                EditorView.lineWrapping,
                lineNumbers(),
                foldGutter(),
                highlightSpecialChars(),
                history(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentOnInput(),
                customLanguage,
                syntaxHighlighting(classHighlighter),
                bracketMatching(),
                closeBrackets(),
                autocompletion({override: [promptWordsAutocomplete], activateOnTyping: true}),
                rectangularSelection(),
                crosshairCursor(),
                highlightActiveLine(),
                highlightActiveLineGutter(),
                highlightSelectionMatches(),
                keymap.of([
                    indentWithTab,
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...searchKeymap,
                    ...historyKeymap,
                    ...foldKeymap,
                    ...completionKeymap
                ])
            ]
        }),
        parent: textarea.parentNode
    });

    view.dom.style.height = "600px"; // 40 * 15px line height approx
    view.dom.style.overflow = "auto"; // Optional: scroll inside view

    window.sdPromptLabEditor = view;
};

window.createSdPromptLabWildcardEditor = ({parent, doc = "", onChange} = {}) => {
    if (!parent) return null;

    loadPredefinedPrompts();

    const view = new EditorView({
        state: EditorState.create({
            doc,
            extensions: [
                oneDark,
                EditorView.lineWrapping,
                lineNumbers(),
                foldGutter(),
                highlightSpecialChars(),
                history(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentOnInput(),
                wildcardLanguage,
                syntaxHighlighting(classHighlighter),
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
                    ...completionKeymap
                ])
            ]
        }),
        parent
    });

    view.dom.classList.add("sd-prompt-lab-wildcard-codemirror");
    return view;
};

window.setSdPromptLabEditorDocument = (view, doc = "") => {
    if (!view) return;
    view.dispatch({
        changes: {from: 0, to: view.state.doc.length, insert: doc}
    });
};

// npm install
// npm run build
