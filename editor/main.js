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
import {defaultKeymap, history, historyKeymap} from "@codemirror/commands";
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
    unwantedPrompts: defaultTags.namespace,
    unmatched: defaultTags.invalid,
    wildcard: defaultTags.className,

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

        if (stream.match(/__[^_]+(?:_[^_]+)*__/)) {
            return "wildcard";
        }

        if (stream.match("{")) {
            state.braceDepth++;
            return `brace${state.braceDepth}`;
        }
        if (stream.match("}")) {
            if (state.braceDepth === 0) return "unmatched";
            const depth = state.braceDepth;
            state.braceDepth--;
            return `brace${depth}`;
        }
        if (stream.match("(")) {
            state.parenDepth++;
            return `paren${state.parenDepth}`;
        }
        if (stream.match(")")) {
            if (state.parenDepth === 0) return "unmatched";
            const depth = state.parenDepth;
            state.parenDepth--;
            return `paren${depth}`;
        }

        if (stream.match("|")) {
            return state.braceDepth > 0
                ? `brace${state.braceDepth}`
                : `pipe`
        }

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
        commonPrompts = text
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

// npm install
// npm run build