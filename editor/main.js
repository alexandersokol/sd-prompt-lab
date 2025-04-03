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
// namespace
// className
// macroName
// propertyName
// operator --
// comment --
// meta
// punctuation
// invalid --


const customTags = {
    loraEmbedding: defaultTags.comment,
    predefinedPrompt: defaultTags.keyword,
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

const predefinedPrompts = ["score9_up", "score7", "masterpiece art"];

// Define a simple tokenizer using StreamLanguage
const customLanguage = StreamLanguage.define({
    startState: () => ({
        braceDepth: 0,
        parenDepth: 0
    }),
    token: (stream, state) => {
        console.log(stream.string);
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
            if (predefinedPrompts.includes(word)) {
                return "predefinedPrompt";
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


window.initCodeMirror6 = (selector) => {
    const textarea = document.querySelector(selector);
    if (!textarea) return;

    textarea.style.display = "none";

    const view = new EditorView({
        state: EditorState.create({
            doc: textarea.value,
            extensions: [
                oneDark,
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
                autocompletion(),
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

    window.sdPromptLabEditor = view;
};

// npm install
// npm run build