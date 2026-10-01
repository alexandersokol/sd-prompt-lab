import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reformatPrompt, cleanUpPrompt} from '../dp_format.js';

test('reformat: spacing and commas in plain text', () => {
    assert.equal(reformatPrompt('a ,b,,  c ,, d  ,'), 'a, b, c, d');
    assert.equal(reformatPrompt('  a,b  '), 'a, b');
    assert.equal(reformatPrompt(', a, b'), 'a, b');
    assert.equal(reformatPrompt(''), '');
    assert.equal(reformatPrompt(null), '');
});

test('reformat: ordinary words containing "break" are untouched, BREAK is kept', () => {
    assert.equal(reformatPrompt('breakfast table'), 'breakfast table');
    assert.equal(reformatPrompt('red dress  BREAK  blue sky'), 'red dress BREAK blue sky');
});

test('reformat: line breaks and comments survive', () => {
    assert.equal(reformatPrompt('a ,  # note\nb,c'), 'a, # note\nb, c');
    assert.equal(reformatPrompt('a,\n\nb ,\nc'), 'a,\n\nb,\nc');
    assert.equal(reformatPrompt('a,\n, b'), 'a,\nb');
    assert.equal(reformatPrompt('a\n, b'), 'a\n, b');
    assert.equal(reformatPrompt('x /* keep ,, this */ y'), 'x /* keep ,, this */ y');
});

test('reformat: blocks, wildcards and variables are copied verbatim', () => {
    assert.equal(reformatPrompt('{red ,blue|red,  green} ,x'), '{red ,blue|red,  green}, x');
    assert.equal(reformatPrompt('{\n  a\n  |b ,, c\n} ,  d'), '{\n  a\n  |b ,, c\n}, d');
    assert.equal(reformatPrompt('${x = {a ,b|c}}  ${x}'), '${x = {a ,b|c}} ${x}');
    assert.equal(reformatPrompt('__lib/hair_color__ ,x'), '__lib/hair_color__, x');
    assert.equal(reformatPrompt('[x|y] ,(a:1.2)'), '[x|y], (a:1.2)');
});

test('reformat: brackets without a partner are removed', () => {
    assert.equal(reformatPrompt('a [b c'), 'a b c');
    assert.equal(reformatPrompt('a) b'), 'a b');
    assert.equal(reformatPrompt('a } b'), 'a b');
    assert.equal(reformatPrompt('(a, (b)'), 'a, (b)');
    assert.equal(reformatPrompt('artist \\(style\\)'), 'artist \\(style\\)');
});

test('reformat: top-level lora tags move to the last line', () => {
    assert.equal(reformatPrompt('<lora:a:1>, cat, <lora:b:0.5> dog'), 'cat, dog,\n<lora:a:1>, <lora:b:0.5>');
    assert.equal(reformatPrompt('<lora:a:1>'), '<lora:a:1>');
    assert.equal(reformatPrompt('{<lora:a:1>|<lora:b:1>}, cat'), '{<lora:a:1>|<lora:b:1>}, cat');
    assert.equal(reformatPrompt('cat # <lora:a:1>'), 'cat # <lora:a:1>');
});

test('clean up: removes duplicate top-level segments only', () => {
    assert.equal(cleanUpPrompt('cat, cat, Cat ,dog'), 'cat, dog');
    assert.equal(cleanUpPrompt('{red, blue|red, green}, red, red'), '{red, blue|red, green}, red');
    assert.equal(cleanUpPrompt('{a|b}, x, {a|b}'), '{a|b}, x');
    assert.equal(cleanUpPrompt('a,\nb, a,\na'), 'a,\nb');
    assert.equal(cleanUpPrompt('a BREAK b, BREAK, c, BREAK, c'), 'a BREAK b, BREAK, c, BREAK');
    assert.equal(cleanUpPrompt('a # one\na # one'), 'a # one\na # one');
    assert.equal(cleanUpPrompt('<lora:a:1>, cat, <lora:a:1>'), 'cat,\n<lora:a:1>');
});

test('both are idempotent', () => {
    const corpus = [
        'a ,b,,  c ,, d  ,', '<lora:a:1>, cat, <lora:b:0.5> dog', 'a ,  # note\nb,c', 'a\n, b',
        '{\n  a\n  |b ,, c\n} ,  d', 'a [b c', '(a, (b)', '${x=!{a|b}} wearing ${x}, {2$$ and $$a|b}',
        'masterpiece, 1girl,\n__lib/hair_color__, <lora:x:1>,\n\n# c\n{a|b}', 'a | b, {c|d', 'cat, cat',
        '__a__b__, ___c__, 50% off, ,,,', '\n\n a \n\n',
    ];
    for (const text of corpus) {
        const once = reformatPrompt(text);
        assert.equal(reformatPrompt(once), once, `reformat: ${JSON.stringify(text)}`);
        const cleaned = cleanUpPrompt(text);
        assert.equal(cleanUpPrompt(cleaned), cleaned, `cleanUp: ${JSON.stringify(text)}`);
        assert.equal(reformatPrompt(cleaned), cleaned, `reformat(cleanUp): ${JSON.stringify(text)}`);
    }
});
