import os
import sqlite3

import scripts.prompt_lab.sd_promt_lab_env as env


def connect():
    file_path = os.path.join(env.script_dir, 'prompts.db')
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    return sqlite3.connect(file_path)


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
                        prompt TEXT NOT NULL
                    )
                """)
        # Create prompt words table
        c.execute("""
                    CREATE TABLE IF NOT EXISTS prompt_words (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        word TEXT NOT NULL UNIQUE
                    )
                """)
        conn.commit()


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
    existing = get_prompt_by_name(data["name"])
    with connect() as conn:
        c = conn.cursor()
        if existing and data.get("override", False):
            # Update existing
            c.execute("""
                UPDATE prompts 
                SET description = ?, image_path = ?, prompt = ?
                WHERE id = ?
            """, (data.get("description"), data.get("image_path"), data["prompt"], existing["id"]))
            prompt_id = existing["id"]
        elif not existing:
            # Insert new
            c.execute("""
                INSERT INTO prompts (name, description, image_path, prompt)
                VALUES (?, ?, ?, ?)
            """, (data["name"], data.get("description"), data.get("image_path"), data["prompt"]))
            prompt_id = c.lastrowid
        else:
            # Existing and override=False
            return None

        conn.commit()
        return prompt_id


def get_prompt_by_name(name: str):
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT id, name, description, image_path, prompt FROM prompts WHERE name = ?", (name,))
        row = c.fetchone()
        if row:
            return {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "image_path": row[3],
                "prompt": row[4]
            }
        return None


def get_prompt_by_id(prompt_id: int):
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT id, name, description, image_path, prompt FROM prompts WHERE id = ?", (prompt_id,))
        row = c.fetchone()
        if row:
            return {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "image_path": row[3],
                "prompt": row[4]
            }
        return None


def delete_prompt_by_id(prompt_id: int):
    with connect() as conn:
        c = conn.cursor()
        # Delete prompt
        c.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
        conn.commit()


def get_all_prompts():
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT id, name, description, image_path, prompt FROM prompts ORDER BY id DESC ")
        rows = c.fetchall()
        return [
            {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "image_path": row[3],
                "prompt": row[4]
            }
            for row in rows
        ]


def search_prompt_words(prefix: str = ""):
    with connect() as conn:
        c = conn.cursor()
        if prefix:
            c.execute("""
                SELECT DISTINCT word FROM prompt_words 
                WHERE word LIKE ?
                ORDER BY word ASC
            """, (f"{prefix}%",))
        else:
            c.execute("""
                SELECT DISTINCT word FROM prompt_words 
                ORDER BY word ASC
            """)
        rows = c.fetchall()
        return [row[0] for row in rows]
