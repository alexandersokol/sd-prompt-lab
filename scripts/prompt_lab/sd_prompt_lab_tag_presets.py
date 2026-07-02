import copy

# Curated registry of downloadable tag datasets.
#
# Each preset declares BOTH how to download a dataset and how to use it:
#   id          - stable identifier used by the download endpoint
#   name        - display name
#   description - short blurb shown in the download dialog
#   homepage    - link to the dataset page
#   repo        - Hugging Face "owner/name" dataset repo
#   local_dir   - datasets/<local_dir>/ where the tag file is stored
#   files       - ordered candidate files; the first that resolves (HTTP 200) is downloaded.
#                 Each: {"remote": <path in repo>, "format": "jsonl"|"json"|"csv"}
#   mapping     - optional {canonical_field: source_key} for datasets whose columns/keys
#                 differ from our schema (name/post_count/category/is_deprecated/words).
#                 None means use the default field detection.
PRESETS = [
    {
        "id": "danbooru-tags",
        "name": "Danbooru Tags",
        "description": "194K+ Danbooru tags with post counts and categories (qdlabs).",
        "homepage": "https://huggingface.co/datasets/qdlabs/danbooru-tags",
        "repo": "qdlabs/danbooru-tags",
        "local_dir": "danbooru-tags",
        "files": [
            {"remote": "tags.jsonl", "format": "jsonl"},
            {"remote": "tags.json", "format": "json"},
        ],
        "mapping": None,
    },
]


def list_presets():
    """Return a deep copy of the preset registry."""
    return [copy.deepcopy(p) for p in PRESETS]


def get_preset(preset_id):
    """Return a deep copy of a single preset, or None if unknown."""
    for preset in PRESETS:
        if preset["id"] == preset_id:
            return copy.deepcopy(preset)
    return None
