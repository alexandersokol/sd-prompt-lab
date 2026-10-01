// Whole-document parser for the sd-dynamic-prompts template language, plus the A1111
// bits that live alongside it in prompts ((emphasis), [alternation], <lora:...>).
//
// Pure module (no CodeMirror imports) so it can be unit-tested in Node. It mirrors the
// grammar in dynamicprompts/parser/parse.py and never throws: malformed input produces
// diagnostics and parsing continues.
//
//   parsePrompt(text, {mode}) -> {tokens, diagnostics, blocks, wildcards, variables, text}
//
//   tokens      [{from, to, type, depth?}]            highlighting
//   diagnostics [{from, to, severity, code, message}] 'error' | 'warning'
//   blocks      [{from, to, depth}]                   balanced {...}, ${...}, %{...}
//   wildcards   [{from, to, path, dynamic}]           for the missing-file check
//   variables   [{from, to, name, kind, hasDefault}]  kind: 'set' | 'use'
//   text        [{from, to}]                          plain prompt text (spell check)

const SAMPLERS = '~!@';
const BOUND_RE = /(\d+-\d+|\d+-|-\d+|\d+)\$\$/y;
const SEPARATOR_RE = /[^${}]+\$\$/y;
const WEIGHT_RE = /(\s*)([+-]?(?:\d+\.\d*|\.\d+|\d+))::/y;
const BAD_WEIGHT_RE = /(\s*)([^\s|{}:$,]+)::/y;
const VAR_HEAD_RE = /\$\{(\s*)([A-Za-z_-][A-Za-z0-9_-]*)?(\s*)(\?=!?|=!?|:)?/y;
const NETWORK_RE = /<[A-Za-z_][\w-]*:[^<>\n]*>/y;
const NETWORK_OPEN_RE = /<(?:lora|lyco|hypernet):/iy;
// After a closed wildcard: more path-like text ending in another "__" means the path
// itself contained "__" (e.g. __lib/hair__color__).
const DANGLING_RE = /[^\s,|{}()[\]<>_][^\s,|{}()[\]<>]*?__/y;

const BRACE_LIKE = new Set(['brace', 'var', 'wrap']);

function matchAt(re, text, index) {
    re.lastIndex = index;
    return re.exec(text);
}

function scan(text, start, end, out, opts) {
    const {tokens, diagnostics, blocks, wildcards, variables, plain} = out;
    const stack = [];

    const tok = (type, from, to, depth) => {
        if (to <= from) return;
        tokens.push(depth ? {from, to, type, depth} : {from, to, type});
        plain.fill(0, from, to);
    };
    const diag = (severity, code, from, to, message) => {
        diagnostics.push({from, to: Math.max(to, from + 1), severity, code, message});
    };
    const error = (code, from, to, message) => diag('error', code, from, to, message);
    const warn = (code, from, to, message) => diag('warning', code, from, to, message);

    const lineEnd = (index) => {
        const nl = text.indexOf('\n', index);
        return nl === -1 || nl > end ? end : nl;
    };
    // Nesting depth (1-5) a new frame of this kind would get; drives the depth colours.
    const nextDepth = (type) => {
        const same = BRACE_LIKE.has(type)
            ? stack.filter((f) => BRACE_LIKE.has(f.type))
            : stack.filter((f) => f.type === type);
        return Math.min(same.length + 1, 5);
    };
    const push = (frame) => {
        frame.depth = nextDepth(frame.type);
        stack.push(frame);
        return frame;
    };

    const reportUnclosed = (frame) => {
        if (frame.type === 'paren') {
            error('unclosed-paren', frame.from, frame.from + 1, 'Unclosed "(" — no matching ")"');
        } else if (frame.type === 'bracket') {
            error('unclosed-bracket', frame.from, frame.from + 1, 'Unclosed "[" — no matching "]"');
        } else if (frame.type === 'var') {
            error('variable-unclosed', frame.from, frame.headEnd, 'Unclosed variable — missing "}"');
        } else {
            error('unclosed-brace', frame.from, frame.openEnd, 'Unclosed "{" — no matching "}"');
        }
    };

    // Weight at the start of a variant option: "0.5::option".
    const optionStart = (index) => {
        const weight = matchAt(WEIGHT_RE, text, index);
        if (weight) {
            const from = index + weight[1].length;
            tok('weight', from, index + weight[0].length);
            return index + weight[0].length;
        }
        const bad = matchAt(BAD_WEIGHT_RE, text, index);
        if (bad) {
            const from = index + bad[1].length;
            warn('weight-malformed', from, index + bad[0].length,
                `"${bad[2]}" is not a number — an option weight looks like 0.5::option`);
        }
        return index;
    };

    const wildcard = (i) => {
        const stop = lineEnd(i);
        let p = i + 2;
        if (p < stop && SAMPLERS.includes(text[p])) p++;
        const pathStart = p;
        let pathEnd = -1;
        let paramsFrom = -1;
        let dynamic = false;
        const problems = [];

        let k = p;
        while (k < stop) {
            const c = text[k];
            if (c === '_' && text[k + 1] === '_') {
                pathEnd = k;
                break;
            }
            if (c === '{' || (c === '$' && text[k + 1] === '{')) {
                // Variant or variable reference inside the path: skip the balanced group.
                dynamic = true;
                let depth = 0;
                let j = c === '$' ? k + 1 : k;
                for (; j < stop; j++) {
                    if (text[j] === '{') depth++;
                    else if (text[j] === '}' && --depth === 0) break;
                }
                if (j >= stop) {
                    problems.push([k, k + (c === '$' ? 2 : 1), 'Unclosed "{" inside a wildcard path']);
                    k = stop;
                    break;
                }
                k = j + 1;
                continue;
            }
            if (c === '(') {
                const close = text.indexOf(')', k);
                if (close === -1 || close >= stop) {
                    problems.push([k, k + 1, 'Unclosed "(" in wildcard parameters']);
                    k++;
                    continue;
                }
                if (paramsFrom === -1) paramsFrom = k;
                k = close + 1;
                continue;
            }
            if (c === '#' || c === '}' || c === '$' || c === '%') {
                problems.push([k, k + 1, `"${c}" is not allowed in a wildcard path`]);
            }
            k++;
        }

        if (pathEnd === -1) {
            error('wildcard-unclosed', i, i + 2,
                'Unclosed wildcard — "__" starts a wildcard and needs a closing "__" on the same line');
            return i + 2;
        }

        let to = pathEnd + 2;
        const path = text.slice(pathStart, paramsFrom === -1 ? pathEnd : paramsFrom);

        // Count the underscores that directly follow the closing "__".
        let extra = 0;
        while (to + extra < stop && text[to + extra] === '_') extra++;

        let reported = false;
        if (extra === 1) {
            to += 1;
            error('wildcard-underscore', i, to,
                'Wildcard has an extra "_" — use exactly two underscores on each side: __path__');
            reported = true;
        } else if (extra === 0) {
            let cursor = to;
            for (;;) {
                const dangling = matchAt(DANGLING_RE, text, cursor);
                if (!dangling || cursor + dangling[0].length > stop) break;
                cursor += dangling[0].length;
            }
            if (cursor !== to) {
                to = cursor;
                error('wildcard-double-underscore', i, to,
                    'A wildcard path cannot contain "__" — use a single "_" inside the path');
                reported = true;
            }
        }

        if (!reported) {
            if (pathStart === pathEnd) {
                error('wildcard-empty', i, to, 'Empty wildcard — expected __path__');
                reported = true;
            } else if (text[pathStart] === '_' || text[pathEnd - 1] === '_') {
                error('wildcard-underscore', i, to,
                    'Wildcard has an extra "_" — use exactly two underscores on each side: __path__');
                reported = true;
            }
        }
        for (const [from, end2, message] of problems) error('wildcard-char', from, end2, message);

        tok('wildcard', i, to);
        if (paramsFrom !== -1 && paramsFrom < pathEnd) tokens.push({from: paramsFrom, to: pathEnd, type: 'wildcardParams'});
        if (!reported && !problems.length) {
            wildcards.push({from: i, to, path: path.trim(), dynamic});
        }
        return to;
    };

    let i = start;
    while (i < end) {
        const ch = text[i];
        const next = text[i + 1];

        // Comments are ignored by the dynamic prompts parser.
        if (ch === '#' || (ch === '/' && next === '/')) {
            const j = lineEnd(i);
            tok('comment', i, j);
            i = j;
            continue;
        }
        if (ch === '/' && next === '*') {
            const close = text.indexOf('*/', i + 2);
            const j = close === -1 || close + 2 > end ? end : close + 2;
            tok('comment', i, j);
            i = j;
            continue;
        }

        // A1111 escapes: \( \) \[ \] are literal brackets.
        if (ch === '\\' && i + 1 < end && '()[]\\'.includes(next)) {
            i += 2;
            continue;
        }

        if (ch === '<') {
            const net = matchAt(NETWORK_RE, text, i);
            if (net && i + net[0].length <= end) {
                const to = i + net[0].length;
                tok('lora', i, to);
                let u = text.indexOf('__', i);
                while (u !== -1 && u < to) {
                    let stopU = u;
                    while (stopU < to && text[stopU] === '_') stopU++;
                    error('lora-double-underscore', u, stopU,
                        'Double underscore inside <…> is read as a wildcard by dynamic prompts and breaks the tag');
                    u = text.indexOf('__', stopU);
                }
                i = to;
                continue;
            }
            const open = matchAt(NETWORK_OPEN_RE, text, i);
            if (open) {
                error('lora-unclosed', i, i + open[0].length, `Unclosed ${open[0]}…> tag — missing ">"`);
                i += open[0].length;
                continue;
            }
        }

        if (ch === '$' && next === '{') {
            const head = matchAt(VAR_HEAD_RE, text, i);
            const name = head[2];
            const op = head[4];
            const headEnd = i + head[0].length;
            const kind = op && op.includes('=') ? 'set' : 'use';
            if (!name) {
                error('variable-name', i, headEnd, 'Expected a variable name after "${" (letters, digits, "_" or "-")');
            } else if (!op && text[headEnd] !== '}' && headEnd < end) {
                error('variable-name', i, headEnd, 'Expected "=", ":" or "}" after the variable name');
            }
            if (kind === 'set' && stack.some((f) => BRACE_LIKE.has(f.type))) {
                error('variable-in-variant', i, headEnd,
                    'Variable definitions must be at the top level, outside any {} block');
            }
            const type = kind === 'set' ? 'variableSet' : 'variableUse';
            tok(type, i, headEnd);
            push({type: 'var', from: i, headEnd, openEnd: headEnd, kind, name, hasDefault: op === ':', tokenType: type});
            i = headEnd;
            continue;
        }

        if (ch === '%' && next === '{') {
            const frame = push({type: 'wrap', from: i, openEnd: i + 2, delims: 0});
            tok('wrap', i, i + 2, frame.depth);
            i += 2;
            continue;
        }

        if (ch === '_' && next === '_') {
            i = wildcard(i);
            continue;
        }

        if (ch === '{') {
            const frame = push({type: 'brace', from: i, openEnd: i + 1});
            tok('brace', i, i + 1, frame.depth);
            let p = i + 1;
            while (p < end && (text[p] === ' ' || text[p] === '\t' || text[p] === '\n' || text[p] === '\r')) p++;
            if (p < end && SAMPLERS.includes(text[p])) {
                tok('sampler', p, p + 1);
                p++;
            }
            const bound = matchAt(BOUND_RE, text, p);
            if (bound) {
                tok('bound', p, p + bound[0].length);
                const range = /^(\d+)-(\d+)$/.exec(bound[1]);
                if (range && Number(range[1]) > Number(range[2])) {
                    warn('bound-range', p, p + bound[1].length,
                        `Range ${bound[1]} has a lower bound greater than the upper bound`);
                }
                p += bound[0].length;
                const separator = matchAt(SEPARATOR_RE, text, p);
                if (separator) {
                    tok('separator', p, p + separator[0].length);
                    p += separator[0].length;
                }
            }
            i = optionStart(p);
            continue;
        }

        if (ch === '}') {
            let at = -1;
            for (let s = stack.length - 1; s >= 0; s--) {
                if (BRACE_LIKE.has(stack[s].type)) {
                    at = s;
                    break;
                }
            }
            if (at === -1) {
                error('unmatched-brace', i, i + 1, 'Unmatched "}" — no opening "{"');
                i++;
                continue;
            }
            for (let s = stack.length - 1; s > at; s--) reportUnclosed(stack[s]);
            const frame = stack[at];
            const depth = frame.depth;
            stack.length = at;
            if (frame.type === 'var') {
                tok(frame.tokenType, i, i + 1);
                if (frame.name) {
                    variables.push({from: frame.from, to: i + 1, name: frame.name, kind: frame.kind, hasDefault: frame.hasDefault});
                }
            } else if (frame.type === 'wrap') {
                tok('wrap', i, i + 1, depth);
                if (frame.delims !== 1) {
                    error('wrap-malformed', frame.from, frame.openEnd,
                        'Wrap command needs exactly one "$$": %{wrapper$$inner}');
                }
            } else {
                tok('brace', i, i + 1, depth);
            }
            blocks.push({from: frame.from, to: i + 1, depth});
            i++;
            continue;
        }

        if (ch === '(' || ch === '[') {
            const type = ch === '(' ? 'paren' : 'bracket';
            const frame = push({type, from: i});
            tok(type, i, i + 1, frame.depth);
            i++;
            continue;
        }

        if (ch === ')' || ch === ']') {
            const type = ch === ')' ? 'paren' : 'bracket';
            let at = -1;
            for (let s = stack.length - 1; s >= 0; s--) {
                if (BRACE_LIKE.has(stack[s].type)) break;
                if (stack[s].type === type) {
                    at = s;
                    break;
                }
            }
            if (at === -1) {
                error(`unmatched-${type}`, i, i + 1, `Unmatched "${ch}" — no opening "${ch === ')' ? '(' : '['}"`);
                i++;
                continue;
            }
            for (let s = stack.length - 1; s > at; s--) reportUnclosed(stack[s]);
            const depth = stack[at].depth;
            stack.length = at;
            tok(type, i, i + 1, depth);
            i++;
            continue;
        }

        if (ch === '|') {
            let owner = null;
            for (let s = stack.length - 1; s >= 0; s--) {
                if (stack[s].type === 'paren') continue;
                owner = stack[s];
                break;
            }
            if (!owner || owner.type === 'var' || owner.type === 'wrap') {
                if (owner) {
                    error('pipe-in-variable', i, i + 1, '"|" is not allowed here — wrap the options in {a|b}');
                } else {
                    error('pipe-outside', i, i + 1, '"|" outside of {} or [] — wrap the options in {a|b}');
                }
                i++;
                continue;
            }
            tok('pipe', i, i + 1, owner.type === 'brace' ? owner.depth : undefined);
            i = owner.type === 'brace' ? optionStart(i + 1) : i + 1;
            continue;
        }

        if (ch === '$') {
            if (next === '$') {
                let owner = null;
                for (let s = stack.length - 1; s >= 0; s--) {
                    if (BRACE_LIKE.has(stack[s].type)) {
                        owner = stack[s];
                        break;
                    }
                }
                if (owner && owner.type === 'wrap') {
                    owner.delims++;
                    tok('bound', i, i + 2);
                } else if (owner) {
                    error('bound-malformed', i, i + 2,
                        '"$$" is only valid right after "{" as a count, e.g. {2$$a|b} or {1-2$$ and $$a|b}');
                } else {
                    warn('stray-dollar', i, i + 2, '"$$" outside of {} stops dynamic prompts from parsing this prompt');
                }
                i += 2;
                continue;
            }
            warn('stray-dollar', i, i + 1, 'A lone "$" stops dynamic prompts from parsing this prompt');
            i++;
            continue;
        }

        if (ch === '%') {
            warn('stray-percent', i, i + 1, 'A lone "%" stops dynamic prompts from parsing this prompt');
            i++;
            continue;
        }

        i++;
    }

    for (let s = stack.length - 1; s >= 0; s--) reportUnclosed(stack[s]);

    if (opts.checkVariables) {
        const sets = variables.filter((v) => v.kind === 'set');
        for (const v of variables) {
            if (v.kind !== 'use' || v.hasDefault) continue;
            if (sets.some((s) => s.name === v.name && s.from < v.from)) continue;
            warn('variable-undefined', v.from, v.to,
                `Variable "${v.name}" is not defined before it is used — add \${${v.name}=…} or a default \${${v.name}:value}`);
        }
    }
}

export function parsePrompt(input, {mode = 'prompt'} = {}) {
    const text = String(input ?? '');
    const out = {
        tokens: [],
        diagnostics: [],
        blocks: [],
        wildcards: [],
        variables: [],
        plain: new Uint8Array(text.length).fill(1),
    };

    try {
        if (mode === 'wildcard-file') {
            // Every line is an independent value; nothing spans lines.
            let lineStart = 0;
            while (lineStart <= text.length) {
                let lineEnd = text.indexOf('\n', lineStart);
                if (lineEnd === -1) lineEnd = text.length;
                if (lineEnd > lineStart) scan(text, lineStart, lineEnd, out, {checkVariables: false});
                lineStart = lineEnd + 1;
            }
        } else {
            scan(text, 0, text.length, out, {checkVariables: true});
        }
    } catch (e) {
        // Parsing must never break the editor; fall back to whatever was collected.
        if (typeof console !== 'undefined') console.error('[sd-prompt-lab] prompt parser failed', e);
    }

    const plainRanges = [];
    for (let i = 0; i < text.length; i++) {
        if (!out.plain[i]) continue;
        let j = i;
        while (j < text.length && out.plain[j]) j++;
        plainRanges.push({from: i, to: j});
        i = j;
    }

    const byFrom = (a, b) => a.from - b.from || a.to - b.to;
    return {
        tokens: out.tokens.sort(byFrom),
        diagnostics: out.diagnostics.sort(byFrom),
        blocks: out.blocks.sort(byFrom),
        wildcards: out.wildcards,
        variables: out.variables.sort(byFrom),
        text: plainRanges,
    };
}

// Innermost {...} block containing the cursor (cursor between the braces), or null.
export function innermostBlock(blocks, pos) {
    let best = null;
    for (const block of blocks) {
        if (pos <= block.from || pos >= block.to) continue;
        if (!best || block.to - block.from < best.to - best.from) best = block;
    }
    return best;
}

function globToRegExp(glob) {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
}

// Does a wildcard path resolve against the known wildcard names (posix paths, no extension)?
export function resolveWildcard(path, names) {
    const clean = String(path ?? '').trim();
    if (!clean) return false;
    if (/[*?]/.test(clean)) {
        const re = globToRegExp(clean);
        for (const name of names) if (re.test(name)) return true;
        return false;
    }
    return names.has(clean);
}

// Words eligible for spell checking: letter runs inside plain text.
export function extractWords(text, ranges) {
    const words = [];
    const re = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
    for (const range of ranges) {
        const chunk = text.slice(range.from, range.to);
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(chunk)) !== null) {
            let word = m[0].replace(/'s$/i, '');
            if (word.length < 3 || word.includes("'")) continue;   // skip contractions
            if (word === word.toUpperCase()) continue;   // acronyms, BREAK, AND
            words.push({from: range.from + m.index, to: range.from + m.index + word.length, text: word});
        }
    }
    return words;
}
