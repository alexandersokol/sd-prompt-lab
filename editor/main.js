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
// import {oneDark} from "@codemirror/theme-one-dark";
import {autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap} from "@codemirror/autocomplete";
import {
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput, syntaxHighlighting, HighlightStyle
} from "@codemirror/language";
import {highlightSelectionMatches, searchKeymap} from "@codemirror/search";
import {defaultKeymap, history, historyKeymap} from "@codemirror/commands";
import {tags as t} from "@lezer/highlight"

// Using https://github.com/one-dark/vscode-one-dark-theme/ as reference for the colors

const chalky = "#e5c07b",
    coral = "#e06c75",
    cyan = "#56b6c2",
    invalid = "#ffffff",
    ivory = "#abb2bf",
    stone = "#7d8799", // Brightened compared to original to increase contrast
    malibu = "#61afef",
    sage = "#98c379",
    whiskey = "#d19a66",
    violet = "#c678dd",
    darkBackground = "#1652a3",
    highlightBackground = "#65dc24",
    background = "#7539b1",
    tooltipBackground = "#ffffff",
    selection = "#65dc24",
    cursor = "#528bff"

/// The colors used in the theme, as CSS color strings.
export const color = {
    chalky,
    coral,
    cyan,
    invalid,
    ivory,
    stone,
    malibu,
    sage,
    whiskey,
    violet,
    darkBackground,
    highlightBackground,
    background,
    tooltipBackground,
    selection,
    cursor
}

/// The editor theme styles for One Dark.
export const promptDarkTheme = EditorView.theme({
    "&": {
        color: ivory,
        backgroundColor: background
    },

    ".cm-content": {
        caretColor: cursor
    },

    ".cm-cursor, .cm-dropCursor": {borderLeftColor: cursor},
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {backgroundColor: selection},

    ".cm-panels": {backgroundColor: darkBackground, color: ivory},
    ".cm-panels.cm-panels-top": {borderBottom: "2px solid black"},
    ".cm-panels.cm-panels-bottom": {borderTop: "2px solid black"},

    ".cm-searchMatch": {
        backgroundColor: "#72a1ff59",
        outline: "1px solid #457dff"
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "#6199ff2f"
    },

    ".cm-activeLine": {backgroundColor: "#6699ff0b"},
    ".cm-selectionMatch": {backgroundColor: "#aafe661a"},

    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
        backgroundColor: "#bad0f847"
    },

    ".cm-gutters": {
        backgroundColor: background,
        color: stone,
        border: "none"
    },

    ".cm-activeLineGutter": {
        backgroundColor: highlightBackground
    },

    ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: "#ddd"
    },

    ".cm-tooltip": {
        border: "none",
        backgroundColor: tooltipBackground
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
        borderTopColor: "transparent",
        borderBottomColor: "transparent"
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
        borderTopColor: tooltipBackground,
        borderBottomColor: tooltipBackground
    },
    ".cm-tooltip-autocomplete": {
        "& > ul > li[aria-selected]": {
            backgroundColor: highlightBackground,
            color: ivory
        }
    },
    ".cm-paren": {
        backgroundColor: highlightBackground,
        color: coral
    }
}, {dark: true})

/// The highlighting style for code in the One Dark theme.
export const oneDarkHighlightStyle = HighlightStyle.define([
    {
        tag: t.paren,
        color: coral
    },
    {
        tag: t.squareBracket,
        color: coral
    },
    {
        tag: t.brace,
        color: coral
    },
    {
        tag: t.angleBracket,
        color: coral
    },
    {
        tag: t.keyword,
        color: violet
    },
    {
        tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
        color: coral
    },
    {
        tag: [t.function(t.variableName), t.labelName],
        color: malibu
    },
    {
        tag: [t.color, t.constant(t.name), t.standard(t.name)],
        color: whiskey
    },
    {
        tag: [t.definition(t.name), t.separator],
        color: ivory
    },
    {
        tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
        color: chalky
    },
    {
        tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
        color: cyan
    },
    {
        tag: [t.meta, t.comment],
        color: stone
    },
    {
        tag: t.strong,
        fontWeight: "bold"
    },
    {
        tag: t.emphasis,
        fontStyle: "italic"
    },
    {
        tag: t.strikethrough,
        textDecoration: "line-through"
    },
    {
        tag: t.link,
        color: stone,
        textDecoration: "underline"
    },
    {
        tag: t.heading,
        fontWeight: "bold",
        color: coral
    },
    {
        tag: [t.atom, t.bool, t.special(t.variableName)],
        color: whiskey
    },
    {
        tag: [t.processingInstruction, t.string, t.inserted],
        color: sage
    },
    {
        tag: t.invalid,
        color: invalid
    },
])


window.initCodeMirror6 = (selector) => {
    const textarea = document.querySelector(selector);
    if (!textarea) return;

    textarea.style.display = "none";

    const view = new EditorView({
        state: EditorState.create({
            doc: textarea.value,
            extensions: [
                promptDarkTheme,
                syntaxHighlighting(oneDarkHighlightStyle),
                lineNumbers(),
                foldGutter(),
                highlightSpecialChars(),
                history(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentOnInput(),
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