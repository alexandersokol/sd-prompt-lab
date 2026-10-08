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
