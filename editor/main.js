import {
    EditorView, keymap, highlightSpecialChars, drawSelection,
    highlightActiveLine, dropCursor, rectangularSelection,
    crosshairCursor, lineNumbers, highlightActiveLineGutter
} from "@codemirror/view";
import {EditorState} from "@codemirror/state";
import {oneDark} from "@codemirror/theme-one-dark";
import {
    autocompletion, completionKeymap, closeBrackets,
    closeBracketsKeymap
} from "@codemirror/autocomplete";
import {
    defaultHighlightStyle, syntaxHighlighting, indentOnInput, StreamLanguage, HighlightStyle,
    bracketMatching, foldGutter, foldKeymap
} from "@codemirror/language";
import {
    searchKeymap, highlightSelectionMatches
} from "@codemirror/search";
import {
    defaultKeymap, history, historyKeymap
} from "@codemirror/commands";
import {Tag, tags as defaultTags, styleTags} from "@lezer/highlight";

const customTags = {
    level1Brace: Tag.define(),
    level2Brace: Tag.define(),
    level3Brace: Tag.define(),
    parens: Tag.define(),
    unmatched: Tag.define(),
    loraEmbedding: Tag.define(),
};

// Define a simple tokenizer using StreamLanguage
const customLanguage = StreamLanguage.define({
    startState: () => ({braceDepth: 0}),
    token: (stream, state) => {
        if (stream.match(/<lora:[^>]+>/)) {
            return "loraEmbedding";
        }
        if (stream.match("{")) {
            state.braceDepth++;
            if (state.braceDepth === 1) return "level1Brace";
            if (state.braceDepth === 2) return "level2Brace";
            if (state.braceDepth >= 3) return "level3Brace";
        }
        if (stream.match("}")) {
            if (state.braceDepth === 0) return "unmatched";
            if (state.braceDepth === 1) {
                state.braceDepth--;
                return "level1Brace";
            }
            if (state.braceDepth === 2) {
                state.braceDepth--;
                return "level2Brace";
            }
            if (state.braceDepth >= 3) {
                state.braceDepth--;
                return "level3Brace";
            }
        }
        if (stream.match("(") || stream.match(")")) {
            return "parens";
        }
        stream.next();
        return null;
    },
    tokenTable: customTags,
    blankLine: (state) => {
        state.braceDepth = 0;
    },
});

// Extension to apply highlighting styles

// Define the highlighting styles for our custom tags
const customHighlightStyle = HighlightStyle.define([
    {tag: customTags.level1Brace, color: "#d5465c"}, // Light pink for level 1 braces
    {tag: customTags.level2Brace, color: "#006d91"}, // Light blue for level 2 braces
    {tag: customTags.level3Brace, color: "#009800"}, // Light green for level 3 braces
    {tag: customTags.parens, color: "#FFD700"}, // Gold for parentheses
    {tag: customTags.unmatched, color: "#FF0000", fontWeight: "bold"}, // Bold red for unmatched braces/parens
    {tag: customTags.loraEmbedding, color: "#347395"}, // Light sky blue for LoRA embeddings
]);


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
                syntaxHighlighting(customHighlightStyle),
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