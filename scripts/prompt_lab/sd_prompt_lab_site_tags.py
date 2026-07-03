"""Per-site record adapters for the deepghs/site_tags multi-source dataset.

The repo bundles one tag dump per booru/site, each with its own schema and its own
tag-type encoding. These adapters normalize a raw record from a given site into our
canonical fields so the merged tag browser can ingest them uniformly:

    {name, post_count, category, is_deprecated, words}

Category codes follow the Danbooru scheme used across the browser, plus a Species code
for e621-style datasets:

    0 General   1 Artist   3 Copyright   4 Character   5 Meta   6 Species

Sites whose native categories don't map cleanly (anime-pictures, wallhaven, pixiv) keep
their name and post count but leave category null (shown as "Unknown") rather than guess.
"""

# Preset local_dir under datasets/ that these adapters apply to (see the site-tags preset).
LOCAL_DIR = "site_tags"

GENERAL, ARTIST, COPYRIGHT, CHARACTER, META, SPECIES = 0, 1, 3, 4, 5, 6


def _rec(r, name, post_count, category, is_deprecated=0, words=None):
    """Return the original record with canonical fields overlaid (keeps extras as metadata)."""
    out = dict(r)
    out["name"] = name
    out["post_count"] = post_count
    out["category"] = category
    out["is_deprecated"] = 1 if is_deprecated else 0
    if words is not None:
        out["words"] = words
    return out


# --- Danbooru-native: danbooru / safebooru / atfbooru --------------------------------
# category is already 0/1/3/4/5; name/post_count/is_deprecated/words are canonical.
def _danbooru(r):
    return _rec(r, r.get("name"), r.get("post_count"), r.get("category"),
                r.get("is_deprecated"), r.get("words"))


# --- e621 ----------------------------------------------------------------------------
# e621 codes: 0 general, 1 artist, 3 copyright, 4 character, 5 species, 7 meta
# (2 unused, 6 invalid, 8 lore -> dropped to Unknown).
_E621_CAT = {0: GENERAL, 1: ARTIST, 3: COPYRIGHT, 4: CHARACTER, 5: SPECIES, 7: META}


def _e621(r):
    return _rec(r, r.get("name"), r.get("post_count"), _E621_CAT.get(r.get("category")))


# --- Gelbooru (string type): gelbooru.com --------------------------------------------
_GELBOORU_STR = {"general": GENERAL, "artist": ARTIST, "copyright": COPYRIGHT,
                 "character": CHARACTER, "metadata": META, "meta": META}


def _gelbooru_str(r):
    t = str(r.get("type", "")).lower()
    deprecated = t == "deprecated"
    category = GENERAL if deprecated else _GELBOORU_STR.get(t)
    return _rec(r, r.get("name"), r.get("count"), category, is_deprecated=deprecated)


# --- Gelbooru (numeric type): rule34 / hypnohub / xbooru -----------------------------
# Numeric codes already match the Danbooru scheme (0/1/3/4/5).
def _gelbooru_num(r):
    return _rec(r, r.get("name"), r.get("count"), r.get("type"))


# --- Moebooru: konachan.com / konachan.net / yande.re --------------------------------
# 0 general, 1 artist, 3 copyright, 4 character (5 circle / 6 faults -> Unknown).
_MOEBOORU_CAT = {0: GENERAL, 1: ARTIST, 3: COPYRIGHT, 4: CHARACTER}


def _moebooru(r):
    return _rec(r, r.get("name"), r.get("count"), _MOEBOORU_CAT.get(r.get("type")))


def _lolibooru(r):  # Moebooru variant: tag_type + post_count field names.
    return _rec(r, r.get("name"), r.get("post_count"), _MOEBOORU_CAT.get(r.get("tag_type")))


# --- Sankaku: chan.sankakucomplex.com ------------------------------------------------
# 0 general, 1 artist, 3 copyright, 4 character, 5/8/9 meta-ish (2 studio -> Unknown).
_SANKAKU_CAT = {0: GENERAL, 1: ARTIST, 3: COPYRIGHT, 4: CHARACTER, 5: META, 8: META, 9: META}


def _sankaku(r):
    words = [w for w in (r.get("trans_en"), r.get("trans_ja")) if w]
    return _rec(r, r.get("name"), r.get("post_count"), _SANKAKU_CAT.get(r.get("type")),
                words=words or None)


# --- Zerochan: zerochan.net ----------------------------------------------------------
_ZEROCHAN_CAT = {
    "mangaka": ARTIST, "studio": ARTIST, "character": CHARACTER, "vtuber": CHARACTER,
    "series": COPYRIGHT, "game": COPYRIGHT, "movie": COPYRIGHT, "group": COPYRIGHT,
    "theme": GENERAL, "meta": META, "source": META, "artbook": META,
}


def _zerochan(r):
    return _rec(r, r.get("tag"), r.get("total"),
                _ZEROCHAN_CAT.get(str(r.get("type", "")).lower()))


# --- Best-effort / uncertain category ------------------------------------------------
_WALLHAVEN_CAT = {
    "characters": CHARACTER, "fictional characters": CHARACTER, "people": GENERAL,
    "anime & manga": COPYRIGHT, "series": COPYRIGHT, "movies": COPYRIGHT,
    "television": COPYRIGHT, "games": COPYRIGHT, "literature": COPYRIGHT, "artists": ARTIST,
}


def _wallhaven(r):
    return _rec(r, r.get("name"), r.get("posts"),
                _WALLHAVEN_CAT.get(str(r.get("category_name", "")).lower()))


def _pixiv(r):
    if r.get("is_character") or r.get("is_person"):
        category = CHARACTER
    elif any(r.get(k) for k in ("is_anime", "is_manga", "is_novel", "is_game", "is_doujin")):
        category = COPYRIGHT
    elif r.get("is_general"):
        category = GENERAL
    else:
        category = None
    return _rec(r, r.get("name"), r.get("posts"), category)


def _anime_pictures(r):  # anime-pictures' numeric types don't map cleanly; keep name/count.
    return _rec(r, r.get("tag"), r.get("num"), None)


def _generic(r):  # Fallback for an unrecognized future site directory.
    name = r.get("name") or r.get("tag")
    post_count = r.get("post_count")
    if post_count is None:
        post_count = r.get("count", r.get("posts", r.get("total")))
    category = r.get("category")
    if not isinstance(category, int):
        category = None
    return _rec(r, name, post_count, category)


_ADAPTERS = {
    "danbooru.donmai.us": _danbooru,
    "safebooru.donmai.us": _danbooru,
    "booru.allthefallen.moe": _danbooru,
    "e621.net": _e621,
    "gelbooru.com": _gelbooru_str,
    "rule34.xxx": _gelbooru_num,
    "hypnohub.net": _gelbooru_num,
    "xbooru.com": _gelbooru_num,
    "konachan.com": _moebooru,
    "konachan.net": _moebooru,
    "yande.re": _moebooru,
    "lolibooru.moe": _lolibooru,
    "chan.sankakucomplex.com": _sankaku,
    "zerochan.net": _zerochan,
    "wallhaven.cc": _wallhaven,
    "en.pixiv.net": _pixiv,
    "pixiv.net": _pixiv,
    "anime-pictures.net": _anime_pictures,
}


def adapter_for_dir(rel_dir):
    """Return the record adapter for a 'site_tags/<site>' directory, else None.

    rel_dir is a datasets-relative, forward-slash directory path. Unrecognized sites that
    still live under site_tags/ get a generic best-effort adapter so they import too.
    """
    parts = rel_dir.split("/")
    if len(parts) != 2 or parts[0] != LOCAL_DIR:
        return None
    return _ADAPTERS.get(parts[1], _generic)
