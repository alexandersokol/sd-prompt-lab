import {
  EditorView, keymap, highlightSpecialChars, drawSelection,
  highlightActiveLine, dropCursor, rectangularSelection,
  crosshairCursor, lineNumbers, highlightActiveLineGutter
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  autocompletion, completionKeymap, closeBrackets,
  closeBracketsKeymap
} from "@codemirror/autocomplete";
import {
  defaultHighlightStyle, syntaxHighlighting, indentOnInput,
  bracketMatching, foldGutter, foldKeymap
} from "@codemirror/language";
import {
  searchKeymap, highlightSelectionMatches
} from "@codemirror/search";
import {
  defaultKeymap, history, historyKeymap
} from "@codemirror/commands";

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
        syntaxHighlighting(defaultHighlightStyle),
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