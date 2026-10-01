"""Sample expansions of a dynamic prompt with the real `dynamicprompts` library.

Kept free of heavy imports: the library is optional (it ships with the sd-dynamic-prompts
extension) and is only imported when a sample is requested.
"""
from pathlib import Path


class SamplerUnavailable(Exception):
    """The dynamicprompts library is not installed in this WebUI."""


def sample_prompt(prompt: str, count: int, wildcards_dir: str) -> list:
    """Return `count` random expansions of `prompt`. Raises SamplerUnavailable / ValueError."""
    try:
        from dynamicprompts.generators import RandomPromptGenerator
        from dynamicprompts.wildcards import WildcardManager
    except ImportError as e:
        raise SamplerUnavailable(
            "Sampling needs the Dynamic Prompts extension (the 'dynamicprompts' library is not installed)."
        ) from e

    count = max(1, min(int(count), 10))
    try:
        manager = WildcardManager(Path(wildcards_dir))
        generator = RandomPromptGenerator(wildcard_manager=manager)
        return [str(sample) for sample in generator.generate(prompt, count)]
    except Exception as e:  # parse errors and missing wildcards surface as a readable message
        raise ValueError(str(e) or e.__class__.__name__) from e
