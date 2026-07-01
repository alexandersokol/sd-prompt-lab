import csv
import json
import os
import re
import sqlite3
import time
from urllib.parse import urlparse

import requests

import scripts.prompt_lab.sd_promt_lab_env as env

# Recursive tag dataset cache.
#
# Sources: every *.jsonl / *.json / *.csv file at any depth under datasets/ (except .cache).
# When several share the same folder + base name, the richest format wins (jsonl > json > csv).
# All sources are merged into a single, de-duplicated SQLite cache keyed by tag name.
# The cache is rebuilt only when the set of sources (or their mtime/size) changes.

_CACHE_DIR_NAME = ".cache"
_CACHE_DB_NAME = "tags.db"
_IMPORT_BATCH = 5000

# Supported tag file extensions, in descending preference for same-basename shadowing.
_SOURCE_EXT_ORDER = (".jsonl", ".json", ".csv")
_SOURCE_EXTS = set(_SOURCE_EXT_ORDER)


def get_datasets_dir():
    return os.path.join(env.script_dir, "datasets")


def get_cache_dir():
    return os.path.join(get_datasets_dir(), _CACHE_DIR_NAME)


def get_tags_db_path():
    cache_dir = get_cache_dir()
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, _CACHE_DB_NAME)


def connect():
    return sqlite3.connect(get_tags_db_path())


def discover_sources():
    """Recursively find tag files under datasets/. Returns a list of source dicts.

    Each source: {source (posix relpath), abspath, format ('jsonl'|'json'|'csv'), mtime, size}.
    Within a single folder, same-basename files collapse to the richest format (jsonl > json > csv).
    Missing datasets dir -> [].
    """
    datasets_dir = get_datasets_dir()
    if not os.path.isdir(datasets_dir):
        return []

    sources = []
    for root, dirs, files in os.walk(datasets_dir):
        # Never descend into the cache directory.
        dirs[:] = [d for d in dirs if d != _CACHE_DIR_NAME]

        # Group candidate files by base name so richer formats shadow weaker ones in the same folder.
        by_base = {}
        for name in files:
            base, ext = os.path.splitext(name)
            ext = ext.lower()
            if ext not in _SOURCE_EXTS:
                continue
            by_base.setdefault(base, {})[ext] = name

        for base, variants in by_base.items():
            chosen = fmt = None
            for pref in _SOURCE_EXT_ORDER:
                if pref in variants:
                    chosen, fmt = variants[pref], pref.lstrip(".")
                    break

            abspath = os.path.join(root, chosen)
            try:
                stat = os.stat(abspath)
            except OSError:
                continue
            rel = os.path.relpath(abspath, datasets_dir).replace(os.sep, "/")
            sources.append({
                "source": rel,
                "abspath": abspath,
                "format": fmt,
                "mtime": stat.st_mtime,
                "size": stat.st_size,
            })

    sources.sort(key=lambda s: s["source"])
    return sources


def _signature(sources):
    return json.dumps(
        [[s["source"], round(s["mtime"], 3), s["size"]] for s in sources],
        sort_keys=True,
    )


def _create_schema(conn):
    c = conn.cursor()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS tags (
            name TEXT PRIMARY KEY COLLATE NOCASE,
            post_count INTEGER DEFAULT 0,
            category INTEGER,
            is_deprecated INTEGER DEFAULT 0,
            metadata TEXT,
            primary_source TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tags_post ON tags(post_count DESC);
        CREATE INDEX IF NOT EXISTS idx_tags_cat ON tags(category);
        CREATE TABLE IF NOT EXISTS tag_sources (
            name TEXT NOT NULL COLLATE NOCASE,
            source TEXT NOT NULL,
            PRIMARY KEY (name, source)
        );
        CREATE INDEX IF NOT EXISTS idx_tag_sources_source ON tag_sources(source);
        CREATE TABLE IF NOT EXISTS cache_meta (k TEXT PRIMARY KEY, v TEXT);
        """
    )
    conn.commit()


def _drop_schema(conn):
    c = conn.cursor()
    c.executescript(
        """
        DROP TABLE IF EXISTS tags;
        DROP TABLE IF EXISTS tag_sources;
        DROP TABLE IF EXISTS cache_meta;
        """
    )
    conn.commit()


def _iter_records(source):
    """Yield original tag records (dicts) from a source file, skipping malformed entries."""
    path, fmt = source["abspath"], source["format"]
    if fmt == "jsonl":
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(record, dict):
                    yield record
    elif fmt == "csv":
        yield from _iter_csv_records(path)
    else:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (ValueError, TypeError, OSError):
            return
        if isinstance(data, dict):
            data = data.get("tags") if isinstance(data.get("tags"), list) else [data]
        if isinstance(data, list):
            for record in data:
                if isinstance(record, dict):
                    yield record


# Maps assorted CSV header names to our canonical record fields.
_CSV_FIELD_ALIASES = {
    "name": "name", "tag": "name", "tag_name": "name", "tagname": "name",
    "post_count": "post_count", "postcount": "post_count", "count": "post_count",
    "posts": "post_count", "post count": "post_count",
    "category": "category", "cat": "category", "type": "category",
    "tag_category": "category",
    "is_deprecated": "is_deprecated", "deprecated": "is_deprecated",
    "words": "words", "aliases": "words", "alias": "words",
}


def _split_aliases(value):
    return [a.strip() for a in (value or "").split(",") if a.strip()]


def _csv_has_header(sample):
    try:
        return csv.Sniffer().has_header(sample)
    except csv.Error:
        first = sample.splitlines()[0] if sample.strip() else ""
        cells = next(csv.reader([first]), [])
        # Heuristic: data rows carry a numeric count/category beyond the name column.
        return not any(c.strip().isdigit() for c in cells[1:])


def _csv_row_to_record(row, header):
    """Convert one CSV row into a canonical record dict, or None if it has no name."""
    if header:
        record = {}
        for i, col in enumerate(header):
            value = row[i].strip() if i < len(row) else ""
            canonical = _CSV_FIELD_ALIASES.get(col)
            if canonical == "words":
                record["words"] = _split_aliases(value)
            elif canonical:
                record[canonical] = value
            elif col:
                record[col] = value
        return record if record.get("name") else None

    # Headerless: the widely used tag-autocomplete order name,category,post_count,aliases.
    if not row or not row[0].strip():
        return None
    record = {"name": row[0].strip()}
    if len(row) > 1 and row[1].strip():
        record["category"] = row[1].strip()
    if len(row) > 2 and row[2].strip():
        record["post_count"] = row[2].strip()
    if len(row) > 3 and row[3].strip():
        record["words"] = _split_aliases(row[3])
    return record


def _iter_csv_records(path):
    try:
        f = open(path, "r", encoding="utf-8", newline="")
    except OSError:
        return
    with f:
        sample = f.read(8192)
        f.seek(0)
        has_header = _csv_has_header(sample) if sample.strip() else False
        reader = csv.reader(f)
        header = None
        if has_header:
            header = [h.strip().lower() for h in next(reader, [])]
        for row in reader:
            if not row:
                continue
            record = _csv_row_to_record(row, header)
            if record:
                yield record


def _coerce_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (ValueError, TypeError):
        return default


def _normalize(record):
    """Return (tag_row, source_name) for a record, or None if it has no usable name.

    tag_row: (name, post_count, category, is_deprecated, metadata_json)
    """
    name = record.get("name")
    if not isinstance(name, str):
        return None
    name = name.strip()
    if not name:
        return None

    post_count = _coerce_int(record.get("post_count"), 0)
    category = record.get("category")
    category = _coerce_int(category, None) if category is not None else None
    is_deprecated = 1 if record.get("is_deprecated") else 0
    metadata_json = json.dumps(record, ensure_ascii=False)
    return name, post_count, category, is_deprecated, metadata_json


_UPSERT_TAG = """
    INSERT INTO tags (name, post_count, category, is_deprecated, metadata, primary_source)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
        post_count = excluded.post_count,
        category = excluded.category,
        is_deprecated = excluded.is_deprecated,
        metadata = excluded.metadata,
        primary_source = excluded.primary_source
    WHERE excluded.post_count > tags.post_count
"""

_INSERT_SOURCE = "INSERT OR IGNORE INTO tag_sources (name, source) VALUES (?, ?)"


def _rebuild(conn, sources):
    _drop_schema(conn)
    _create_schema(conn)
    c = conn.cursor()

    for source in sources:
        source_name = source["source"]
        tag_batch = []
        src_batch = []
        for record in _iter_records(source):
            normalized = _normalize(record)
            if normalized is None:
                continue
            name, post_count, category, is_deprecated, metadata_json = normalized
            tag_batch.append((name, post_count, category, is_deprecated, metadata_json, source_name))
            src_batch.append((name, source_name))

            if len(tag_batch) >= _IMPORT_BATCH:
                c.executemany(_UPSERT_TAG, tag_batch)
                c.executemany(_INSERT_SOURCE, src_batch)
                tag_batch.clear()
                src_batch.clear()

        if tag_batch:
            c.executemany(_UPSERT_TAG, tag_batch)
            c.executemany(_INSERT_SOURCE, src_batch)

    c.execute(
        "INSERT OR REPLACE INTO cache_meta (k, v) VALUES ('signature', ?)",
        (_signature(sources),),
    )
    c.execute(
        "INSERT OR REPLACE INTO cache_meta (k, v) VALUES ('imported_at', ?)",
        (str(time.time()),),
    )
    conn.commit()


def _stored_signature(conn):
    try:
        c = conn.cursor()
        c.execute("SELECT v FROM cache_meta WHERE k = 'signature'")
        row = c.fetchone()
        return row[0] if row else None
    except sqlite3.OperationalError:
        return None


def ensure_cache():
    """Idempotently make the cache match the current sources on disk. Rebuilds only on change."""
    sources = discover_sources()
    with connect() as conn:
        _create_schema(conn)
        if _stored_signature(conn) == _signature(sources):
            return
        _rebuild(conn, sources)


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

_SORTS = {
    "post_count": "t.post_count DESC, t.name ASC",
    "name": "t.name ASC",
    "post_count_asc": "t.post_count ASC, t.name ASC",
}


def _build_filters(q, category, source, include_deprecated):
    joins = ""
    where = []
    params = []

    if source:
        joins = " JOIN tag_sources s ON s.name = t.name AND s.source = ?"
        params.append(source)
    if q:
        where.append("t.name LIKE ?")
        params.append(f"%{q}%")
    if category is not None:
        where.append("t.category = ?")
        params.append(category)
    if not include_deprecated:
        where.append("t.is_deprecated = 0")

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return joins, clause, params


def query_tags(q=None, category=None, source=None, include_deprecated=False,
               sort="post_count", limit=60, offset=0):
    joins, clause, params = _build_filters(q, category, source, include_deprecated)
    order = _SORTS.get(sort, _SORTS["post_count"])

    sql = f"""
        SELECT t.name, t.post_count, t.category, t.is_deprecated,
               (SELECT COUNT(*) FROM tag_sources ts WHERE ts.name = t.name) AS source_count
        FROM tags t{joins}{clause}
        ORDER BY {order}
        LIMIT ? OFFSET ?
    """
    with connect() as conn:
        c = conn.cursor()
        c.execute(sql, params + [limit, offset])
        return [
            {
                "name": row[0],
                "post_count": row[1],
                "category": row[2],
                "is_deprecated": row[3],
                "source_count": row[4],
            }
            for row in c.fetchall()
        ]


def count_tags(q=None, category=None, source=None, include_deprecated=False):
    joins, clause, params = _build_filters(q, category, source, include_deprecated)
    sql = f"SELECT COUNT(*) FROM tags t{joins}{clause}"
    with connect() as conn:
        c = conn.cursor()
        c.execute(sql, params)
        return c.fetchone()[0]


def category_counts(source=None, include_deprecated=False):
    joins, clause, params = _build_filters(None, None, source, include_deprecated)
    sql = f"""
        SELECT t.category, COUNT(*)
        FROM tags t{joins}{clause}
        GROUP BY t.category
        ORDER BY COUNT(*) DESC
    """
    with connect() as conn:
        c = conn.cursor()
        c.execute(sql, params)
        return [{"category": row[0], "count": row[1]} for row in c.fetchall()]


def list_sources():
    """Distinct sources present in the cache with their tag counts."""
    with connect() as conn:
        c = conn.cursor()
        try:
            c.execute(
                "SELECT source, COUNT(*) FROM tag_sources GROUP BY source ORDER BY source"
            )
        except sqlite3.OperationalError:
            return []
        return [{"source": row[0], "count": row[1]} for row in c.fetchall()]


def get_tag_detail(name):
    """Full metadata (parsed original record) + all sources for a single tag."""
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT name, metadata FROM tags WHERE name = ?", (name,))
        row = c.fetchone()
        if not row:
            return None
        try:
            metadata = json.loads(row[1]) if row[1] else {}
        except (ValueError, TypeError):
            metadata = {}
        c.execute(
            "SELECT source FROM tag_sources WHERE name = ? ORDER BY source", (row[0],)
        )
        sources = [r[0] for r in c.fetchall()]
        return {"name": row[0], "metadata": metadata, "sources": sources}


# ---------------------------------------------------------------------------
# Hugging Face dataset download
# ---------------------------------------------------------------------------

_HF_HOSTS = {"huggingface.co", "www.huggingface.co"}
# .json files that are dataset metadata rather than tag data.
_METADATA_JSON = {"dataset_infos.json", "dataset_info.json", "config.json"}
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")
_DOWNLOAD_CHUNK = 1 << 20  # 1 MiB


def _parse_hf_dataset(url):
    """Extract (owner, repo) from a Hugging Face dataset URL or 'owner/repo' string."""
    url = (url or "").strip()
    if not url:
        raise ValueError("Please provide a dataset URL")

    if "://" not in url:
        parts = [p for p in url.strip("/").split("/") if p]
        if len(parts) == 2:
            return parts[0], parts[1]
        raise ValueError("Enter a huggingface.co dataset URL or 'owner/name'")

    parsed = urlparse(url)
    if parsed.hostname not in _HF_HOSTS:
        raise ValueError("URL must point to huggingface.co")
    segments = [s for s in parsed.path.split("/") if s]
    if len(segments) >= 3 and segments[0] == "datasets":
        return segments[1], segments[2]
    raise ValueError("Not a Hugging Face dataset URL (expected /datasets/owner/name)")


def _pick_remote_file(siblings):
    """Choose the tag file to download: prefer .jsonl, then .json, then .csv (tags.* first)."""
    for ext in ("jsonl", "json", "csv"):
        candidates = [
            f for f in siblings
            if f.lower().endswith(f".{ext}")
            and os.path.basename(f).lower() not in _METADATA_JSON
        ]
        if candidates:
            preferred = [f for f in candidates if os.path.basename(f).lower() == f"tags.{ext}"]
            return (preferred or candidates)[0], ext

    return None, None


def download_hf_dataset(url):
    """Download a HF dataset's tag file into datasets/<name>/tags.jsonl|json and refresh the cache.

    Returns {name, source, format}. Raises ValueError for bad input and
    requests.RequestException for network failures.
    """
    owner, repo = _parse_hf_dataset(url)
    safe_name = _SAFE_NAME.sub("-", repo).strip("-.") or "dataset"

    # Discover the actual files in the dataset repo.
    api_url = f"https://huggingface.co/api/datasets/{owner}/{repo}"
    resp = requests.get(api_url, timeout=20)
    if resp.status_code in (401, 403, 404):
        # HF returns 401 for missing or private/gated datasets.
        raise ValueError(f"Dataset '{owner}/{repo}' was not found or is private/gated")
    resp.raise_for_status()
    siblings = [
        s.get("rfilename") for s in resp.json().get("siblings", []) if s.get("rfilename")
    ]
    remote_file, fmt = _pick_remote_file(siblings)
    if not remote_file:
        raise ValueError("No .jsonl or .json tag file found in this dataset")

    datasets_dir = os.path.abspath(get_datasets_dir())
    dest_dir = os.path.abspath(os.path.join(datasets_dir, safe_name))
    if os.path.commonpath([datasets_dir, dest_dir]) != datasets_dir:
        raise ValueError("Invalid dataset name")
    os.makedirs(dest_dir, exist_ok=True)

    # Remove any prior tag file so the freshly downloaded one is authoritative
    # (a stale tags.jsonl would otherwise shadow a newly downloaded tags.json/.csv).
    for stale in ("tags.jsonl", "tags.json", "tags.csv"):
        stale_path = os.path.join(dest_dir, stale)
        if os.path.exists(stale_path):
            os.remove(stale_path)

    dest = os.path.join(dest_dir, f"tags.{fmt}")
    file_url = f"https://huggingface.co/datasets/{owner}/{repo}/resolve/main/{remote_file}"
    tmp = dest + ".part"
    try:
        with requests.get(file_url, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=_DOWNLOAD_CHUNK):
                    if chunk:
                        f.write(chunk)
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    # Rebuild the cache so the new dataset is immediately searchable.
    ensure_cache()

    source_rel = os.path.relpath(dest, datasets_dir).replace(os.sep, "/")
    return {"name": safe_name, "source": source_rel, "format": fmt}
