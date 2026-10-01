// Quick fixes for parser diagnostics. Pure: each fix is a list of text changes, so the
// same logic can be unit-tested and applied as a CodeMirror transaction.
//
//   quickFixes(text, diagnostic) -> [{name, changes: [{from, to, insert}]}]

const REMOVE_LABEL = {
    'unmatched-brace': 'Remove "}"', 'unmatched-paren': 'Remove ")"', 'unmatched-bracket': 'Remove "]"',
    'unclosed-paren': 'Remove "("', 'unclosed-bracket': 'Remove "["',
};

const lineEndAt = (text, pos) => {
    const nl = text.indexOf('\n', pos);
    return nl === -1 ? text.length : nl;
};

// Bounds of the comma-separated segment around `pos`, without surrounding whitespace.
function segmentAround(text, pos) {
    let from = pos;
    while (from > 0 && text[from - 1] !== ',' && text[from - 1] !== '\n') from--;
    let to = pos;
    while (to < text.length && text[to] !== ',' && text[to] !== '\n') to++;
    while (from < to && /\s/.test(text[from])) from++;
    while (to > from && /\s/.test(text[to - 1])) to--;
    return {from, to};
}

// End (exclusive) of the ${...} group that starts at `from`, or -1.
function variableEnd(text, from) {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return i + 1;
    }
    return -1;
}

export function quickFixes(text, diagnostic) {
    const {code, from, to} = diagnostic;

    if (REMOVE_LABEL[code]) {
        return [{name: REMOVE_LABEL[code], changes: [{from, to, insert: ''}]}];
    }

    if (code === 'unclosed-brace') {
        const end = lineEndAt(text, from);
        return [
            {name: 'Close at end of line', changes: [{from: end, to: end, insert: '}'}]},
            {name: 'Remove "{"', changes: [{from, to, insert: ''}]},
        ];
    }

    if (code === 'pipe-outside') {
        const segment = segmentAround(text, from);
        return [{
            name: 'Wrap options in {}',
            changes: [{from: segment.from, to: segment.from, insert: '{'}, {from: segment.to, to: segment.to, insert: '}'}],
        }];
    }

    if (code === 'wildcard-underscore' || code === 'wildcard-double-underscore') {
        const core = text.slice(from, to).replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_');
        if (!core) return [];
        return [{name: 'Fix underscores', changes: [{from, to, insert: `__${core}__`}]}];
    }

    if (code === 'variable-in-variant') {
        const end = variableEnd(text, from);
        if (end === -1) return [];
        return [{
            name: 'Move definition to the top',
            changes: [{from: 0, to: 0, insert: `${text.slice(from, end)}\n`}, {from, to: end, insert: ''}],
        }];
    }

    return [];
}

// Apply a fix's changes to a string (positions refer to the original text).
export function applyChanges(text, changes) {
    let out = text;
    for (const change of [...changes].sort((a, b) => b.from - a.from)) {
        out = out.slice(0, change.from) + change.insert + out.slice(change.to);
    }
    return out;
}
