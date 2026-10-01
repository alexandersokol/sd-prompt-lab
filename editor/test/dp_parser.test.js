import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePrompt, innermostBlock, resolveWildcard, extractWords} from '../dp_parser.js';

const codes = (text, opts) => parsePrompt(text, opts).diagnostics.map((d) => d.code);
const types = (text, opts) => parsePrompt(text, opts).tokens.map((t) => t.type);
const range = (text, code) => {
    const d = parsePrompt(text).diagnostics.find((x) => x.code === code);
    return d ? text.slice(d.from, d.to) : null;
};

test('valid prompts produce no diagnostics', () => {
    for (const text of [
        'masterpiece, 1girl, (smile:1.2), [a|b], [a:b:0.5]',
        '{summer|autumn|winter|spring} is coming',
        '{0.5::summer|0.1::autumn|.3::winter|1.::spring}',
        '{2$$chocolate|vanilla}', '{2$$ and $$a|b}', '{1-2$$a|b}', '{-2$$a|b}', '{1-$$a|b}',
        '{~a|b} {@c|d} {!e|f}',
        '{a||b}', '{|a}', '{}', '{a|b|}',
        '__season__', '__lib/hair_color__', '__~colours__', '__colours*__', '__artists/**__',
        '__season_clothes(season=winter)__', '__a____b__', '__a__ __b__',
        '${season=!__season__} In ${season}', '${x={a|b}} ${x}', '${x?=1} ${x}', '${y:default}',
        '%{wrapper$$inner}',
        '# a comment\na, b // trailing\n/* block | {  */ c',
        'artist \\(style\\), \\[x\\]',
        '<lora:foo_bar:0.8>, <hypernet:x:1>',
        '{dsds {asad|as}}',
        '{\n  summer\n  |autumn\n  # | fall\n  |winter\n}',
        '{(a|b)}', '[a (b|c)]',
    ]) {
        assert.deepEqual(codes(text), [], text);
    }
});

test('wildcards: path with underscores highlights as one token', () => {
    assert.deepEqual(parsePrompt('__lib/hair_color__').tokens, [{from: 0, to: 18, type: 'wildcard'}]);
    assert.equal(parsePrompt('a, __lib/hair_color__, b').wildcards[0].path, 'lib/hair_color');
    assert.equal(parsePrompt('__~a/b(x=1)__').wildcards[0].path, 'a/b');
});

test('wildcards: malformed', () => {
    assert.equal(range('x, __lib/hair__color__, y', 'wildcard-double-underscore'), '__lib/hair__color__');
    assert.equal(range('__a__b__c__', 'wildcard-double-underscore'), '__a__b__c__');
    assert.equal(range('___a__', 'wildcard-underscore'), '___a__');
    assert.equal(range('__a___', 'wildcard-underscore'), '__a___');
    assert.equal(range('____', 'wildcard-empty'), '____');
    assert.equal(range('a, __b, c', 'wildcard-unclosed'), '__');
    assert.equal(range('a__', 'wildcard-unclosed'), '__');
    assert.deepEqual(codes('__a\nb__'), ['wildcard-unclosed', 'wildcard-unclosed']);
    assert.deepEqual(codes('__a#b__'), ['wildcard-char']);
    assert.deepEqual(codes('__a$b__'), ['wildcard-char']);
    assert.deepEqual(codes('__a(x=1__'), ['wildcard-char']);
    assert.deepEqual(parsePrompt('__a__b__').wildcards, []);
});

test('braces: multi-line and nested variants are balanced', () => {
    const r = parsePrompt('{a\n\n|{b|c}\n}');
    assert.deepEqual(r.diagnostics, []);
    assert.deepEqual(r.tokens.filter((t) => t.type === 'brace').map((t) => t.depth), [1, 2, 2, 1]);
    assert.deepEqual(r.blocks, [{from: 0, to: 12, depth: 1}, {from: 5, to: 10, depth: 2}]);
});

test('braces: unbalanced pairs', () => {
    assert.equal(range('a, {b|c, d', 'unclosed-brace'), '{');
    assert.equal(range('a} b', 'unmatched-brace'), '}');
    assert.deepEqual(codes('{{a|b}'), ['unclosed-brace']);
    assert.deepEqual(codes('{a|b}}'), ['unmatched-brace']);
    assert.deepEqual(codes('(a'), ['unclosed-paren']);
    assert.deepEqual(codes('a)'), ['unmatched-paren']);
    assert.deepEqual(codes('[a'), ['unclosed-bracket']);
    assert.deepEqual(codes('a]'), ['unmatched-bracket']);
    assert.deepEqual(codes('{(a}'), ['unclosed-paren']);
    assert.deepEqual(codes('(a {b)c}'), ['unclosed-paren', 'unmatched-paren']);
});

test('pipes', () => {
    assert.equal(range('a | b', 'pipe-outside'), '|');
    assert.deepEqual(codes('(a|b)'), ['pipe-outside']);
    assert.deepEqual(codes('{a|b} | c'), ['pipe-outside']);
    assert.deepEqual(codes('${x=a|b}'), ['pipe-in-variable']);
    assert.deepEqual(codes('[a|b]'), []);
});

test('lora', () => {
    assert.equal(range('<lora:a__b:1>', 'lora-double-underscore'), '__');
    assert.deepEqual(codes('<lora:a_b:1>'), []);
    assert.deepEqual(codes('<lora:abc'), ['lora-unclosed']);
    assert.deepEqual(types('<lora:a_b:1>'), ['lora']);
    assert.deepEqual(codes('a < b > c'), []);
});

test('variables', () => {
    assert.equal(range('{${x=1}|b}', 'variable-in-variant'), '${x=');
    assert.deepEqual(codes('${x=${y=1}}').includes('variable-in-variant'), true);
    assert.deepEqual(codes('${x'), ['variable-unclosed', 'variable-undefined'].slice(0, 1));
    assert.deepEqual(codes('${1x=2}'), ['variable-name']);
    assert.deepEqual(codes('${x y}'), ['variable-name', 'variable-undefined']);
    assert.deepEqual(codes('${x}'), ['variable-undefined']);
    assert.deepEqual(codes('${x} ${x=1}'), ['variable-undefined']);
    assert.deepEqual(codes('${x=1} ${x}'), []);
    assert.deepEqual(codes('${x:d}'), []);
    assert.deepEqual(codes('${x}', {mode: 'wildcard-file'}), []);
    assert.deepEqual(codes('${ x = 1 }'), []);
});

test('bounds, weights, wrap, stray symbols', () => {
    assert.deepEqual(codes('{x$$a|b}'), ['bound-malformed']);
    assert.deepEqual(codes('{a|b$$c}'), ['bound-malformed']);
    assert.deepEqual(codes('{2 $$ a|b}'), ['bound-malformed']);
    assert.deepEqual(codes('{3-1$$a|b}'), ['bound-range']);
    assert.deepEqual(codes('{x::a|b}'), ['weight-malformed']);
    assert.deepEqual(codes('{a|y::b}'), ['weight-malformed']);
    assert.deepEqual(codes('%{a}'), ['wrap-malformed']);
    assert.deepEqual(codes('%{a$$b$$c}'), ['wrap-malformed']);
    assert.deepEqual(codes('50% off'), ['stray-percent']);
    assert.deepEqual(codes('cost $5'), ['stray-dollar']);
    assert.deepEqual(codes('a $$ b'), ['stray-dollar']);
    const severities = parsePrompt('50% off, {x::a}').diagnostics.map((d) => d.severity);
    assert.deepEqual(severities, ['warning', 'warning']);
});

test('token types for variant prefix', () => {
    assert.deepEqual(types('{~2$$ and $$0.5::a|b}'),
        ['brace', 'sampler', 'bound', 'separator', 'weight', 'pipe', 'brace']);
});

test('wildcard-file mode: each line stands alone', () => {
    const text = 'red {hair\nblue} hair\n# note | {\n{a|b}';
    assert.deepEqual(codes(text, {mode: 'wildcard-file'}), ['unclosed-brace', 'unmatched-brace']);
    assert.deepEqual(codes(text), []);
});

test('innermostBlock', () => {
    const text = '{dsds {asad|as}}';
    const {blocks} = parsePrompt(text);
    const at = (pos) => {
        const b = innermostBlock(blocks, pos);
        return b ? text.slice(b.from, b.to) : null;
    };
    assert.equal(at(text.indexOf('asad') + 2), '{asad|as}');
    assert.equal(at(text.indexOf('dsds') + 2), '{dsds {asad|as}}');
    assert.equal(at(0), null);
    assert.equal(at(text.length), null);
    assert.equal(innermostBlock(parsePrompt('a {b} c').blocks, 0), null);
});

test('resolveWildcard', () => {
    const names = new Set(['season', 'lib/hair_color', 'lib/eyes', 'colours-warm']);
    assert.equal(resolveWildcard('season', names), true);
    assert.equal(resolveWildcard('lib/hair_color', names), true);
    assert.equal(resolveWildcard('lib/nope', names), false);
    assert.equal(resolveWildcard('colours*', names), true);
    assert.equal(resolveWildcard('lib/**', names), true);
    assert.equal(resolveWildcard('zzz*', names), false);
});

test('extractWords skips syntax, short words and acronyms', () => {
    const text = 'beautifull girl, __lib/hair__, <lora:abc:1>, {redd|blue}, ${x=misstake}, it\'s BREAK ok 1girl # comment wrng';
    const r = parsePrompt(text);
    assert.deepEqual(extractWords(text, r.text).map((w) => w.text),
        ['beautifull', 'girl', 'redd', 'blue', 'misstake', 'girl']);
});

test('never throws on junk', () => {
    for (const text of ['{{{{', '}}}}', '${${${', '__', '_', '%{%{', '$$$$', '<<<>>>', '((([[[', '\\', '/*', '']) {
        assert.ok(parsePrompt(text));
        assert.ok(parsePrompt(text, {mode: 'wildcard-file'}));
    }
});
