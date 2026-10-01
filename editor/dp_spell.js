// Spelling suggestions from a plain word set (no frequency data). Pure module.

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function edits(word) {
    const out = [];
    for (let i = 0; i <= word.length; i++) {
        const head = word.slice(0, i);
        const tail = word.slice(i);
        if (tail) out.push(head + tail.slice(1));                                   // delete
        if (tail.length > 1) out.push(head + tail[1] + tail[0] + tail.slice(2));    // transpose
        for (const letter of LETTERS) {
            if (tail) out.push(head + letter + tail.slice(1));                      // replace
            out.push(head + letter + tail);                                         // insert
        }
    }
    return out;
}

// Candidates that keep the first letter and a similar length tend to be the intended word.
function rank(word, candidates) {
    return [...candidates].sort((a, b) => {
        const first = (b[0] === word[0]) - (a[0] === word[0]);
        if (first) return first;
        const length = Math.abs(a.length - word.length) - Math.abs(b.length - word.length);
        return length || a.localeCompare(b);
    });
}

// Up to `limit` dictionary words one edit away from `word` (two edits if none are).
// The suggestion keeps the capitalisation of the original's first letter.
export function suggest(word, dictionary, limit = 5) {
    const lower = String(word ?? '').toLowerCase();
    if (!lower || !dictionary || dictionary.has(lower)) return [];

    const first = edits(lower);
    let found = new Set(first.filter((candidate) => dictionary.has(candidate)));
    if (!found.size && lower.length <= 12) {
        found = new Set();
        for (const candidate of first) {
            for (const second of edits(candidate)) {
                if (dictionary.has(second)) found.add(second);
            }
        }
    }
    found.delete(lower);

    const capitalised = word[0] !== lower[0];
    return rank(lower, found).slice(0, limit)
        .map((candidate) => (capitalised ? candidate[0].toUpperCase() + candidate.slice(1) : candidate));
}
