"""Run: python3 tests/test_comments.py (plain asserts, no pytest needed)."""
import os
import sys
from types import SimpleNamespace

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


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
