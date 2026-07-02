import copy

# Flattening query for NEXTAltair/genai-image-tag-db (normalized multi-booru schema).
# One row per tag: name, MAX post_count across formats, category mapped to Danbooru codes
# (from the tag's type), deprecated only if deprecated in every format, translations as words.
_GENAI_TAG_DB_QUERY = """
SELECT
    t.tag_id AS id,
    t.tag AS name,
    COALESCE(uc.post_count, 0) AS post_count,
    cat.category AS category,
    COALESCE(st.is_deprecated, 0) AS is_deprecated,
    tr.words AS words
FROM TAGS t
LEFT JOIN (
    SELECT tag_id, MAX(count) AS post_count
    FROM TAG_USAGE_COUNTS GROUP BY tag_id
) uc ON uc.tag_id = t.tag_id
LEFT JOIN (
    SELECT tag_id, MIN(deprecated) AS is_deprecated
    FROM TAG_STATUS GROUP BY tag_id
) st ON st.tag_id = t.tag_id
LEFT JOIN (
    SELECT s.tag_id AS tag_id,
        CASE lower(tn.type_name)
            WHEN 'general' THEN 0 WHEN 'artist' THEN 1 WHEN 'copyright' THEN 3
            WHEN 'character' THEN 4 WHEN 'meta' THEN 5 ELSE NULL END AS category
    FROM TAG_STATUS s
    JOIN TAG_TYPE_FORMAT_MAPPING m ON m.format_id = s.format_id AND m.type_id = s.type_id
    JOIN TAG_TYPE_NAME tn ON tn.type_name_id = m.type_name_id
    GROUP BY s.tag_id
) cat ON cat.tag_id = t.tag_id
LEFT JOIN (
    SELECT tag_id, GROUP_CONCAT(translation, ', ') AS words
    FROM TAG_TRANSLATIONS
    WHERE translation IS NOT NULL AND translation <> ''
    GROUP BY tag_id
) tr ON tr.tag_id = t.tag_id
"""

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
    {
        "id": "genai-image-tag-db",
        "name": "GenAI Image Tag DB (CC0)",
        "description": "4.4M tags across 19 boorus (Danbooru, e621, Gelbooru, …) with counts and "
                       "JA/ZH translations. Large SQLite download (~2.9 GB).",
        "homepage": "https://huggingface.co/datasets/NEXTAltair/genai-image-tag-db",
        "repo": "NEXTAltair/genai-image-tag-db",
        "local_dir": "genai-image-tag-db",
        "files": [
            {"remote": "genai-image-tag-db-cc0.sqlite", "format": "sqlite"},
        ],
        "mapping": None,
        # Normalized schema -> flat tag rows are produced by this query at import time.
        "sqlite_query": _GENAI_TAG_DB_QUERY,
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
