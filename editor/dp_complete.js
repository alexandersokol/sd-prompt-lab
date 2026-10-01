// Decides what kind of completion applies at the cursor. Pure (no CodeMirror imports);
// the CodeMirror source that uses it lives in dp_extensions.js.

const TAG_BREAK_RE = /[^,\n|{}()[\]<>:]*$/;

// `lineBefore` is the text of the current line up to the cursor.
// Returns {kind, from, query} with `from` an offset into lineBefore, or null.
//   kind 'lora'      inside <lora:NAME
//   kind 'variable'  inside ${NAME
//   kind 'wildcard'  after an unclosed __
//   kind 'tag'       a plain comma segment of at least 2 characters
export function completionContext(lineBefore) {
    const text = String(lineBefore ?? '');

    // Never complete inside a comment.
    if (/(^|\s)#|\/\//.test(text)) return null;

    const lora = /<lora:([^:<>]*)$/i.exec(text);
    if (lora) return {kind: 'lora', from: text.length - lora[1].length, query: lora[1]};

    const variable = /\$\{\s*([A-Za-z0-9_-]*)$/.exec(text);
    if (variable) return {kind: 'variable', from: text.length - variable[1].length, query: variable[1]};

    // An odd number of "__" before the cursor means a wildcard is still open.
    const delimiters = text.match(/__/g);
    if (delimiters && delimiters.length % 2 === 1) {
        const open = text.lastIndexOf('__');
        const path = /^[~!@]?([A-Za-z0-9_\/.*\- ]*)$/.exec(text.slice(open + 2));
        if (path && !path[1].startsWith(' ')) {
            return {kind: 'wildcard', from: text.length - path[1].length, query: path[1]};
        }
        return null;
    }

    const segment = TAG_BREAK_RE.exec(text)[0];
    const query = segment.trimStart();
    // Weights ("0.5::"), bounds ("2$$") and bare numbers are not tags.
    if (query.length < 2 || !/^[A-Za-z0-9]/.test(query) || /^[\d.\s-]+$/.test(query) || query.includes('$')) return null;
    return {kind: 'tag', from: text.length - query.length, query};
}

// How a dataset tag is inserted. A1111 style turns "long_hair" into "long hair" and
// escapes parentheses, which would otherwise be read as emphasis.
export function formatTag(name, keepUnderscores) {
    if (keepUnderscores) return name;
    return name.replace(/_/g, ' ').replace(/[()]/g, '\\$&');
}

export function formatCount(count) {
    const n = Number(count) || 0;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return String(n);
}
