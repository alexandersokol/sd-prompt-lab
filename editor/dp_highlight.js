// Static HTML highlighting of a prompt (Browse cards), using the same token classes as
// the editor. Pure module.

import {parsePrompt} from "./dp_parser.js";

const ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const escapeHtml = (value) => value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

// Returns HTML for `text` with <span class="spl-tok-…"> around syntax. Text beyond
// `limit` characters is dropped (cards only show an excerpt).
export function highlightHtml(input, {mode = "prompt", limit = 4000} = {}) {
    const text = String(input ?? "").slice(0, limit);
    const classes = new Array(text.length).fill("");
    // Tokens are sorted by start, so a token nested in another overrides its parent.
    for (const token of parsePrompt(text, {mode}).tokens) {
        const cls = token.depth ? `spl-tok-${token.type} spl-depth-${token.depth}` : `spl-tok-${token.type}`;
        classes.fill(cls, token.from, Math.min(token.to, text.length));
    }

    let html = "";
    for (let i = 0; i < text.length;) {
        let j = i + 1;
        while (j < text.length && classes[j] === classes[i]) j++;
        const chunk = escapeHtml(text.slice(i, j));
        html += classes[i] ? `<span class="${classes[i]}">${chunk}</span>` : chunk;
        i = j;
    }
    return html;
}
