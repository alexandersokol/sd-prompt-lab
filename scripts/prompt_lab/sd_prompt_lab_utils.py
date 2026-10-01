import os
import re

from PIL import Image

import scripts.prompt_lab.sd_promt_lab_env as env

VALID_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def create_thumbnail(image_path: str, prompt_id: int):
    if not image_path:
        return None

    if not os.path.isfile(image_path):
        return None

    ext = os.path.splitext(image_path)[1].lower()
    if ext not in VALID_IMAGE_EXTENSIONS:
        return None

    # Open image
    try:
        with Image.open(image_path) as img:
            # Center crop
            width, height = img.size
            target_ratio = 250 / 350
            current_ratio = width / height

            if current_ratio > target_ratio:
                # Crop width
                new_width = int(height * target_ratio)
                left = (width - new_width) // 2
                box = (left, 0, left + new_width, height)
            else:
                # Crop height
                new_height = int(width / target_ratio)
                top = (height - new_height) // 2
                box = (0, top, width, top + new_height)

            img = img.crop(box)
            img = img.resize((250, 350), Image.LANCZOS)

            # Save
            pics_dir = os.path.join(env.script_dir, "pics")
            os.makedirs(pics_dir, exist_ok=True)
            out_path = os.path.join(pics_dir, f"{prompt_id}.png")
            img.save(out_path, format="PNG")

            return out_path
    except Exception as e:
        print(f"Thumbnail creation failed: {e}")
        return None


def get_extensions_dir():
    return os.path.abspath(os.path.join(env.script_dir, ".."))


def get_wildcards_dir():
    return os.path.join(get_extensions_dir(), "sd-dynamic-prompts", "wildcards")


_MAX_WORD_LENGTH = 80
_MAX_VARIANT_EXPANSIONS = 64
_INNER_VARIANT_RE = re.compile(r"\{([^{}]*)\}")
# Variant prefix: optional sampler, optional bound ("2$$", "1-3$$") and custom separator.
_VARIANT_PREFIX_RE = re.compile(r"\{\s*[~!@]?\s*(?:\d*-?\d*\$\$(?:[^${}]*\$\$)?)?")
_WILDCARD_RE = re.compile(r"__(?:(?!__)[^\n{}#$(])+(?:\([^)\n]*\))?__")


def _strip_variables(text: str) -> str:
    """Remove ${...} variable assignments/accesses, honouring nested braces."""
    out = []
    i = 0
    while i < len(text):
        if text.startswith("${", i):
            depth = 1
            j = i + 2
            while j < len(text) and depth:
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                j += 1
            out.append(",")
            i = j
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def _split_top_level(text: str) -> list:
    """Split on commas/newlines that are not inside a {} variant."""
    parts, depth, cur = [], 0, []
    for ch in text:
        if ch == "{":
            depth += 1
        elif ch == "}" and depth:
            depth -= 1
        if ch in ",\n" and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def _expand_variants(segment: str) -> list:
    """Expand {a|b} variants (innermost first) into every combination, capped."""
    results = [segment]
    while True:
        expanded, changed = [], False
        for item in results:
            match = _INNER_VARIANT_RE.search(item)
            if not match:
                expanded.append(item)
                continue
            changed = True
            for option in match.group(1).split("|"):
                # Inner commas split again below, so mark the option boundaries.
                expanded.append(item[:match.start()] + option + item[match.end():])
        results = expanded[:_MAX_VARIANT_EXPANSIONS]
        if not changed:
            return results


def _clean_word(candidate: str):
    # A1111 weight suffix: "(tag:1.2)" -> "(tag)".
    candidate = re.sub(r":\s*-?\d*\.?\d+(?=\s*[)\]]|\s*$)", "", candidate)
    candidate = re.sub(r"[()\[\]{}<>]", " ", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip(" \t.;\\")
    if not candidate or len(candidate) > _MAX_WORD_LENGTH:
        return None
    if re.fullmatch(r"[\d.\s]+", candidate):
        return None
    if re.search(r"[|$#]|__", candidate):
        return None
    return candidate


def parse_prompts(raw_prompt: str) -> list:
    """Extract clean autocompletion words from a prompt.

    Dynamic-prompt syntax (comments, wildcards, variables, variant bounds/weights), lora
    tags, BREAK and A1111 weights/brackets are removed; {a|b} variants are expanded.
    """
    text = raw_prompt or ""
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"(?m)(#|//).*$", " ", text)
    text = re.sub(r"<[^<>\n]*>", ",", text)
    text = _strip_variables(text)
    text = _WILDCARD_RE.sub(",", text)
    text = re.sub(r"\bBREAK\b", ",", text)
    text = _VARIANT_PREFIX_RE.sub("{", text)
    text = re.sub(r"(?<![\w.])\d*\.?\d+::", "", text)

    prompts, seen = [], set()
    for segment in _split_top_level(text):
        for expanded in _expand_variants(segment):
            for candidate in re.split(r"[,\n|]+", expanded):
                word = _clean_word(candidate)
                if word is None or word.lower() in seen:
                    continue
                seen.add(word.lower())
                prompts.append(word)
    return prompts


_MAX_SEARCH_FILE_SIZE = 5 * 1024 * 1024


def search_wildcard_files(root: str, query: str) -> list:
    """Return posix-relative paths of .txt files under root whose content contains query."""
    needle = (query or "").strip().lower()
    if not needle or not os.path.isdir(root):
        return []
    matches = []
    for current, _, files in os.walk(root):
        for name in files:
            if not name.endswith(".txt"):
                continue
            path = os.path.join(current, name)
            try:
                if os.path.getsize(path) > _MAX_SEARCH_FILE_SIZE:
                    continue
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    if needle in f.read().lower():
                        matches.append(os.path.relpath(path, root).replace(os.sep, "/"))
            except OSError:
                continue
    return sorted(matches)


def list_txt_files(directory, base=""):
    """Recursively list all .txt files as a tree."""
    result = []
    for entry in sorted(os.scandir(directory), key=lambda e: e.name):
        if entry.is_dir():
            sub_items = list_txt_files(entry.path, os.path.join(base, entry.name))
            if sub_items:
                result.append({
                    "name": entry.name,
                    "path": os.path.join(base, entry.name),
                    "type": "folder",
                    "children": sub_items
                })
        elif entry.is_file() and entry.name.endswith(".txt"):
            result.append({
                "name": entry.name,
                "path": os.path.join(base, entry.name),
                "type": "file"
            })
    return result
