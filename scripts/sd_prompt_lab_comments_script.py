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
