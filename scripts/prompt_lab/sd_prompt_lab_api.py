import mimetypes
import os
import shutil
import threading

import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import scripts.prompt_lab.sd_prompt_lab_db as db
import scripts.prompt_lab.sd_prompt_lab_tags_db as tags_db
import scripts.prompt_lab.sd_prompt_lab_tag_presets as tag_presets
import scripts.prompt_lab.sd_prompt_lab_validator_db as validator_db
import scripts.prompt_lab.sd_prompt_lab_utils as utils
import scripts.prompt_lab.sd_promt_lab_env as env

# In-flight / finished dataset download jobs, keyed by preset id (see the preset download routes).
_download_jobs = {}
_download_jobs_lock = threading.Lock()

# Single background cache-rebuild job (see the cache rebuild routes). A big first import
# (e.g. after adding the site_tags dataset) runs here with progress instead of blocking a read.
_rebuild_job = {"phase": "idle", "imported": 0, "done": True, "error": None}
_rebuild_job_lock = threading.Lock()


# Pydantic model for input validation
class PromptData(BaseModel):
    name: str
    description: str | None = None
    image_path: str | None = None
    prompt: str = Field(..., description="Comma-separated prompts")
    override: bool = False


class WildcardSaveRequest(BaseModel):
    path: str
    content: str


class WildcardRenameRequest(BaseModel):
    old_path: str
    new_path: str


class WildcardDeleteRequest(BaseModel):
    path: str


class TagPresetDownloadRequest(BaseModel):
    id: str


class PromptWordUpdate(BaseModel):
    word: str


class ValidatorCardsCreate(BaseModel):
    texts: list[str]


class ValidatorCardUpdate(BaseModel):
    text: str | None = None
    approved: bool | None = None


class ValidatorTagUpdate(BaseModel):
    status: str  # 'approved' | 'declined' | 'none'


def _wildcards_root():
    return os.path.abspath(utils.get_wildcards_dir())


def _resolve_wildcard_path(path: str, allow_root: bool = False):
    root = _wildcards_root()
    candidate = os.path.abspath(os.path.join(root, path or ""))
    if os.path.commonpath([root, candidate]) != root:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not allow_root and candidate == root:
        raise HTTPException(status_code=400, detail="Root directory cannot be modified")
    return candidate


def _rel_posix(abs_path):
    # Relative path with forward slashes so the UI stays consistent across OSes.
    return os.path.relpath(abs_path, _wildcards_root()).replace(os.sep, "/")


def _build_wildcards_editor_tree(directory, base=""):
    result = []
    if not os.path.isdir(directory):
        return result

    entries = sorted(os.scandir(directory), key=lambda e: (not e.is_dir(), e.name.lower()))
    for entry in entries:
        # Always use forward slashes so the UI shows/copies "/" on every OS.
        path = f"{base}/{entry.name}" if base else entry.name
        if entry.is_dir():
            result.append({
                "name": entry.name,
                "path": path,
                "type": "folder",
                "children": _build_wildcards_editor_tree(entry.path, path)
            })
        elif entry.is_file() and entry.name.endswith(".txt"):
            stat = entry.stat()
            result.append({
                "name": entry.name,
                "path": path,
                "type": "file",
                "size": stat.st_size,
                "modified": stat.st_mtime
            })
    return result


def init_api(app: FastAPI):
    @app.get("/sd-prompt-lab/autocomplete")
    async def autocomplete(request: Request):
        q = request.query_params.get("q", "").strip()
        if not q:
            return {"results": []}
        try:
            words = db.search_prompt_words(q, limit=30)
            return {"results": words}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/save")
    async def save_prompt_endpoint(data: PromptData):
        try:
            if data.override:
                prompt_id = db.save_or_update_prompt(data.dict())
            else:
                existing_prompt = db.get_prompt_by_name(data.name)
                if existing_prompt:
                    raise HTTPException(status_code=400, detail="Prompt already exists")
                prompt_id = db.save_or_update_prompt(data.dict())

            prompts_list = utils.parse_prompts(data.prompt)
            db.insert_prompt_words_list(prompts_list)

            # Handle image
            if data.image_path:
                image_path = data.image_path
                is_remote = image_path.startswith("http://") or image_path.startswith("https://")

                if is_remote:
                    # Try to download the image
                    try:
                        response = requests.get(image_path, timeout=10)
                        response.raise_for_status()
                        ext = mimetypes.guess_extension(response.headers.get("Content-Type", "image/jpeg")) or ".jpg"

                        temp_path = os.path.join(env.script_dir, "pics", f"tmp{ext}")
                        with open(temp_path, "wb") as f:
                            f.write(response.content)

                        thumbnail_path = utils.create_thumbnail(temp_path, prompt_id)

                        os.remove(temp_path)
                    except Exception as e:
                        raise HTTPException(status_code=400, detail=f"Failed to download or process image: {str(e)}")
                else:
                    thumbnail_path = utils.create_thumbnail(image_path, prompt_id)

                if thumbnail_path:
                    db.update_prompt_image_path(prompt_id, thumbnail_path)

            return {"status": "ok", "id": prompt_id}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/sd-prompt-lab/thumbnail/{prompt_id}")
    async def get_thumbnail(prompt_id: int):
        try:
            prompt = db.get_prompt_by_id(prompt_id)
            if not prompt:
                raise HTTPException(status_code=404, detail="Prompt not found")

            image_path = prompt.get("image_path")
            if not image_path or not os.path.isfile(image_path):
                no_image_path = os.path.join(env.script_dir, "no_image_placeholder.png")
                if no_image_path and os.path.isfile(no_image_path):
                    return FileResponse(no_image_path, media_type="image/png")
                else:
                    raise HTTPException(status_code=404, detail="Thumbnail not found")

            return FileResponse(image_path, media_type="image/png")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/sd-prompt-lab/all")
    async def get_all_prompts(search: str = None):
        try:
            prompts = db.get_all_prompts(search)
            return {"prompts": prompts}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.delete("/sd-prompt-lab/delete/{prompt_id}")
    async def delete_prompt(prompt_id: int):
        try:
            prompt = db.get_prompt_by_id(prompt_id)
            if not prompt:
                raise HTTPException(status_code=404, detail="Prompt not found")

            db.delete_prompt_by_id(prompt_id)

            thumb_path = os.path.join(env.script_dir, "pics", f"{prompt_id}.png")
            if os.path.isfile(thumb_path):
                os.remove(thumb_path)

            return {"status": "ok", "id": prompt_id}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/sd-prompt-lab/tags/sources")
    async def get_tag_sources():
        try:
            tags_db.ensure_cache()
            return {
                "sources": tags_db.list_sources(),
                "datasets_dir_exists": os.path.isdir(tags_db.get_datasets_dir()),
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/sd-prompt-lab/tags/presets")
    def get_tag_presets():
        try:
            return {"presets": tags_db.presets_status()}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # Downloads run in a background thread so a (potentially multi-GB) download reports
    # live progress via the poll endpoint instead of blocking one long request.
    @app.post("/sd-prompt-lab/tags/presets/download")
    def download_tag_preset(data: TagPresetDownloadRequest):
        preset = tag_presets.get_preset(data.id)
        if not preset:
            raise HTTPException(status_code=400, detail=f"Unknown preset '{data.id}'")

        with _download_jobs_lock:
            existing = _download_jobs.get(data.id)
            if existing and not existing.get("done"):
                return {"status": "already_running"}
            job = {"phase": "starting", "downloaded": 0, "total": 0,
                   "imported": 0, "done": False, "error": None, "result": None}
            _download_jobs[data.id] = job

        def run():
            try:
                result = tags_db.download_preset(preset, progress=job)
                job.update(phase="done", done=True, result=result)
            except ValueError as e:
                job.update(phase="error", done=True, error=str(e))
            except requests.RequestException as e:
                job.update(phase="error", done=True, error=f"Download failed: {e}")
            except Exception as e:
                job.update(phase="error", done=True, error=str(e))

        threading.Thread(target=run, daemon=True).start()
        return {"status": "started", "id": data.id}

    @app.get("/sd-prompt-lab/tags/presets/download/progress")
    def download_tag_preset_progress(id: str = Query(...)):
        job = _download_jobs.get(id)
        if not job:
            return {"phase": "idle", "done": True}
        return dict(job)

    # Cache rebuild is exposed so the UI can run a large first import (e.g. site_tags) in the
    # background with progress, rather than blocking a plain /tags/sources read for minutes.
    @app.get("/sd-prompt-lab/tags/cache/status")
    def tags_cache_status():
        try:
            return tags_db.cache_status()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/tags/cache/rebuild")
    def tags_cache_rebuild():
        with _rebuild_job_lock:
            if not _rebuild_job.get("done", True):
                return {"status": "already_running"}
            _rebuild_job.update(phase="importing", imported=0, done=False, error=None)

        def run():
            try:
                tags_db.ensure_cache(progress_cb=lambda n: _rebuild_job.update(imported=n))
                _rebuild_job.update(phase="done", done=True)
            except Exception as e:
                _rebuild_job.update(phase="error", done=True, error=str(e))

        threading.Thread(target=run, daemon=True).start()
        return {"status": "started"}

    @app.get("/sd-prompt-lab/tags/cache/rebuild/progress")
    def tags_cache_rebuild_progress():
        return dict(_rebuild_job)

    @app.get("/sd-prompt-lab/tags/detail")
    async def get_tag_detail(name: str = Query(...)):
        try:
            tags_db.ensure_cache()
            detail = tags_db.get_tag_detail(name)
            if not detail:
                raise HTTPException(status_code=404, detail="Tag not found")
            return detail
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/sd-prompt-lab/tags")
    async def get_tags(
            q: str = Query(None),
            category: int = Query(None),
            source: str = Query(None),
            include_deprecated: bool = Query(False),
            sort: str = Query("post_count"),
            limit: int = Query(60),
            offset: int = Query(0),
    ):
        try:
            tags_db.ensure_cache()

            q = (q or "").strip() or None
            limit = max(1, min(limit, 200))
            offset = max(0, offset)

            # Only honour a source that actually exists in the cache.
            known_sources = {s["source"] for s in tags_db.list_sources()}
            if source not in known_sources:
                source = None

            filters = dict(q=q, category=category, source=source,
                           include_deprecated=include_deprecated)
            return {
                "tags": tags_db.query_tags(sort=sort, limit=limit, offset=offset, **filters),
                "total": tags_db.count_tags(**filters),
                "categories": tags_db.category_counts(
                    source=source, include_deprecated=include_deprecated),
                "sources": tags_db.list_sources(),
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # --- Tag Validator ---------------------------------------------------
    # Registered before the catch-all /sd-prompt-lab/{prompt_id} route.

    @app.get("/sd-prompt-lab/validator/state")
    def validator_state():
        return validator_db.get_state()

    @app.post("/sd-prompt-lab/validator/cards")
    def validator_create_cards(data: ValidatorCardsCreate):
        return {"cards": validator_db.create_cards(data.texts)}

    @app.patch("/sd-prompt-lab/validator/cards/{card_id}")
    def validator_update_card(card_id: int, data: ValidatorCardUpdate):
        ok = validator_db.update_card(card_id, text=data.text, approved=data.approved)
        if not ok:
            raise HTTPException(status_code=404, detail="Card not found")
        return {"status": "ok"}

    @app.delete("/sd-prompt-lab/validator/cards/{card_id}")
    def validator_delete_card(card_id: int):
        validator_db.delete_card(card_id)
        return {"status": "ok"}

    @app.post("/sd-prompt-lab/validator/cards/clear")
    def validator_clear():
        validator_db.clear_cards()
        return {"status": "ok"}

    @app.put("/sd-prompt-lab/validator/tags/{name}")
    def validator_set_tag(name: str, data: ValidatorTagUpdate):
        validator_db.set_tag(name, data.status)
        return {"status": "ok"}

    # --- Autocompletion words / settings (Settings tab) -------------------
    # Registered before the catch-all /sd-prompt-lab/{prompt_id} route.

    @app.get("/sd-prompt-lab/words")
    def list_words(q: str = Query(None), limit: int = Query(200), offset: int = Query(0)):
        q = (q or "").strip() or None
        return db.list_prompt_words(q=q, limit=max(1, min(limit, 500)), offset=max(0, offset))

    @app.post("/sd-prompt-lab/words/clear")
    def clear_words():
        db.clear_prompt_words()
        return {"status": "ok"}

    @app.patch("/sd-prompt-lab/words/{word_id}")
    def rename_word(word_id: int, data: PromptWordUpdate):
        word = data.word.strip()
        if not word:
            raise HTTPException(status_code=400, detail="Word cannot be empty")
        result = db.rename_prompt_word(word_id, word)
        if result == "missing":
            raise HTTPException(status_code=404, detail="Word not found")
        if result == "conflict":
            raise HTTPException(status_code=409, detail=f'"{word}" already exists')
        return {"status": "ok", "word": word}

    @app.delete("/sd-prompt-lab/words/{word_id}")
    def delete_word(word_id: int):
        db.delete_prompt_word(word_id)
        return {"status": "ok"}

    @app.get("/sd-prompt-lab/settings")
    def get_settings():
        return db.get_settings()

    @app.put("/sd-prompt-lab/settings")
    def put_settings(values: dict):
        db.set_settings(values)
        return db.get_settings()

    @app.get("/sd-prompt-lab/{prompt_id}")
    async def get_prompt(prompt_id: int):
        try:
            prompt = db.get_prompt_by_id(prompt_id)
            if not prompt:
                raise HTTPException(status_code=404, detail="Prompt not found")
            return {"status": "ok", "prompt": prompt}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/favorite/{prompt_id}")
    async def toggle_favorite(prompt_id: int, is_favorite: bool):
        try:
            db.set_prompt_favorite(prompt_id, is_favorite)
            return {"status": "ok"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/sd-prompt-lab/wildcards/editor/tree")
    async def get_wildcards_editor_tree():
        root = _wildcards_root()
        if not os.path.exists(root):
            return {"tree": []}

        return {"tree": _build_wildcards_editor_tree(root)}

    @app.get("/sd-prompt-lab/wildcards/editor/search")
    def search_wildcards_content(q: str = Query("")):
        return {"paths": utils.search_wildcard_files(_wildcards_root(), q)}

    @app.get("/sd-prompt-lab/wildcards/content")
    async def get_wildcard_content(path: str = Query(...)):
        abs_path = _resolve_wildcard_path(path)
        if not os.path.isfile(abs_path):
            raise HTTPException(status_code=404, detail="File not found")
        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                content = f.read()
            return {"content": content}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/save")
    async def save_wildcard_content(data: WildcardSaveRequest):
        abs_path = _resolve_wildcard_path(data.path)
        if not os.path.isfile(abs_path):
            raise HTTPException(status_code=404, detail="File does not exist")

        try:
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write(data.content)
            return {"status": "ok"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/editor/file/create")
    async def create_wildcard_editor_file(path: str = Query(...)):
        if not path.endswith(".txt"):
            path += ".txt"

        abs_path = _resolve_wildcard_path(path)
        if os.path.exists(abs_path):
            raise HTTPException(status_code=400, detail="File already exists")

        try:
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write("")
            return {"status": "ok", "path": _rel_posix(abs_path)}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/editor/folder/create")
    async def create_wildcard_folder(path: str = Query(...)):
        abs_path = _resolve_wildcard_path(path)
        if os.path.exists(abs_path):
            raise HTTPException(status_code=400, detail="Folder already exists")

        try:
            os.makedirs(abs_path, exist_ok=False)
            return {"status": "ok", "path": _rel_posix(abs_path)}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/editor/rename")
    async def rename_wildcard_entry(data: WildcardRenameRequest):
        old_path = _resolve_wildcard_path(data.old_path)
        new_path = _resolve_wildcard_path(data.new_path)

        if not os.path.exists(old_path):
            raise HTTPException(status_code=404, detail="Source path does not exist")
        if os.path.exists(new_path):
            raise HTTPException(status_code=400, detail="Destination path already exists")

        try:
            os.makedirs(os.path.dirname(new_path), exist_ok=True)
            shutil.move(old_path, new_path)
            return {"status": "ok", "path": _rel_posix(new_path)}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/editor/delete")
    async def delete_wildcard_entry(data: WildcardDeleteRequest):
        abs_path = _resolve_wildcard_path(data.path)
        if not os.path.exists(abs_path):
            raise HTTPException(status_code=404, detail="Path does not exist")

        try:
            if os.path.isdir(abs_path):
                shutil.rmtree(abs_path)
            else:
                os.remove(abs_path)
            return {"status": "ok"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
