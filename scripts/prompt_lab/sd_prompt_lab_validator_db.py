import os
import sqlite3
from datetime import datetime

import scripts.prompt_lab.sd_promt_lab_env as env


def get_db_path():
    file_path = os.path.join(env.script_dir, "prompts.db")
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    return file_path


def connect():
    return sqlite3.connect(get_db_path())


def init_validator_db():
    with connect() as conn:
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS validator_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                approved INTEGER NOT NULL DEFAULT 0,
                created_at TEXT
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS validator_tags (
                name TEXT PRIMARY KEY,
                status TEXT NOT NULL
            )
        """)
        conn.commit()


def create_cards(texts):
    """Insert cards in order; return [{id, text, approved}] for the created rows."""
    created = []
    with connect() as conn:
        c = conn.cursor()
        for text in texts:
            now = datetime.utcnow().isoformat()
            c.execute(
                "INSERT INTO validator_cards (text, approved, created_at) VALUES (?, 0, ?)",
                (text, now),
            )
            created.append({"id": c.lastrowid, "text": text, "approved": 0})
        conn.commit()
    return created


def get_state():
    with connect() as conn:
        c = conn.cursor()
        c.execute("SELECT id, text, approved FROM validator_cards ORDER BY id ASC")
        cards = [{"id": r[0], "text": r[1], "approved": r[2]} for r in c.fetchall()]
        c.execute("SELECT name, status FROM validator_tags ORDER BY name ASC")
        tags = [{"name": r[0], "status": r[1]} for r in c.fetchall()]
    return {"cards": cards, "tags": tags}


def update_card(card_id, text=None, approved=None):
    """Update text and/or approved. Returns False if the card does not exist."""
    sets, params = [], []
    if text is not None:
        sets.append("text = ?")
        params.append(text)
    if approved is not None:
        sets.append("approved = ?")
        params.append(1 if approved else 0)
    if not sets:
        return True
    params.append(card_id)
    with connect() as conn:
        c = conn.cursor()
        c.execute(f"UPDATE validator_cards SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
        return c.rowcount > 0


def delete_card(card_id):
    with connect() as conn:
        c = conn.cursor()
        c.execute("DELETE FROM validator_cards WHERE id = ?", (card_id,))
        conn.commit()


def clear_all():
    with connect() as conn:
        c = conn.cursor()
        c.execute("DELETE FROM validator_cards")
        c.execute("DELETE FROM validator_tags")
        conn.commit()


def set_tag(name, status):
    """Upsert a global tag verdict. status 'none' deletes the row."""
    with connect() as conn:
        c = conn.cursor()
        if status == "none":
            c.execute("DELETE FROM validator_tags WHERE name = ?", (name,))
        else:
            c.execute(
                "INSERT INTO validator_tags (name, status) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET status = excluded.status",
                (name, status),
            )
        conn.commit()
