import csv
import json
import os
import sqlite3
import threading
import time

import requests

import scripts.prompt_lab.sd_promt_lab_env as env
import scripts.prompt_lab.sd_prompt_lab_tag_presets as presets_registry
import scripts.prompt_lab.sd_prompt_lab_site_tags as site_tags

# Serializes cache rebuilds so a background download's import can't race concurrent readers.
_rebuild_lock = threading.Lock()

# Recursive tag dataset cache.
#
# Sources: every *.jsonl / *.json / *.csv file at any depth under datasets/ (except .cache).
# When several share the same folder + base name, the richest format wins (jsonl > json > csv).
# All sources are merged into a single, de-duplicated SQLite cache keyed by tag name.
# The cache is rebuilt only when the set of sources (or their mtime/size) changes.

_CACHE_DIR_NAME = ".cache"
_CACHE_DB_NAME = "tags.db"
_IMPORT_BATCH = 5000

# Per-dataset manifest written on preset download (records format + how to interpret it).
_MANIFEST_NAME = ".spl-dataset.json"

# Supported tag file extensions, in descending preference for same-basename shadowing.
_SOURCE_EXT_ORDER = (".jsonl", ".json", ".csv", ".sqlite", ".db")
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
    conn = sqlite3.connect(get_tags_db_path())
    try:
        # WAL lets readers keep serving the previous cache while a rebuild is in progress;
        # busy_timeout absorbs brief lock contention rather than erroring out.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
    except sqlite3.Error:
        pass
    return conn


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

        # An optional sibling manifest records how the dataset should be interpreted.
        manifest, manifest_mtime = _read_manifest(root)
        # Multi-source site_tags dirs are normalized per-site by a dedicated adapter.
        rel_dir = os.path.relpath(root, datasets_dir).replace(os.sep, "/")
        transform = site_tags.adapter_for_dir(rel_dir)
        # Download-only datasets (import: false) are skipped until a transform can read them.
        if manifest.get("import") is False and transform is None:
            continue

        # Group candidate files by base name so richer formats shadow weaker ones in the same folder.
        by_base = {}
        for name in files:
            if name == _MANIFEST_NAME:
                continue  # the dataset manifest is metadata, not a tag source
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
            if fmt == "db":
                fmt = "sqlite"

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
                "mapping": manifest.get("mapping"),
                "sqlite_query": manifest.get("sqlite_query"),
                "transform": transform,
                "manifest_mtime": manifest_mtime,
            })

    sources.sort(key=lambda s: s["source"])
    return sources


def _read_manifest(directory):
    """Return (manifest_dict, manifest_mtime) from a directory's .spl-dataset.json, else ({}, 0)."""
    path = os.path.join(directory, _MANIFEST_NAME)
    try:
        stat = os.stat(path)
    except OSError:
        return {}, 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            data = {}
    except (ValueError, TypeError, OSError):
        data = {}
    return data, stat.st_mtime


def _signature(sources):
    return json.dumps(
        [
            [s["source"], round(s["mtime"], 3), s["size"], round(s.get("manifest_mtime", 0), 3)]
            for s in sources
        ],
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
    elif fmt in ("sqlite", "db"):
        yield from _iter_sqlite_records(source)
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


def _canonicalize_record(record):
    """Rename known column aliases to canonical fields (name/post_count/category/words)."""
    out = {}
    for key, value in record.items():
        canonical = _CSV_FIELD_ALIASES.get(str(key).lower())
        if canonical == "words":
            out["words"] = _split_aliases(value) if isinstance(value, str) else value
        elif canonical:
            out[canonical] = value
        else:
            out[key] = value
    return out


def _auto_sqlite_query(cur):
    """Best-effort query for a flat tag table when no explicit query is configured."""
    cur.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    tables = [r[0] for r in cur.fetchall()]
    # Never ingest our own cache database.
    if "cache_meta" in tables and "tag_sources" in tables:
        return None

    def columns(table):
        cur.execute(f'PRAGMA table_info("{table}")')
        return [r[1].lower() for r in cur.fetchall()]

    candidate = None
    for table in tables:
        if table.startswith("sqlite_"):
            continue
        cols = columns(table)
        if any(alias in cols for alias in ("name", "tag", "tag_name", "tagname")):
            candidate = table
            if table.lower() == "tags":
                break
    return f'SELECT * FROM "{candidate}"' if candidate else None


def _iter_sqlite_records(source):
    """Yield tag records from a SQLite source via its preset query, or a flat auto-detect."""
    path = source["abspath"]
    query = source.get("sqlite_query")
    # Read-only + immutable so we never touch the file and can read WAL-mode DBs without sidecars.
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    except sqlite3.Error as e:
        print(f"[sd-prompt-lab] could not open sqlite source {source['source']}: {e}")
        return
    try:
        cur = con.cursor()
        if not query:
            try:
                query = _auto_sqlite_query(cur)
            except sqlite3.Error:
                query = None
            if not query:
                return
        try:
            cur.execute(query)
        except sqlite3.Error as e:
            print(f"[sd-prompt-lab] sqlite query failed for {source['source']}: {e}")
            return
        cols = [d[0] for d in cur.description]
        while True:
            rows = cur.fetchmany(_IMPORT_BATCH)
            if not rows:
                break
            for row in rows:
                yield _canonicalize_record(dict(zip(cols, row)))
    finally:
        con.close()


def _coerce_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (ValueError, TypeError):
        return default


def _apply_mapping(record, mapping):
    """Copy source keys onto canonical fields per a preset's mapping. No-op when mapping is falsy.

    mapping is {canonical_field: source_key}; original keys are kept so metadata stays intact.
    """
    if not mapping:
        return record
    result = dict(record)
    for canonical, source_key in mapping.items():
        if source_key in record and record[source_key] is not None:
            result[canonical] = record[source_key]
    return result


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


def _rebuild(conn, sources, progress_cb=None):
    _drop_schema(conn)
    _create_schema(conn)
    c = conn.cursor()

    processed = 0
    for source in sources:
        source_name = source["source"]
        mapping = source.get("mapping")
        transform = source.get("transform")
        tag_batch = []
        src_batch = []
        for record in _iter_records(source):
            if transform is not None:
                record = transform(record)
                if record is None:
                    continue
            record = _apply_mapping(record, mapping)
            normalized = _normalize(record)
            if normalized is None:
                continue
            name, post_count, category, is_deprecated, metadata_json = normalized
            tag_batch.append((name, post_count, category, is_deprecated, metadata_json, source_name))
            src_batch.append((name, source_name))

            if len(tag_batch) >= _IMPORT_BATCH:
                c.executemany(_UPSERT_TAG, tag_batch)
                c.executemany(_INSERT_SOURCE, src_batch)
                processed += len(tag_batch)
                tag_batch.clear()
                src_batch.clear()
                if progress_cb:
                    progress_cb(processed)

        if tag_batch:
            c.executemany(_UPSERT_TAG, tag_batch)
            c.executemany(_INSERT_SOURCE, src_batch)
            processed += len(tag_batch)
            if progress_cb:
                progress_cb(processed)

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


def cache_status():
    """Report whether the cache is stale vs. on-disk sources, without triggering a rebuild.

    Lets the UI kick off a big rebuild with progress instead of blocking on a lazy import.
    """
    sources = discover_sources()
    sig = _signature(sources)
    with connect() as conn:
        _create_schema(conn)
        stored = _stored_signature(conn)
    return {"needs_rebuild": stored != sig, "source_count": len(sources)}


def ensure_cache(progress_cb=None):
    """Idempotently make the cache match the current sources on disk. Rebuilds only on change."""
    sources = discover_sources()
    sig = _signature(sources)
    with connect() as conn:
        _create_schema(conn)
        if _stored_signature(conn) == sig:
            return

    # Only one rebuild at a time; concurrent callers keep serving the current cache.
    if not _rebuild_lock.acquire(blocking=False):
        return
    try:
        with connect() as conn:
            if _stored_signature(conn) == sig:
                return
            _rebuild(conn, sources, progress_cb=progress_cb)
    finally:
        _rebuild_lock.release()


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
# Preset dataset download
# ---------------------------------------------------------------------------

_DOWNLOAD_CHUNK = 1 << 20  # 1 MiB
# Local tag files a re-download must clear so a new format can't be shadowed by an old one.
_STALE_TAG_FILES = ("tags.jsonl", "tags.json", "tags.csv", "tags.sqlite", "tags.db")
# Hugging Face datasets API (used to enumerate a multi-source repo's directories).
_HF_DATASETS_API = "https://huggingface.co/api/datasets"


def _write_manifest(directory, manifest):
    """Write a dataset's .spl-dataset.json describing how it was produced / interpreted."""
    with open(os.path.join(directory, _MANIFEST_NAME), "w", encoding="utf-8") as f:
        json.dump(manifest, f)


def _download_file(file_url, dest, progress_cb=None):
    """Stream a URL to dest atomically via a .part temp file. Raises requests exceptions.

    progress_cb(downloaded_bytes, total_bytes) is called as bytes arrive (total 0 if unknown).
    """
    tmp = dest + ".part"
    try:
        with requests.get(file_url, stream=True, timeout=60) as r:
            r.raise_for_status()
            total = int(r.headers.get("Content-Length") or 0)
            downloaded = 0
            if progress_cb:
                progress_cb(downloaded, total)
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=_DOWNLOAD_CHUNK):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if progress_cb:
                            progress_cb(downloaded, total)
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def download_preset(preset, progress=None):
    """Download a preset's tag file into datasets/<local_dir>/tags.<fmt> and refresh the cache.

    Tries preset['files'] in order, using the first that resolves. Returns
    {id, name, source, format}. Raises ValueError for bad config / no available file and
    requests.RequestException for network failures.

    If `progress` is a dict, it is updated live with phase/downloaded/total/imported.
    """
    if preset.get("kind") == "multi_source":
        return _download_multi_source(preset, progress=progress)

    def upd(**kw):
        if progress is not None:
            progress.update(kw)

    repo = preset["repo"]
    datasets_dir = os.path.abspath(get_datasets_dir())
    dest_dir = os.path.abspath(os.path.join(datasets_dir, preset["local_dir"]))
    if os.path.commonpath([datasets_dir, dest_dir]) != datasets_dir:
        raise ValueError("Invalid preset local_dir")
    os.makedirs(dest_dir, exist_ok=True)

    # Replace semantics: drop any prior tag file before writing the fresh one.
    for stale in _STALE_TAG_FILES:
        stale_path = os.path.join(dest_dir, stale)
        if os.path.exists(stale_path):
            os.remove(stale_path)

    upd(phase="downloading", downloaded=0, total=0)
    chosen = None
    last_status = None
    for candidate in preset.get("files", []):
        remote, fmt = candidate["remote"], candidate["format"]
        file_url = f"https://huggingface.co/datasets/{repo}/resolve/main/{remote}"
        dest = os.path.join(dest_dir, f"tags.{fmt}")
        try:
            _download_file(
                file_url, dest,
                progress_cb=lambda d, tot: upd(downloaded=d, total=tot),
            )
            chosen = (dest, fmt)
            break
        except requests.HTTPError as e:
            last_status = e.response.status_code if e.response is not None else None
            if last_status in (401, 403, 404):
                continue  # try the next candidate file
            raise

    if not chosen:
        detail = f" (last status {last_status})" if last_status else ""
        raise ValueError(f"None of the expected files were found in '{repo}'{detail}")

    dest, fmt = chosen

    # Persist how this dataset was produced and how to interpret it.
    _write_manifest(dest_dir, {
        "preset_id": preset["id"],
        "format": fmt,
        "remote": os.path.basename(dest),
        "mapping": preset.get("mapping"),
        "sqlite_query": preset.get("sqlite_query"),
        "downloaded_at": time.time(),
    })

    # Rebuild the cache so the new dataset is immediately searchable.
    upd(phase="importing", imported=0)
    ensure_cache(progress_cb=lambda n: upd(imported=n))

    source_rel = os.path.relpath(dest, datasets_dir).replace(os.sep, "/")
    return {
        "id": preset["id"],
        "name": preset.get("name", preset["id"]),
        "source": source_rel,
        "format": fmt,
    }


def _hf_list_dirs(repo):
    """Return the sorted top-level directory names of a Hugging Face dataset repo."""
    url = f"{_HF_DATASETS_API}/{repo}/tree/main"
    with requests.get(url, timeout=60) as r:
        r.raise_for_status()
        entries = r.json()
    dirs = [e["path"] for e in entries if isinstance(e, dict) and e.get("type") == "directory"]
    return sorted(dirs)


def _download_multi_source(preset, progress=None):
    """Download every <source>/tags.<fmt> in a multi-source repo as-is (no import yet).

    Enumerates the repo's top-level directories and, for each, downloads the first
    matching candidate file into datasets/<local_dir>/<source>/tags.<fmt> with an
    import-disabled manifest. Returns {id, name, source, format, sources}.
    """
    def upd(**kw):
        if progress is not None:
            progress.update(kw)

    repo = preset["repo"]
    datasets_dir = os.path.abspath(get_datasets_dir())
    dest_root = os.path.abspath(os.path.join(datasets_dir, preset["local_dir"]))
    if os.path.commonpath([datasets_dir, dest_root]) != datasets_dir:
        raise ValueError("Invalid preset local_dir")
    os.makedirs(dest_root, exist_ok=True)

    upd(phase="downloading", downloaded=0, total=0, files_done=0, files_total=0, label="")
    dirs = _hf_list_dirs(repo)
    upd(files_total=len(dirs))

    downloaded_sources = []
    for i, sub in enumerate(dirs):
        source_name = sub.split("/")[-1]
        upd(label=source_name, files_done=i, downloaded=0, total=0)

        dest_dir = os.path.abspath(os.path.join(dest_root, source_name))
        if os.path.commonpath([dest_root, dest_dir]) != dest_root:
            continue  # guard against traversal via an unexpected directory name

        chosen = None
        for candidate in preset.get("files", []):
            remote, fmt = candidate["remote"], candidate["format"]
            file_url = f"https://huggingface.co/datasets/{repo}/resolve/main/{sub}/{remote}"
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, f"tags.{fmt}")
            try:
                _download_file(
                    file_url, dest,
                    progress_cb=lambda d, tot: upd(downloaded=d, total=tot),
                )
                chosen = (dest, fmt, remote)
                break
            except requests.HTTPError as e:
                status = e.response.status_code if e.response is not None else None
                if status in (401, 403, 404):
                    continue  # this source lacks that format; try the next candidate
                raise

        if not chosen:
            continue  # no candidate file present for this source; skip it

        dest, fmt, remote = chosen
        # Replace semantics: drop any other tag format left in this source dir.
        for stale in _STALE_TAG_FILES:
            stale_path = os.path.join(dest_dir, stale)
            if stale_path != dest and os.path.exists(stale_path):
                os.remove(stale_path)

        _write_manifest(dest_dir, {
            "preset_id": preset["id"],
            "format": fmt,
            "remote": remote,
            "mapping": preset.get("mapping"),
            "downloaded_at": time.time(),
        })
        downloaded_sources.append(source_name)

    upd(files_done=len(dirs), label="")

    if not downloaded_sources:
        raise ValueError(f"No tag files were found in '{repo}'")

    # Per-site adapters normalize these on import; rebuild so they're immediately searchable.
    upd(phase="importing", imported=0)
    ensure_cache(progress_cb=lambda n: upd(imported=n))

    return {
        "id": preset["id"],
        "name": preset.get("name", preset["id"]),
        "source": "",  # merged across many sites; nothing single to focus in the browser
        "format": "multi",
        "sources": downloaded_sources,
    }


def _count_downloaded_sources(root):
    """Count immediate subdirectories of `root` that hold a downloaded tag file."""
    if not os.path.isdir(root):
        return 0
    count = 0
    for name in os.listdir(root):
        sub = os.path.join(root, name)
        if not os.path.isdir(sub):
            continue
        if any(os.path.exists(os.path.join(sub, "tags" + ext)) for ext in _SOURCE_EXT_ORDER):
            count += 1
    return count


def presets_status():
    """Return each registered preset with whether it is downloaded and its cached tag count."""
    ensure_cache()
    sources = list_sources()
    datasets_dir = get_datasets_dir()
    result = []
    for preset in presets_registry.list_presets():
        local_dir = preset["local_dir"].rstrip("/")
        entry = {
            "id": preset["id"],
            "name": preset["name"],
            "description": preset.get("description", ""),
            "homepage": preset.get("homepage", ""),
            "repo": preset.get("repo", ""),
            "kind": preset.get("kind", "single"),
        }
        if preset.get("kind") == "multi_source":
            # Not ingested into the cache; report on-disk source directories instead.
            downloaded = _count_downloaded_sources(os.path.join(datasets_dir, local_dir))
            entry["downloaded"] = downloaded > 0
            entry["count"] = downloaded
        else:
            matched = [s for s in sources if s["source"].startswith(local_dir + "/")]
            entry["downloaded"] = bool(matched)
            entry["count"] = sum(s["count"] for s in matched)
        result.append(entry)
    return result
