import json
import os
import re
import sqlite3

import scripts.prompt_lab.sd_promt_lab_env as env


def get_db_path():
    file_path = os.path.join(env.script_dir, 'prompts.db')
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    return file_path


def connect():
    return sqlite3.connect(get_db_path())


def migrate_add_favorite():
    conn = sqlite3.connect(get_db_path())
    c = conn.cursor()

    # Check if column already exists
    c.execute("PRAGMA table_info(prompts)")
    columns = [col[1] for col in c.fetchall()]

    if "is_favorite" not in columns:
        c.execute("ALTER TABLE prompts ADD COLUMN is_favorite INTEGER DEFAULT 0")
        print("Database migrated: 'is_favorite' column added")

    conn.commit()
    conn.close()


def init_db():
    with connect() as conn:
        c = conn.cursor()
        # Create main prompts table
        c.execute("""
                    CREATE TABLE IF NOT EXISTS prompts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL UNIQUE,
                        description TEXT,
                        image_path TEXT,
                        prompt TEXT NOT NULL,
                        is_favorite INTEGER DEFAULT 0
                    )
                """)
        # Create prompt words table
        c.execute("""
                    CREATE TABLE IF NOT EXISTS prompt_words (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        word TEXT NOT NULL UNIQUE
                    )
                """)
        c.execute("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)")
        # Words the user added to the spell-check dictionary.
        c.execute("CREATE TABLE IF NOT EXISTS spell_words (word TEXT PRIMARY KEY)")
        conn.commit()
        migrate_add_favorite()


def insert_prompt_words_list(words: list[str]):
    if not words:
        return

    with connect() as conn:
        c = conn.cursor()
        # Insert words, ignore duplicates
        c.executemany("""
            INSERT OR IGNORE INTO prompt_words (word) VALUES (?)
        """, [(word,) for word in words])
        conn.commit()


def update_prompt_image_path(prompt_id: int, new_path: str):
    with connect() as conn:
        c = conn.cursor()
        c.execute("UPDATE prompts SET image_path = ? WHERE id = ?", (new_path, prompt_id))
        conn.commit()


def save_or_update_prompt(data: dict):
    """Insert a prompt, or update the one with the same name when data['override'] is set.

    The image is not touched here: thumbnails are attached with update_prompt_image_path()
    and removed with clear_prompt_image(), so an update keeps the existing image.
    """
    existing = get_prompt_by_name(data["name"])
    with connect() as conn:
        c = conn.cursor()
        if existing and data.get("override", False):
            c.execute("""
                UPDATE prompts
                SET description = ?, prompt = ?
                WHERE id = ?
            """, (data.get("description"), data["prompt"], existing["id"]))
            prompt_id = existing["id"]
        elif not existing:
            c.execute("""
                INSERT INTO prompts (name, description, prompt)
                VALUES (?, ?, ?)
            """, (data["name"], data.get("description"), data["prompt"]))
            prompt_id = c.lastrowid
        else:
            # Existing and override=False
            return None

        conn.commit()
        return prompt_id


def clear_prompt_image(prompt_id: int):
    with connect() as conn:
        c = conn.cursor()
        c.execute("UPDATE prompts SET image_path = NULL WHERE id = ?", (prompt_id,))
        conn.commit()


def get_prompt_by_name(name: str):
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT id, name, description, image_path, prompt, is_favorite FROM prompts WHERE name = ?", (name,))
        row = c.fetchone()
        if row:
            return {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "image_path": row[3],
                "prompt": row[4],
                "is_favorite": row[5]
            }
        return None


def get_prompt_by_id(prompt_id: int):
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT id, name, description, image_path, prompt, is_favorite FROM prompts WHERE id = ?",
                  (prompt_id,))
        row = c.fetchone()
        if row:
            return {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "image_path": row[3],
                "prompt": row[4],
                "is_favorite": row[5]
            }
        return None


def delete_prompt_by_id(prompt_id: int):
    with connect() as conn:
        c = conn.cursor()
        # Delete prompt
        c.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
        conn.commit()


_PROMPT_SORTS = {
    "newest": "id DESC",
    "oldest": "id ASC",
    "name": "name COLLATE NOCASE ASC",
}


def _prompt_filters(search, favorites):
    where, params = [], []
    if search:
        like = f"%{search}%"
        where.append("(name LIKE ? OR prompt LIKE ? OR description LIKE ?)")
        params += [like, like, like]
    if favorites:
        where.append("is_favorite = 1")
    return (" WHERE " + " AND ".join(where)) if where else "", params


def get_all_prompts(search: str = None, sort: str = "newest", favorites: bool = False,
                    limit: int = None, offset: int = 0):
    """Saved prompts, favourites first within the chosen order. `limit=None` returns all."""
    clause, params = _prompt_filters(search, favorites)
    order = _PROMPT_SORTS.get(sort, _PROMPT_SORTS["newest"])
    sql = f"""
        SELECT id, name, description, image_path, prompt, is_favorite
        FROM prompts{clause}
        ORDER BY is_favorite DESC, {order}
    """
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        params += [limit, offset]
    with connect() as conn:
        c = conn.cursor()
        c.execute(sql, params)
        return [
            {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "image_path": row[3],
                "prompt": row[4],
                "is_favorite": row[5]
            }
            for row in c.fetchall()
        ]


def count_prompts(search: str = None, favorites: bool = False):
    clause, params = _prompt_filters(search, favorites)
    with connect() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) FROM prompts{clause}", params)
        return c.fetchone()[0]


def set_prompt_favorite(prompt_id: int, is_favorite: bool):
    with connect() as conn:
        c = conn.cursor()
        c.execute("UPDATE prompts SET is_favorite = ? WHERE id = ?", (int(is_favorite), prompt_id))
        conn.commit()


def search_prompt_words(query: str, limit: int = 30):
    with connect() as conn:
        c = conn.cursor()
        like_query = f"%{query}%"
        c.execute("SELECT DISTINCT word FROM prompt_words WHERE word LIKE ? LIMIT ?", (like_query, limit))
        return [row[0] for row in c.fetchall()]


def list_prompt_words(q: str = None, limit: int = 200, offset: int = 0):
    where, params = "", []
    if q:
        where = " WHERE word LIKE ?"
        params.append(f"%{q}%")
    with connect() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) FROM prompt_words{where}", params)
        total = c.fetchone()[0]
        c.execute(
            f"SELECT id, word FROM prompt_words{where} ORDER BY word COLLATE NOCASE LIMIT ? OFFSET ?",
            params + [limit, offset],
        )
        return {"words": [{"id": row[0], "word": row[1]} for row in c.fetchall()], "total": total}


def rename_prompt_word(word_id: int, word: str):
    """Returns 'ok', 'missing' (no such id) or 'conflict' (the word already exists)."""
    with connect() as conn:
        c = conn.cursor()
        try:
            c.execute("UPDATE prompt_words SET word = ? WHERE id = ?", (word, word_id))
        except sqlite3.IntegrityError:
            return "conflict"
        conn.commit()
        return "ok" if c.rowcount > 0 else "missing"


def delete_prompt_word(word_id: int):
    with connect() as conn:
        c = conn.cursor()
        c.execute("DELETE FROM prompt_words WHERE id = ?", (word_id,))
        conn.commit()


def delete_prompt_words(words):
    """Remove the given autocompletion words (case-insensitive)."""
    if not words:
        return
    with connect() as conn:
        c = conn.cursor()
        c.executemany("DELETE FROM prompt_words WHERE word = ? COLLATE NOCASE", [(w,) for w in words])
        conn.commit()


def clear_prompt_words():
    with connect() as conn:
        c = conn.cursor()
        c.execute("DELETE FROM prompt_words")
        conn.commit()


def add_spell_word(word: str):
    with connect() as conn:
        c = conn.cursor()
        c.execute("INSERT OR IGNORE INTO spell_words (word) VALUES (?)", (word.strip().lower(),))
        conn.commit()


def known_prompt_words(words):
    """Subset of `words` (lower-case) the user already vouches for: words in the saved
    autocompletion prompts, plus words added to the spell-check dictionary."""
    wanted = set(words)
    if not wanted:
        return set()
    known = set()
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT word FROM spell_words")
        known.update(wanted.intersection(row[0] for row in c.fetchall()))
        c.execute("SELECT word FROM prompt_words")
        for (saved,) in c.fetchall():
            known.update(wanted.intersection(re.findall(r"[a-z]+", saved.lower())))
    return known


# Known settings and their defaults; unknown keys are ignored on write.
DEFAULT_SETTINGS = {
    "spell_check": True,
    # False: completed tags are inserted A1111-style ("long hair", "artist \\(style\\)");
    # True: exactly as stored in the tag dataset ("long_hair", "artist_(style)").
    "tag_underscores": False,
}


def get_settings():
    settings = dict(DEFAULT_SETTINGS)
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT k, v FROM settings")
        for key, value in c.fetchall():
            if key not in DEFAULT_SETTINGS:
                continue
            try:
                settings[key] = json.loads(value)
            except (ValueError, TypeError):
                pass
    return settings


def set_settings(values: dict):
    with connect() as conn:
        c = conn.cursor()
        for key, value in values.items():
            if key not in DEFAULT_SETTINGS:
                continue
            c.execute(
                "INSERT INTO settings (k, v) VALUES (?, ?) "
                "ON CONFLICT(k) DO UPDATE SET v = excluded.v",
                (key, json.dumps(value)),
            )
        conn.commit()
