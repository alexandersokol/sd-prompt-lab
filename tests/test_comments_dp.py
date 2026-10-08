"""Comments must survive the real Dynamic Prompts parser. Needs `pip install dynamicprompts`;
skipped without it."""
import os
import sys

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
