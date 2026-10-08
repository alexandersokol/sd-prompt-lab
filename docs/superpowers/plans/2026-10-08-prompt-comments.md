# Prompt Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a prompt carry `/* notes */` that stay in the image metadata but are not used for generation, and `/*@ Name: value */` params that are moved to the metadata parameter line; Prompt Lab adds `/*@ Prompt name: … */` itself when a saved prompt is sent to txt2img or copied.

**Architecture:** A pure Python module finds, shields and splits comments. A thin always-on WebUI script calls it from three hooks: `before_process` hides comment text from Dynamic Prompts, `before_process_batch` strips comments from the text that is encoded and moves params to `extra_generation_params`, `postprocess_image` sets per-image params. The editor parser gets a `param` token and new diagnostics; highlighting, Reformat and completion follow from the parser.

**Tech Stack:** Python 3.10 (WebUI venv, no pytest: tests are plain scripts), AUTOMATIC1111 WebUI v1.6.0 script hooks, CodeMirror 6 bundle built with rollup, `node --test`.

## Global Constraints

- Everything lives in this extension. No file outside `extensions/sd-prompt-lab` is changed.
- Syntax: plain comment `/* text */`; param `/*@ Name: value */`. An unclosed `/*` is plain text.
- Param names: letters, digits, `_` and spaces only (what the WebUI infotext parser accepts). A param with an invalid name, no `:`, an empty value or a reserved name is treated as a plain comment.
- Reserved names (case-insensitive): every built-in WebUI param, `Template`, `Negative Template`, and any key another extension already put in `p.extra_generation_params`.
- Comments are inert: nothing inside them is expanded by Dynamic Prompts.
- A prompt without comments must come out byte-identical.
- The auto-added param is exactly `/*@ Prompt name: <name> */`, appended on its own line, never saved into the stored prompt.
- A param removed from the prompt is not restored on "Send to txt2img" from a generated image (decided).
- Settings: one switch, `prompt_comments`, default on. When off, the script does nothing and Prompt Lab does not auto-add the name.
- Work on branch `feat/prompt-comments`. Commit after each task. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Known limits (document in README, do not solve)

- Comments inside wildcard files and saved WebUI styles reach Dynamic Prompts unprotected, because they are inserted after the shield runs. `# $ % { }` inside such a comment breaks it. The Wildcard Editor warns about this.
- The txt2img token counter counts comment text (v1.6.0 has no hook for it).
- Extensions that re-encode `p.all_prompts` in their own pass (ADetailer-style) still see plain comments.
- If params differ between images of one run, the grid image carries the params of the last image.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/prompt_lab/sd_prompt_lab_comments.py` (new) | Pure logic: find, shield, split, apply to a processing object |
| `scripts/sd_prompt_lab_comments_script.py` (new) | Always-on `scripts.Script` wrapper |
| `scripts/prompt_lab/sd_prompt_lab_sampler.py` | Shield around sampling |
| `scripts/prompt_lab/sd_prompt_lab_db.py` | `prompt_comments` setting |
| `scripts/prompt_lab/sd_prompt_lab_api.py` | `GET /sd-prompt-lab/exists` |
| `scripts/prompt_lab/ui/ui_tab_settings.py`, `javascript/settings.js` | Settings switch |
| `editor/dp_parser.js`, `dp_format.js`, `dp_complete.js`, `style.css` | Tokens, diagnostics, protection, colours |
| `javascript/spl_common.js`, `index.js`, `browse.js`, `prompt_preview.js` | `spl.withPromptName` and its three callers |
| `tests/test_comments.py`, `tests/test_comments_dp.py` (new) | Python tests |
| `editor/test/dp_parser.test.js`, `dp_format.test.js`, `dp_tools.test.js` | Editor tests |
| `README.md` | Usage and limits |

---

### Task 1: Comment parsing core

**Files:**
- Create: `scripts/prompt_lab/sd_prompt_lab_comments.py`
- Test: `tests/test_comments.py`

**Interfaces:**
- Produces: `find_comments(text) -> list[tuple[int, int]]`, `parse_param(body) -> tuple[str, str] | None`, `shield(text) -> str`, `unshield(text) -> str`, `split_prompt(text, reserved=frozenset()) -> Split` where `Split` has `meta: str`, `clean: str`, `params: dict[str, str]`, `rejected: list[str]`, and `RESERVED: frozenset[str]` (lower-case).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_comments.py — run: python3 tests/test_comments.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.prompt_lab import sd_prompt_lab_comments as c


def test_find_comments():
    assert c.find_comments("a /* x */ b /*@ N: v */") == [(2, 9), (12, 23)]
    assert c.find_comments("a /* never closed") == []
    assert c.find_comments("__1000/*__ x */ y") == []          # glob inside a wildcard
    assert c.find_comments("__a/*__ /* real */") == [(8, 18)]


def test_parse_param():
    assert c.parse_param("@ Prompt name: My  fav\ntemplate ") == ("Prompt name", "My fav template")
    assert c.parse_param("@Mood:calm") == ("Mood", "calm")
    for body in (" plain note ", "@ no colon", "@ : v", "@ Name: ", "@ Na/me: v"):
        assert c.parse_param(body) is None, body


def test_shield_round_trip():
    text = "a {x|y} /* #1 $5 50% {a|b} __w__ */ __w__"
    shielded = c.shield(text)
    assert shielded.startswith("a {x|y} /* ") and shielded.endswith(" */ __w__")
    assert not set("#$%{}_|") & set(shielded[8:-8])
    assert c.unshield(shielded) == text
    assert c.shield("no comments {a|b}") == "no comments {a|b}"


def test_split_prompt():
    s = c.split_prompt("1girl, /* note */ dress, /*@ Mood: calm */ smile")
    assert s.meta == "1girl, /* note */ dress, smile"
    assert s.clean == "1girl, dress, smile"
    assert s.params == {"Mood": "calm"} and s.rejected == []

    s = c.split_prompt("a, /*x*/, b\n/*@ N: v */\nc")
    assert s.clean == "a, b\nc" and s.meta == "a, /*x*/, b\nc"

    s = c.split_prompt("a /*@ Steps: 5 */ /*@ bad */ b", c.RESERVED)
    assert s.params == {} and s.rejected == ["Steps"]
    assert s.meta == "a /*@ Steps: 5 */ /*@ bad */ b" and s.clean == "a b"

    s = c.split_prompt("/*@ N: one */ x /*@ N: two */")
    assert s.params == {"N": "two"} and s.clean == "x"

    untouched = "1girl,  (smile:1.2) ,, {a|b}"
    s = c.split_prompt(untouched)
    assert s.meta == untouched and s.clean == untouched


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
```

- [ ] **Step 2: Run it and see it fail**

Run: `python3 tests/test_comments.py`
Expected: `ImportError: cannot import name 'sd_prompt_lab_comments'`

- [ ] **Step 3: Implement**

```python
# scripts/prompt_lab/sd_prompt_lab_comments.py
"""Prompt comments: `/* note */` and `/*@ Name: value */`.

A plain comment stays in the image metadata but is not used for generation. A param
comment is moved to the metadata parameter line (next to Steps, Sampler, …).

Pure module: no WebUI imports, so it can be tested with plain Python.
"""
import re
from collections import namedtuple

Split = namedtuple("Split", "meta clean params rejected")

# Names the WebUI and Dynamic Prompts write themselves. A param with one of these names
# would overwrite the real value in the metadata, so it is kept as a plain comment.
RESERVED = frozenset(name.lower() for name in (
    "Steps", "Sampler", "CFG scale", "Image CFG scale", "Seed", "Face restoration", "Size",
    "Model hash", "Model", "VAE hash", "VAE", "Variation seed", "Variation seed strength",
    "Seed resize from", "Denoising strength", "Conditional mask weight", "Clip skip", "ENSD",
    "Token merging ratio", "Token merging ratio hr", "Init image hash", "RNG", "NGMS", "Tiling",
    "Version", "User", "Prompt", "Negative prompt", "Hires prompt", "Hires negative prompt",
    "Hires upscale", "Hires steps", "Hires upscaler", "Hires resize", "Hires sampler",
    "Hires checkpoint", "Refiner", "Refiner switch at", "VAE Decoder", "VAE Encoder",
    "Template", "Negative Template",
))

# What Dynamic Prompts would act on inside a comment, and private-use stand-ins.
_SHIELD = {"#": "", "$": "", "%": "", "{": "", "}": "",
           "_": "", "|": ""}
_SHIELD_TABLE = str.maketrans(_SHIELD)
_UNSHIELD_TABLE = str.maketrans({v: k for k, v in _SHIELD.items()})

# A __wildcard__ (same shape as in sd_prompt_lab_utils), or the start of a comment.
_SCAN_RE = re.compile(r"__(?:(?!__)[^\n{}#$(])+(?:\([^)\n]*\))?__|/\*")
_NAME_RE = re.compile(r"[\w ]+")     # what the WebUI's infotext parser accepts as a name
_GAP = ""                      # marks where a comment was cut out


def find_comments(text: str) -> list:
    """(start, end) of every closed /* … */. "/*" inside a wildcard glob such as
    __dir/*__ does not open a comment; an unclosed "/*" is plain text."""
    spans, pos = [], 0
    while True:
        match = _SCAN_RE.search(text, pos)
        if not match:
            return spans
        if match.group() != "/*":
            pos = match.end()
            continue
        close = text.find("*/", match.end())
        if close == -1:
            return spans
        spans.append((match.start(), close + 2))
        pos = close + 2


def parse_param(body: str):
    """Comment body "@ Name: value" -> (name, value); None when it is not a valid param."""
    if not body.startswith("@"):
        return None
    name, colon, value = body[1:].partition(":")
    name, value = " ".join(name.split()), " ".join(value.split())
    if not colon or not name or not value or not _NAME_RE.fullmatch(name):
        return None
    return name, value


def shield(text: str) -> str:
    """Hide comment text from Dynamic Prompts. Reverse with unshield()."""
    spans = find_comments(text)
    if not spans:
        return text
    out, pos = [], 0
    for start, end in spans:
        out.append(text[pos:start])
        out.append(text[start:end].translate(_SHIELD_TABLE))
        pos = end
    out.append(text[pos:])
    return "".join(out)


def unshield(text: str) -> str:
    return text.translate(_UNSHIELD_TABLE)


def _cut(text: str, spans: list) -> str:
    """Remove the spans and tidy the commas, spaces and empty lines they leave behind."""
    if not spans:
        return text
    out, pos = [], 0
    for start, end in spans:
        out.append(text[pos:start])
        out.append(_GAP)
        pos = end
    out.append(text[pos:])
    cut = "".join(out)
    cut = re.sub(rf"{_GAP}(?:[ \t]*{_GAP})+", _GAP, cut)                # neighbouring comments: one gap
    cut = re.sub(rf"(?m)^[ \t]*{_GAP}[ \t]*\n", "", cut)               # a line that held only comments
    cut = re.sub(rf"\n[ \t]*{_GAP}[ \t]*$", "", cut)                   # … as the last line
    cut = re.sub(rf",[ \t]*{_GAP}[ \t]*(?=,)", "", cut)                # "a, <gap>, b" -> "a, b"
    cut = re.sub(rf"[ \t]*{_GAP}[ \t]*(?=,)", "", cut)                 # "a <gap>, b"  -> "a, b"
    cut = re.sub(rf"[ \t]*{_GAP}[ \t]*", " ", cut)                     # "a, <gap> b"  -> "a, b"
    return cut.strip()


def split_prompt(text: str, reserved=frozenset()) -> Split:
    """meta: the prompt as written to the image metadata (params removed, notes kept).
    clean: the prompt used for generation (no comments at all).
    params: {name: value} of the valid params, the later one winning.
    rejected: reserved names that were used; those comments stay as plain comments."""
    spans = find_comments(text)
    if not spans:
        return Split(text, text, {}, [])
    params, rejected, param_spans = {}, [], []
    for start, end in spans:
        parsed = parse_param(text[start + 2:end - 2])
        if parsed is None:
            continue
        name, value = parsed
        if name.lower() in reserved:
            rejected.append(name)
            continue
        params.pop(name, None)       # keep the position of the later one
        params[name] = value
        param_spans.append((start, end))
    return Split(_cut(text, param_spans), _cut(text, spans), params, rejected)
```

- [ ] **Step 4: Run the test**

Run: `python3 tests/test_comments.py`
Expected: four `ok test_…` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/prompt_lab/sd_prompt_lab_comments.py tests/test_comments.py
git commit -m "feat(comments): parse, shield and split prompt comments"
```

---

### Task 2: Apply comments to a WebUI processing object

**Files:**
- Modify: `scripts/prompt_lab/sd_prompt_lab_comments.py` (append)
- Test: `tests/test_comments.py` (append)

**Interfaces:**
- Consumes: `shield`, `unshield`, `split_prompt`, `RESERVED` from Task 1.
- Produces: `shield_processing(p)`, `apply_batch(p, batch_number)`, `set_image_params(p, index)`. `p` is duck-typed: `prompt`, `negative_prompt`, optional `hr_prompt`, `hr_negative_prompt`, `all_prompts`, `all_negative_prompts`, optional `all_hr_prompts`, `all_hr_negative_prompts`, `prompts`, `negative_prompts`, `main_prompt`, `main_negative_prompt`, `batch_size`, `extra_generation_params`, optional `comment(text)`.

- [ ] **Step 1: Write the failing test** (append to `tests/test_comments.py`, above the `__main__` block)

```python
from types import SimpleNamespace


def make_p(prompt, negative="", batch_size=1, n=1, extra=None):
    warnings = []
    p = SimpleNamespace(
        prompt=prompt, negative_prompt=negative, hr_prompt="", hr_negative_prompt="",
        batch_size=batch_size, extra_generation_params=dict(extra or {}),
        warnings=warnings, comment=warnings.append,
    )
    c.shield_processing(p)                       # hook: before_process
    # what the WebUI does next: setup_prompts(), then the batch slice
    p.all_prompts = [p.prompt] * (batch_size * n)
    p.all_negative_prompts = [p.negative_prompt] * (batch_size * n)
    p.all_hr_prompts = list(p.all_prompts)
    p.all_hr_negative_prompts = list(p.all_negative_prompts)
    p.main_prompt, p.main_negative_prompt = p.all_prompts[0], p.all_negative_prompts[0]
    return p


def start_batch(p, n):
    size = p.batch_size
    p.prompts = p.all_prompts[n * size:(n + 1) * size]
    p.negative_prompts = p.all_negative_prompts[n * size:(n + 1) * size]
    c.apply_batch(p, n)                          # hook: before_process_batch


def test_apply_batch():
    p = make_p("1girl, /* #1 {a|b} */ dress /*@ Mood: calm */", "bad /* why */ hands",
               extra={"Lora hashes": "x"})
    assert "#" not in p.prompt and "{" not in p.prompt       # shielded for Dynamic Prompts
    start_batch(p, 0)
    assert p.prompts == ["1girl, dress"]
    assert p.negative_prompts == ["bad hands"]
    assert p.all_prompts == ["1girl, /* #1 {a|b} */ dress"]           # metadata keeps the note
    assert p.all_negative_prompts == ["bad /* why */ hands"]
    assert p.all_hr_prompts == ["1girl, dress"]
    assert p.main_prompt == "1girl, /* #1 {a|b} */ dress"
    assert p.prompt == "1girl, /* #1 {a|b} */ dress /*@ Mood: calm */"  # unshielded again
    assert p.extra_generation_params == {"Lora hashes": "x", "Mood": "calm"}


def test_reserved_names_become_comments():
    p = make_p("a /*@ Steps: 5 */ /*@ lora hashes: y */ b", extra={"Lora hashes": "x"})
    start_batch(p, 0)
    assert p.extra_generation_params == {"Lora hashes": "x"}
    assert p.all_prompts == ["a /*@ Steps: 5 */ /*@ lora hashes: y */ b"]
    assert p.prompts == ["a b"] and len(p.warnings) == 2


def test_params_per_image():
    p = make_p("x", batch_size=2, n=2)
    p.all_prompts = ["a /*@ V: 1 */", "b /*@ V: 2 */", "c", "d /*@ V: 4 */ /*@ W: w */"]
    start_batch(p, 0)
    assert p.extra_generation_params == {"V": "1"}
    c.set_image_params(p, 1)                     # hook: postprocess_image
    assert p.extra_generation_params == {"V": "2"}
    start_batch(p, 1)
    assert p.extra_generation_params == {}       # image 2 has no params
    c.set_image_params(p, 3)
    assert p.extra_generation_params == {"V": "4", "W": "w"}
    assert p.all_prompts == ["a", "b", "c", "d"]


def test_no_comments_is_a_no_op():
    p = make_p("1girl,  {a|b} , __w__")
    start_batch(p, 0)
    assert p.prompts == ["1girl,  {a|b} , __w__"] and p.all_prompts == p.prompts
    assert p.extra_generation_params == {}
```

- [ ] **Step 2: Run it and see it fail**

Run: `python3 tests/test_comments.py`
Expected: `AttributeError: module … has no attribute 'shield_processing'`

- [ ] **Step 3: Implement** (append to `sd_prompt_lab_comments.py`)

```python
# ---- applying comments to a WebUI processing object ("p") ------------------------------

_INPUT_FIELDS = ("prompt", "negative_prompt", "hr_prompt", "hr_negative_prompt")
_DERIVED_FIELDS = (
    "all_prompts", "all_negative_prompts", "all_hr_prompts", "all_hr_negative_prompts",
    "prompts", "negative_prompts", "main_prompt", "main_negative_prompt", "prompt_for_display",
)
_STATE = "_sd_prompt_lab_comments"


def _map_field(p, field, fn):
    """Apply fn to a string field, or in place to every string of a list field (other
    scripts may hold a reference to the list)."""
    value = getattr(p, field, None)
    if isinstance(value, str):
        setattr(p, field, fn(value))
    elif isinstance(value, list):
        value[:] = [fn(item) if isinstance(item, str) else item for item in value]


def shield_processing(p):
    """before_process: Dynamic Prompts builds the prompts from these fields in its
    process() hook, so comment text has to be hidden from it before that."""
    for field in _INPUT_FIELDS:
        _map_field(p, field, shield)


def _unshield_processing(p):
    for field in _INPUT_FIELDS + _DERIVED_FIELDS:
        _map_field(p, field, unshield)
    params = getattr(p, "extra_generation_params", None)
    if isinstance(params, dict):
        for key, value in list(params.items()):
            if isinstance(value, str):
                params[key] = unshield(value)


def _state(p) -> dict:
    state = getattr(p, _STATE, None)
    if state is None:
        state = {"params": {}, "owned": set()}
        setattr(p, _STATE, state)
    return state


def set_image_params(p, index: int):
    """Put the params of image `index` (and only those) into the metadata parameters."""
    state = _state(p)
    for name in state["owned"]:
        p.extra_generation_params.pop(name, None)
    state["owned"] = set()
    for name, value in state["params"].get(index, {}).items():
        p.extra_generation_params[name] = value
        state["owned"].add(name)


def apply_batch(p, batch_number: int):
    """before_process_batch: every process() hook has run, so the prompts are final.
    p.all_prompts is what the metadata shows, p.prompts is what gets encoded; the WebUI
    resets p.prompts from p.all_prompts after sampling."""
    _unshield_processing(p)
    state = _state(p)
    start = batch_number * p.batch_size
    reserved = RESERVED | {key.lower() for key in p.extra_generation_params if key not in state["owned"]}

    for i in range(len(p.prompts)):
        index = start + i
        params = {}
        for all_field, batch_field in (("all_negative_prompts", "negative_prompts"), ("all_prompts", "prompts")):
            all_values, batch_values = getattr(p, all_field), getattr(p, batch_field)
            split = split_prompt(all_values[index], reserved)
            all_values[index] = split.meta
            batch_values[i] = split_prompt(batch_values[i]).clean
            params.update(split.params)
            for name in split.rejected:
                if callable(getattr(p, "comment", None)):
                    p.comment(f'Prompt Lab: "{name}" is a reserved parameter name; kept as a comment.')
        state["params"][index] = params

    # Hires prompts are only encoded, never shown as the prompt: drop every comment.
    for field in ("all_hr_prompts", "all_hr_negative_prompts"):
        values = getattr(p, field, None)
        if isinstance(values, list):
            for index in range(start, min(start + p.batch_size, len(values))):
                values[index] = split_prompt(values[index]).clean

    if batch_number == 0:    # shown on the grid image
        for field in ("main_prompt", "main_negative_prompt"):
            _map_field(p, field, lambda text: split_prompt(text, reserved).meta)

    set_image_params(p, start)
```

- [ ] **Step 4: Run the test**

Run: `python3 tests/test_comments.py`
Expected: eight `ok test_…` lines.

- [ ] **Step 5: Commit**

```bash
git add scripts/prompt_lab/sd_prompt_lab_comments.py tests/test_comments.py
git commit -m "feat(comments): apply comments to a processing object"
```

---

### Task 3: Prove the shield against the real Dynamic Prompts library

**Files:**
- Test: `tests/test_comments_dp.py`

- [ ] **Step 1: Write the test**

```python
# tests/test_comments_dp.py — needs `pip install dynamicprompts`; skipped without it.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.prompt_lab import sd_prompt_lab_comments as c

try:
    from dynamicprompts.generators import RandomPromptGenerator
except ImportError:
    print("skipped: dynamicprompts is not installed")
    sys.exit(0)

generate = lambda text: str(RandomPromptGenerator().generate(text, 1)[0])

CASES = [
    "a, /* issue #12, costs $5, 50% {x|y} __w__ a_b__c */ b",
    "a, /*@ Prompt name: Outfit #3 {v2} my__name */ b",
    "{red /* why | not */|red} dress",
    "a\n/* line one\nline # two */\nb",
]
for text in CASES:
    out = c.unshield(generate(c.shield(text)))
    # The variant case picks one of its two options; the comment inside stays whole.
    expected = {text} if "{red" not in text else {"red /* why | not */ dress", "red dress"}
    assert out in expected, (text, out)
    print("ok", repr(text))

# Without the shield the same text is damaged — this is why the shield exists.
assert generate(CASES[0]) != CASES[0]
print("ok unshielded text is damaged")
```

- [ ] **Step 2: Run it**

Run: `python3 -m venv /tmp/dpvenv && /tmp/dpvenv/bin/pip -q install dynamicprompts==0.31.0 && /tmp/dpvenv/bin/python tests/test_comments_dp.py`
Expected: five `ok` lines. If a case fails, add the offending character to `_SHIELD` in Task 1 and re-run both test files.

- [ ] **Step 3: Commit**

```bash
git add tests/test_comments_dp.py
git commit -m "test(comments): shield round trip through dynamicprompts"
```

---

### Task 4: Setting, always-on script, sampler

**Files:**
- Modify: `scripts/prompt_lab/sd_prompt_lab_db.py` (`DEFAULT_SETTINGS`)
- Create: `scripts/sd_prompt_lab_comments_script.py`
- Modify: `scripts/prompt_lab/sd_prompt_lab_sampler.py`

**Interfaces:**
- Consumes: `shield_processing`, `apply_batch`, `set_image_params`, `shield`, `unshield`; `db.get_settings()`.
- Produces: setting key `prompt_comments` (bool, default `True`) returned by `GET /sd-prompt-lab/settings`.

- [ ] **Step 1: Add the setting**

In `DEFAULT_SETTINGS` (`sd_prompt_lab_db.py`), after `"tag_underscores": False,`:

```python
    # /* notes */ and /*@ Name: value */ params are handled during generation.
    "prompt_comments": True,
```

- [ ] **Step 2: Write the script**

```python
# scripts/sd_prompt_lab_comments_script.py
import modules.scripts as scripts

from scripts.prompt_lab import sd_prompt_lab_comments as comments
from scripts.prompt_lab import sd_prompt_lab_db as db

_ENABLED = "_sd_prompt_lab_comments_on"


def _enabled() -> bool:
    try:
        return db.get_settings().get("prompt_comments", True) is not False
    except Exception:
        return True


class PromptLabCommentsScript(scripts.Script):
    """Keeps /* notes */ out of generation and moves /*@ Name: value */ to the metadata."""

    def title(self):
        return "Prompt Lab comments"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def before_process(self, p, *args):
        # Decided once per run, so a settings change mid-run cannot leave text shielded.
        setattr(p, _ENABLED, _enabled())
        if getattr(p, _ENABLED):
            comments.shield_processing(p)

    def before_process_batch(self, p, *args, **kwargs):
        if getattr(p, _ENABLED, False):
            comments.apply_batch(p, kwargs.get("batch_number", 0))

    def postprocess_image(self, p, pp, *args):
        if getattr(p, _ENABLED, False):
            comments.set_image_params(p, p.iteration * p.batch_size + p.batch_index)
```

- [ ] **Step 3: Shield the sampler**

In `sample_prompt` (`sd_prompt_lab_sampler.py`) add `from . import sd_prompt_lab_comments as comments` at the top of the file and replace the return line:

```python
        samples = generator.generate(comments.shield(prompt), count)
        return [comments.unshield(str(sample)) for sample in samples]
```

- [ ] **Step 4: Verify the script loads**

Start the WebUI in debug mode (command in the memory note `verify-ui-in-real-webui`), then:

Start it with `--api` added. A script without UI controls is not listed by `/sdapi/v1/scripts`, so ask for it by name instead:

Run: `curl -s -X POST localhost:3000/sdapi/v1/txt2img -H 'Content-Type: application/json' -d '{"prompt":"a","steps":1,"alwayson_scripts":{"prompt lab comments":{"args":[]}}}'`
Expected: anything except `Script 'prompt lab comments' not found` (without a checkpoint it fails later with `No checkpoints found`), and no `Error loading script` line for `sd_prompt_lab_comments_script.py` in the WebUI log.

Run: `curl -s localhost:3000/sd-prompt-lab/settings`
Expected: JSON containing `"prompt_comments": true`.

- [ ] **Step 5: Commit**

```bash
git add scripts/sd_prompt_lab_comments_script.py scripts/prompt_lab/sd_prompt_lab_db.py scripts/prompt_lab/sd_prompt_lab_sampler.py
git commit -m "feat(comments): always-on script, setting and sampler support"
```

---

### Task 5: Editor parser — param token and diagnostics

**Files:**
- Modify: `editor/dp_parser.js` (comment branch in `scan`, `parsePrompt` output)
- Test: `editor/test/dp_parser.test.js`

**Interfaces:**
- Produces: token types `param` (whole `/*@ … */`) and `paramName` (the name inside); `parsePrompt(...).params: [{from, to, name, value}]`; diagnostic codes `comment-unclosed`, `param-invalid`, `param-reserved`, `param-duplicate`, `comment-unsafe` (wildcard-file mode only), all severity `warning`. `//` is no longer a comment.

- [ ] **Step 1: Write the failing tests** (append to `dp_parser.test.js`)

```js
test('block comments and params', () => {
    assert.deepEqual(types('a /* note */ b'), ['comment']);
    assert.deepEqual(types('a /*@ Mood: calm */ b'), ['param', 'paramName']);
    assert.deepEqual(parsePrompt('/*@ Prompt name: My  fav */').params.map((p) => [p.name, p.value]),
        [['Prompt name', 'My fav']]);
    assert.deepEqual(codes('/* # $ % { | __ */ a, /*@ Mood: {x */ b'), []);     // inert
    assert.deepEqual(codes('a /* never closed'), ['comment-unclosed']);
    assert.deepEqual(codes('/*@ no colon */'), ['param-invalid']);
    assert.deepEqual(codes('/*@ Na/me: v */'), ['param-invalid']);
    assert.deepEqual(codes('/*@ Name: */'), ['param-invalid']);
    assert.deepEqual(codes('/*@ steps: 5 */'), ['param-reserved']);
    assert.deepEqual(codes('/*@ Template: x */'), ['param-reserved']);
    assert.deepEqual(codes('/*@ N: a */ /*@ N: b */'), ['param-duplicate']);
    assert.deepEqual(codes('__dir/*__ and /* note */'), []);                    // glob is not a comment
});

test('"//" is sent to generation, so it is not a comment', () => {
    assert.deepEqual(types('a // b'), []);
    assert.deepEqual(types('# real comment'), ['comment']);
});

test('wildcard files: comments are not protected from Dynamic Prompts', () => {
    const opts = {mode: 'wildcard-file'};
    assert.deepEqual(codes('red dress /*@ Outfit: red */', opts), []);
    assert.deepEqual(codes('red /* 50% off #1 */', opts), ['comment-unsafe']);
});
```

Also change the existing "valid prompts" case `'# a comment\na, b // trailing\n/* block | {  */ c'` to `'# a comment\na, b\n/* block | {  */ c'`.

- [ ] **Step 2: Run and see them fail**

Run: `cd editor && node --test test/dp_parser.test.js`
Expected: the three new tests fail (`param` token missing, `//` still a comment).

- [ ] **Step 3: Implement**

At the top of `dp_parser.js`, next to the other constants:

```js
// Names the WebUI and Dynamic Prompts write to the image metadata themselves. Keep in
// sync with RESERVED in scripts/prompt_lab/sd_prompt_lab_comments.py.
const RESERVED_PARAMS = new Set([
    'steps', 'sampler', 'cfg scale', 'image cfg scale', 'seed', 'face restoration', 'size',
    'model hash', 'model', 'vae hash', 'vae', 'variation seed', 'variation seed strength',
    'seed resize from', 'denoising strength', 'conditional mask weight', 'clip skip', 'ensd',
    'token merging ratio', 'token merging ratio hr', 'init image hash', 'rng', 'ngms', 'tiling',
    'version', 'user', 'prompt', 'negative prompt', 'hires prompt', 'hires negative prompt',
    'hires upscale', 'hires steps', 'hires upscaler', 'hires resize', 'hires sampler',
    'hires checkpoint', 'refiner', 'refiner switch at', 'vae decoder', 'vae encoder',
    'template', 'negative template',
]);
const PARAM_NAME_RE = /^[\p{L}\p{N}_ ]+$/u;
const UNSAFE_IN_WILDCARD_COMMENT_RE = /[#$%{}]|__/;
```

Add `params` to the destructuring at the top of `scan` (`const {tokens, diagnostics, blocks, wildcards, variables, plain, params} = out;`) and `params: []` to `out` in `parsePrompt`, and return `params: out.params` from `parsePrompt`. Pass the mode down: `scan(text, lineStart, lineEnd, out, {checkVariables: false, wildcardFile: true})`.

Replace the two comment branches in `scan`:

```js
        // "#" starts a Dynamic Prompts comment: the rest of the line never reaches the WebUI.
        if (ch === '#') {
            const j = lineEnd(i);
            tok('comment', i, j);
            i = j;
            continue;
        }
        // /* note */ and /*@ Name: value */ are Prompt Lab comments (see
        // sd_prompt_lab_comments.py). Unclosed, "/*" is plain text.
        if (ch === '/' && next === '*') {
            const close = text.indexOf('*/', i + 2);
            if (close === -1 || close + 2 > end) {
                warn('comment-unclosed', i, i + 2, 'Comment is not closed with "*/" — this text is sent to generation');
                i += 2;
                continue;
            }
            const j = close + 2;
            if (text[i + 2] === '@') paramComment(i, j);
            else tok('comment', i, j);
            if (opts.wildcardFile && UNSAFE_IN_WILDCARD_COMMENT_RE.test(text.slice(i + 2, close))) {
                warn('comment-unsafe', i, j, 'In a wildcard file, # $ % { } and __ inside a comment are still read by Dynamic Prompts');
            }
            i = j;
            continue;
        }
```

Add next to `reportUnclosed` in `scan`:

```js
    const paramComment = (from, to) => {
        tok('param', from, to);
        const body = text.slice(from + 3, to - 2);
        const colon = body.indexOf(':');
        const rawName = colon === -1 ? '' : body.slice(0, colon);
        const name = rawName.replace(/\s+/g, ' ').trim();
        const value = colon === -1 ? '' : body.slice(colon + 1).replace(/\s+/g, ' ').trim();
        if (!name || !value || !PARAM_NAME_RE.test(name)) {
            warn('param-invalid', from, to, 'Not a "/*@ Name: value */" param (letters, digits, _ and spaces in the name) — kept as a plain comment');
            return;
        }
        const nameFrom = from + 3 + rawName.length - rawName.trimStart().length;
        tok('paramName', nameFrom, nameFrom + rawName.trim().length);
        if (RESERVED_PARAMS.has(name.toLowerCase())) {
            warn('param-reserved', nameFrom, nameFrom + rawName.trim().length, `"${name}" is written by the WebUI itself — kept as a plain comment`);
            return;
        }
        if (params.some((p) => p.name === name)) {
            warn('param-duplicate', nameFrom, nameFrom + rawName.trim().length, `"${name}" is set more than once — the last one wins`);
        }
        params.push({from, to, name, value});
    };
```

- [ ] **Step 4: Run all editor tests**

Run: `cd editor && node --test test/*.test.js`
Expected: all pass except `dp_tools.test.js:25` (`ctx('// comm')` expects `null`), which Task 6 updates.

- [ ] **Step 5: Commit**

```bash
git add editor/dp_parser.js editor/test/dp_parser.test.js
git commit -m "feat(editor): param comments, comment diagnostics; // is not a comment"
```

---

### Task 6: Reformat, completion and colours

**Files:**
- Modify: `editor/dp_format.js:15,51`, `editor/dp_complete.js:16`, `editor/style.css`
- Test: `editor/test/dp_format.test.js`, `editor/test/dp_tools.test.js`

**Interfaces:**
- Consumes: token types `param`, `paramName` from Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `dp_format.test.js` (it already imports `reformatPrompt`):

```js
test('comments and params pass through Reformat untouched', () => {
    const text = 'a,b ,/*@ Prompt name: x,y ,z */ c,/* note , here */d';
    const out = reformatPrompt(text);
    assert.ok(out.includes('/*@ Prompt name: x,y ,z */'));
    assert.ok(out.includes('/* note , here */'));
});
```

In `dp_tools.test.js` (it already imports `completionContext`), delete the line `assert.equal(ctx('// comm'), null);` — `//` is no longer a comment — and append:

```js
test('no completion inside a block comment', () => {
    assert.equal(completionContext('a, /* long ha'), null);
    assert.equal(completionContext('a, /*@ Mood: ca'), null);
    assert.notEqual(completionContext('a, /* note */ long ha'), null);
    assert.notEqual(completionContext('http://x, long ha'), null);     // "//" is not a comment
});
```

- [ ] **Step 2: Run and see them fail**

Run: `cd editor && node --test test/*.test.js`
Expected: the two new tests fail.

- [ ] **Step 3: Implement**

`dp_format.js`:

```js
const PROTECTED_TOKENS = new Set(['comment', 'param', 'lora', 'wildcard', 'variableSet', 'variableUse']);
```

and in `mask`, `t.type === 'comment'` becomes `(t.type === 'comment' || t.type === 'param')`.

`dp_complete.js`, replacing the comment check:

```js
    // Never complete inside a comment.
    if (/(^|\s)#/.test(text)) return null;
    if (text.lastIndexOf('/*') > text.lastIndexOf('*/')) return null;
```

`style.css`, after the `.spl-tok-comment` rule:

```css
/* /*@ Name: value *\/ — moved to the image metadata parameters. */
:is(.cm-content, .spl-highlight) .spl-tok-param {
    color: #8fa3bd;
    font-style: italic;
}

:is(.cm-content, .spl-highlight) .spl-tok-paramName {
    color: #7ee0c3;
    font-style: normal;
    font-weight: 600;
}
```

- [ ] **Step 4: Run tests and rebuild**

Run: `cd editor && node --test test/*.test.js && npm run build`
Expected: all tests pass; `created ../javascript/lib/codemirror6.bundle.js`.

- [ ] **Step 5: Commit**

```bash
git add editor/dp_format.js editor/dp_complete.js editor/style.css editor/test javascript/lib
git commit -m "feat(editor): protect, colour and skip completion in comments"
```

---

### Task 7: Add the prompt name on send and copy

**Files:**
- Modify: `scripts/prompt_lab/sd_prompt_lab_api.py` (new route, before the `/sd-prompt-lab/{prompt_id}` catch-all)
- Modify: `javascript/spl_common.js`, `javascript/index.js` (`sendCreatePromptToTxt2Img`), `javascript/browse.js` (`onCardAction`), `javascript/prompt_preview.js` (copy handler)

**Interfaces:**
- Produces: `GET /sd-prompt-lab/exists?name=<name>` → `{"exists": bool, "name": "<stored name>"}`; `window.spl.withPromptName(prompt, name) -> string`.

- [ ] **Step 1: API route**

Add directly above `@app.get("/sd-prompt-lab/complete")`:

```python
    @app.get("/sd-prompt-lab/exists")
    def prompt_exists(name: str = ""):
        prompt = db.get_prompt_by_name(name.strip()) if name.strip() else None
        return {"exists": prompt is not None, "name": prompt["name"] if prompt else ""}
```

`db.get_prompt_by_name` returns a dict with a `name` key, or `None`.

- [ ] **Step 2: Shared helper** (`spl_common.js`, before the `window.spl = {` block; add `withPromptName` to that object)

```js
    // ---- prompt name param ---------------------------------------------------------
    // Sending or copying a saved prompt adds /*@ Prompt name: … */, which the comments
    // script moves to the image metadata. It is never stored in the saved prompt.

    let promptComments = true;
    fetch('/sd-prompt-lab/settings')
        .then((res) => (res.ok ? res.json() : {}))
        .then((settings) => { promptComments = settings.prompt_comments !== false; })
        .catch(() => {});
    window.addEventListener('sd-prompt-lab:settings-changed', (event) => {
        promptComments = event.detail?.prompt_comments !== false;
    });

    function withPromptName(prompt, name) {
        const text = String(prompt ?? '');
        const clean = String(name ?? '').replace(/\s+/g, ' ').replace(/\*\//g, '* /').trim();
        if (!promptComments || !clean || !text.trim()) return text;
        if (/\/\*@\s*prompt name\s*:/i.test(text)) return text;   // the author already set one
        return `${text.replace(/\s+$/, '')}\n/*@ Prompt name: ${clean} */`;
    }
```

- [ ] **Step 3: Callers**

`index.js`:

```js
async function sendCreatePromptToTxt2Img() {
    const prompt = window.sdPromptLabEditor?.state.doc.toString().trim();
    if (!prompt) {
        window.spl.toast('The prompt is empty', 'warn');
        return;
    }
    // Only a name that belongs to a saved prompt is added.
    let name = '';
    const typed = readCreateFields().name.trim();
    if (typed) {
        try {
            const res = await fetch(`/sd-prompt-lab/exists?name=${encodeURIComponent(typed)}`);
            const data = res.ok ? await res.json() : {};
            if (data.exists) name = data.name;
        } catch (e) {
            // Offline: send the prompt without a name.
        }
    }
    updateTxt2ImgPositivePrompt(window.spl.withPromptName(prompt, name));
}
```

`browse.js`, in `onCardAction`:

```js
        } else if (action === 'txt2img') {
            updateTxt2ImgPositivePrompt(window.spl.withPromptName(prompt.prompt || '', prompt.name));
        } else if (action === 'copy') {
            const ok = await window.spl.copyToClipboard(window.spl.withPromptName(prompt.prompt || '', prompt.name));
```

`prompt_preview.js`, in the copy handler: `copyToClipboard(current.prompt || '')` becomes `copyToClipboard(window.spl.withPromptName(current.prompt || '', current.id ? current.name : ''))`.

The Sample dialog's copy buttons are left as they are (decided).

- [ ] **Step 4: Commit**

```bash
git add scripts/prompt_lab/sd_prompt_lab_api.py javascript/spl_common.js javascript/index.js javascript/browse.js javascript/prompt_preview.js
git commit -m "feat: add the prompt name param when a saved prompt is sent or copied"
```

---

### Task 8: Settings switch and README

**Files:**
- Modify: `scripts/prompt_lab/ui/ui_tab_settings.py`, `javascript/settings.js`, `README.md`

- [ ] **Step 1: Switch markup** — in `ui_tab_settings.py`, after the "Keep underscores in completed tags" row:

```html
                <div class="spl-set-row">
                    <div class="spl-set-row-text">
                        <div class="spl-set-row-title">Prompt comments</div>
                        <div class="spl-set-row-desc">
                            <code>/* note */</code> stays in the image metadata but is not used
                            for generation. <code>/*@ Name: value */</code> is moved to the
                            metadata parameters. Off: both are sent to generation as text.
                        </div>
                    </div>
                    <label class="spl-set-switch">
                        <input id="spl-set-prompt-comments" type="checkbox">
                        <span class="spl-set-switch-track" aria-hidden="true">
                            <span class="spl-set-switch-knob"></span>
                        </span>
                    </label>
                </div>
```

- [ ] **Step 2: Wiring** — in `settings.js`: add `promptComments: 'spl-set-prompt-comments',` to `ids`; in `loadSettings` add

```js
        const comments = $(ids.promptComments);
        if (comments) comments.checked = settings.prompt_comments !== false;
```

and in `wireEvents`, next to the `tagUnderscores` handler:

```js
        $(ids.promptComments)?.addEventListener('change', (e) => {
            saveSetting('prompt_comments', e.target.checked).catch((err) => {
                e.target.checked = !e.target.checked;
                setStatus(err.message, 'error');
            });
        });
```

- [ ] **Step 3: README** — add a "Prompt comments" section under "Usage" with: the two syntaxes and one example of the resulting metadata; the name rules and that reserved names become plain comments; that Prompt Lab adds `Prompt name` on send/copy of a saved prompt; the four items from "Known limits" above.

- [ ] **Step 4: Commit**

```bash
git add scripts/prompt_lab/ui/ui_tab_settings.py javascript/settings.js README.md
git commit -m "feat(settings): prompt comments switch; document the feature"
```

---

### Task 9: Verify in the real WebUI

No checkpoint is installed on the development machine, so image generation cannot be run there. Steps 1–3 run in debug mode with real mouse clicks in Chrome (see memory note `verify-ui-in-real-webui`; restart the WebUI first, script URLs are fixed at startup). Step 4 needs a machine with a model.

- [ ] **Step 1: Tests** — `python3 tests/test_comments.py`, `/tmp/dpvenv/bin/python tests/test_comments_dp.py`, `cd editor && node --test test/*.test.js`: all pass.

- [ ] **Step 2: Send and copy**
  - Browse card "txt2img": the txt2img prompt ends with a new line `/*@ Prompt name: <card name> */`.
  - Browse card "Copy" and preview popup "Copy": paste into the txt2img box; same last line.
  - Open that prompt for editing in Create: the editor text has no `Prompt name` line (not stored).
  - Create, Name = a saved name → "txt2img" adds the line. Name = `zzz-not-saved` → no line.
  - Settings → Prompt comments off → card "txt2img" adds no line. Switch it back on.

- [ ] **Step 3: Editor** — in Create type `1girl, /* note #1 */ /*@ Mood: calm */ /*@ Steps: 5 */ /* open`: note is grey italic, `Mood` is highlighted as a param name, `Steps` has a "reserved" warning, the unclosed `/*` has a warning, the status bar shows 2 warnings. Reformat leaves both closed comments unchanged. Sample (needs Dynamic Prompts installed) returns text with the comments intact.

- [ ] **Step 4: Generation (machine with a checkpoint and Dynamic Prompts)** — generate with
  `1girl, {red|blue} dress, /* test #1 {a|b} */ /*@ Mood: calm */` and negative `blurry /* why */`.
  In PNG Info expect: prompt `1girl, red dress, /* test #1 {a|b} */` (or blue), negative `blurry /* why */`, and `Mood: calm` on the parameter line. Generate the same seed with and without the two comments: the images must be identical. Repeat with Hires fix on, and with batch size 2.

- [ ] **Step 5: Finish** — push `feat/prompt-comments`; merge to `main` when the user confirms step 4.
