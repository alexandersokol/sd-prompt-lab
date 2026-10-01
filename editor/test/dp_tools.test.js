import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completionContext, formatTag, formatCount} from '../dp_complete.js';
import {suggest} from '../dp_spell.js';
import {quickFixes, applyChanges} from '../dp_fixes.js';
import {parsePrompt} from '../dp_parser.js';

const ctx = (text) => {
    const c = completionContext(text);
    return c ? [c.kind, c.query, text.slice(c.from)] : null;
};

test('completionContext: tags', () => {
    assert.deepEqual(ctx('masterpiece, long ha'), ['tag', 'long ha', 'long ha']);
    assert.deepEqual(ctx('lo'), ['tag', 'lo', 'lo']);
    assert.deepEqual(ctx('{red|bl'), ['tag', 'bl', 'bl']);
    assert.deepEqual(ctx('(smi'), ['tag', 'smi', 'smi']);
    assert.deepEqual(ctx('1gi'), ['tag', '1gi', '1gi']);
    assert.equal(ctx('l'), null);
    assert.equal(ctx('a, '), null);
    assert.equal(ctx('(smile:1.'), null);
    assert.equal(ctx('{0.5'), null);
    assert.equal(ctx('{2$$ and'), null);
    assert.equal(ctx('cat # comm'), null);
    assert.equal(ctx('// comm'), null);
});

test('completionContext: wildcard, variable, lora', () => {
    assert.deepEqual(ctx('a, __li'), ['wildcard', 'li', 'li']);
    assert.deepEqual(ctx('__'), ['wildcard', '', '']);
    assert.deepEqual(ctx('__~lib/ha'), ['wildcard', 'lib/ha', 'lib/ha']);
    assert.deepEqual(ctx('__a__, __lib/hair_c'), ['wildcard', 'lib/hair_c', 'lib/hair_c']);
    assert.deepEqual(ctx('__a__, lon'), ['tag', 'lon', 'lon']);
    assert.equal(ctx('__a, b'), null);
    assert.deepEqual(ctx('wearing ${sea'), ['variable', 'sea', 'sea']);
    assert.deepEqual(ctx('${'), ['variable', '', '']);
    assert.deepEqual(ctx('x, <lora:foo_'), ['lora', 'foo_', 'foo_']);
    assert.deepEqual(ctx('<lora:'), ['lora', '', '']);
    assert.deepEqual(ctx('<lora:foo:0.'), null);
});

test('formatTag / formatCount', () => {
    assert.equal(formatTag('long_hair', false), 'long hair');
    assert.equal(formatTag('artist_(style)', false), 'artist \\(style\\)');
    assert.equal(formatTag('artist_(style)', true), 'artist_(style)');
    assert.equal(formatCount(1234567), '1.2M');
    assert.equal(formatCount(4000), '4K');
    assert.equal(formatCount(12), '12');
});

test('suggest', () => {
    const dict = new Set(['beautiful', 'wrong', 'word', 'ward', 'wurst', 'green', 'the', 'receive', 'hair']);
    assert.deepEqual(suggest('beautifull', dict), ['beautiful']);
    assert.deepEqual(suggest('wrongg', dict), ['wrong']);
    assert.deepEqual(suggest('wurd', dict), ['ward', 'word']);
    assert.deepEqual(suggest('Greeen', dict), ['Green']);
    assert.deepEqual(suggest('recieve', dict), ['receive']);
    assert.deepEqual(suggest('haiir', dict, 1), ['hair']);
    assert.deepEqual(suggest('word', dict), []);
    assert.deepEqual(suggest('zzzzzzzz', dict), []);
    assert.deepEqual(suggest('', dict), []);
});

const fix = (text, code, index = 0) => {
    const diagnostic = parsePrompt(text).diagnostics.find((d) => d.code === code);
    assert.ok(diagnostic, `no ${code} in ${text}`);
    const fixes = quickFixes(text, diagnostic);
    return fixes[index] ? [fixes[index].name, applyChanges(text, fixes[index].changes)] : null;
};

test('quickFixes', () => {
    assert.deepEqual(fix('a) b', 'unmatched-paren'), ['Remove ")"', 'a b']);
    assert.deepEqual(fix('a ] b', 'unmatched-bracket'), ['Remove "]"', 'a  b']);
    assert.deepEqual(fix('a } b', 'unmatched-brace'), ['Remove "}"', 'a  b']);
    assert.deepEqual(fix('(a, b', 'unclosed-paren'), ['Remove "("', 'a, b']);
    assert.deepEqual(fix('x, {a|b\ny', 'unclosed-brace', 0), ['Close at end of line', 'x, {a|b}\ny']);
    assert.deepEqual(fix('x, {a|b\ny', 'unclosed-brace', 1), ['Remove "{"', 'x, a|b\ny']);
    assert.deepEqual(fix('x, red | blue , y', 'pipe-outside'), ['Wrap options in {}', 'x, {red | blue} , y']);
    assert.deepEqual(fix('a|b', 'pipe-outside'), ['Wrap options in {}', '{a|b}']);
    assert.deepEqual(fix('x, __lib/hair__color__', 'wildcard-double-underscore'), ['Fix underscores', 'x, __lib/hair_color__']);
    assert.deepEqual(fix('___bad__', 'wildcard-underscore'), ['Fix underscores', '__bad__']);
    assert.deepEqual(fix('__bad___', 'wildcard-underscore'), ['Fix underscores', '__bad__']);
    assert.deepEqual(fix('a, {b|${x={c|d}}}', 'variable-in-variant'), ['Move definition to the top', '${x={c|d}}\na, {b|}']);
    assert.equal(fix('50% off', 'stray-percent'), null);
});

test('every applied fix removes the diagnostic it was offered for', () => {
    for (const text of ['a) b', '(a, b', 'x, {a|b\ny', 'x, red | blue , y', 'x, __lib/hair__color__', '___bad__', 'a, {b|${x=1}}']) {
        const before = parsePrompt(text).diagnostics[0];
        const fixed = applyChanges(text, quickFixes(text, before)[0].changes);
        assert.ok(!parsePrompt(fixed).diagnostics.some((d) => d.code === before.code), `${text} -> ${fixed}`);
    }
});
