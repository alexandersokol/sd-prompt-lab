// Syntax-aware prompt tidying for the Create tab's Reformat / Clean Up buttons.
//
// Pure module built on dp_parser.js. Everything the parser recognises as structure
// (comments, {} / ${} / %{} blocks, wildcards, <lora:…> tags) is protected and copied
// through verbatim; only plain top-level text is normalised. Line breaks are kept.

import {parsePrompt} from "./dp_parser.js";

const REMOVABLE = new Set([
    'unmatched-brace', 'unmatched-paren', 'unmatched-bracket',
    'unclosed-brace', 'unclosed-paren', 'unclosed-bracket',
]);
const PROTECTED_TOKENS = new Set(['comment', 'lora', 'wildcard', 'variableSet', 'variableUse']);

// Private-use characters stand in for protected regions while regexes run.
const MASK_OPEN = '';
const MASK_CLOSE = '';
const MASK_RE = /(\d+)/g;

function removeRanges(text, ranges) {
    let out = text;
    for (const range of [...ranges].sort((a, b) => b.from - a.from)) {
        out = out.slice(0, range.from) + out.slice(range.to);
    }
    return out;
}

const insideBlock = (blocks, pos) => blocks.some((block) => pos >= block.from && pos < block.to);

// Replace every protected region with a placeholder; returns {masked, parts}.
function mask(text) {
    const result = parsePrompt(text);
    const protect = new Uint8Array(text.length);
    for (const block of result.blocks) protect.fill(1, block.from, block.to);
    for (const token of result.tokens) {
        if (PROTECTED_TOKENS.has(token.type)) protect.fill(1, token.from, token.to);
    }

    const parts = [];
    let masked = '';
    for (let i = 0; i < text.length;) {
        if (!protect[i]) {
            masked += text[i++];
            continue;
        }
        let j = i;
        while (j < text.length && protect[j]) j++;
        // A comment runs to the end of its line: remember that, so duplicates logic can tell.
        const isComment = result.tokens.some((t) => t.type === 'comment' && t.from >= i && t.to <= j);
        parts.push({text: text.slice(i, j), isComment});
        masked += `${MASK_OPEN}${parts.length - 1}${MASK_CLOSE}`;
        i = j;
    }
    return {masked, parts};
}

const unmask = (masked, parts) => masked.replace(MASK_RE, (_, index) => parts[Number(index)].text);

function normalise(masked) {
    const lines = masked
        .replace(/[ \t]+/g, ' ')
        .replace(/ ?,(?: ?,)* ?/g, ', ')     // spacing around commas, runs of commas -> one
        .split('\n')
        .map((line) => line.trim());

    // A comma that opens a line is redundant when nothing precedes it or the previous
    // line already ends with one.
    let previous = '';
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(',') && (previous === '' || previous.endsWith(','))) {
            lines[i] = lines[i].replace(/^,\s*/, '');
        }
        if (lines[i] !== '') previous = lines[i];
    }
    return lines.join('\n');
}

function splitLoras(text) {
    const result = parsePrompt(text);
    const loras = result.tokens.filter((t) => t.type === 'lora' && !insideBlock(result.blocks, t.from));
    return {
        body: removeRanges(text, loras),
        loras: loras.map((t) => text.slice(t.from, t.to)),
    };
}

function assemble(body, loras) {
    const trimmed = body.replace(/[\s,]+$/, '');
    if (!loras.length) return trimmed;
    return trimmed ? `${trimmed},\n${loras.join(', ')}` : loras.join(', ');
}

function prepare(input) {
    const text = String(input ?? '');
    // 1. Drop brackets that have no partner.
    const stray = parsePrompt(text).diagnostics.filter((d) => REMOVABLE.has(d.code));
    // 2. Pull top-level <lora:…> tags out; they go on a final line.
    const {body, loras} = splitLoras(removeRanges(text, stray));
    // 3. Normalise the plain text around protected regions.
    const {masked, parts} = mask(body);
    return {masked: normalise(masked), parts, loras};
}

export function reformatPrompt(input) {
    const {masked, parts, loras} = prepare(input);
    return assemble(unmask(masked, parts), loras);
}

// Reformat, then remove duplicated top-level comma segments (case-insensitive, first wins).
export function cleanUpPrompt(input) {
    const {masked, parts, loras} = prepare(input);
    const seen = new Set();
    const isDuplicate = (segment) => {
        const hasComment = [...segment.matchAll(MASK_RE)].some((m) => parts[Number(m[1])].isComment);
        const key = unmask(segment, parts).trim().toLowerCase();
        if (!key || hasComment || key === 'break') return false;
        if (seen.has(key)) return true;
        seen.add(key);
        return false;
    };

    const lines = [];
    for (const line of masked.split('\n')) {
        if (line === '') {
            lines.push(line);
            continue;
        }
        const trailingComma = line.endsWith(',');
        const kept = line.split(', ')
            .map((segment) => segment.replace(/,$/, ''))
            .filter((segment) => segment !== '' && !isDuplicate(segment));
        if (!kept.length) continue;     // the whole line was duplicates
        lines.push(kept.join(', ') + (trailingComma ? ',' : ''));
    }

    const uniqueLoras = loras.filter((lora) => !isDuplicate(lora));
    return assemble(unmask(normalise(lines.join('\n')), parts), uniqueLoras);
}
