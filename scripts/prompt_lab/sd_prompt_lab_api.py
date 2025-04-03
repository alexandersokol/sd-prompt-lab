import hashlib
import os
import shutil

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import scripts.prompt_lab.sd_prompt_lab_db as db
import scripts.prompt_lab.sd_prompt_lab_utils as utils
import scripts.prompt_lab.sd_promt_lab_env as env


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


class WildcardFileData(BaseModel):
    path: str


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

            if data.image_path:
                thumbnail_path = utils.create_thumbnail(data.image_path, prompt_id)
                if thumbnail_path:
                    db.update_prompt_image_path(prompt_id, thumbnail_path)

            return {"status": "ok", "id": prompt_id}
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

    @app.get("/sd-prompt-lab/wildcards/tree")
    async def get_wildcards_tree():
        if not os.path.exists(utils.get_wildcards_dir()):
            return {"tree": []}

        tree = utils.list_txt_files(utils.get_wildcards_dir())
        return {"tree": tree}

    @app.get("/sd-prompt-lab/wildcards/content")
    async def get_wildcard_content(path: str = Query(...)):
        abs_path = os.path.abspath(os.path.join(utils.get_wildcards_dir(), path))
        if not abs_path.startswith(utils.get_wildcards_dir()) or not os.path.exists(abs_path):
            raise HTTPException(status_code=404, detail="File not found")
        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                content = f.read()
            return {"content": content}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/save")
    async def save_wildcard_content(data: WildcardSaveRequest):
        abs_path = os.path.abspath(os.path.join(utils.get_wildcards_dir(), data.path))
        if not abs_path.startswith(utils.get_wildcards_dir()):
            raise HTTPException(status_code=400, detail="Invalid path")
        if not os.path.isfile(abs_path):
            raise HTTPException(status_code=404, detail="File does not exist")

        try:
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write(data.content)
            return {"status": "ok"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/create")
    async def create_wildcard_file(path: str = Query(...)):

        if not path.endswith(".txt"):
            path += ".txt"

        abs_path = os.path.abspath(os.path.join(utils.get_wildcards_dir(), path))
        if not abs_path.startswith(utils.get_wildcards_dir()):
            raise HTTPException(status_code=400, detail="Invalid path")
        try:
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            if os.path.exists(abs_path):
                raise HTTPException(status_code=400, detail="File already exists")
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write("")
            return {"status": "ok"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/delete")
    async def delete_wildcard_file(data: WildcardFileData):
        abs_path = os.path.abspath(os.path.join(utils.get_wildcards_dir(), data.path))
        if not abs_path.startswith(utils.get_wildcards_dir()) or not os.path.isfile(abs_path):
            raise HTTPException(status_code=404, detail="File not found")

        try:
            os.remove(abs_path)
            return {"status": "ok"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/remove-duplicates")
    async def remove_duplicate_wildcards():
        try:
            wildcards_dir = utils.get_wildcards_dir()
            duplicates_dir = os.path.join(wildcards_dir, "duplicates")
            os.makedirs(duplicates_dir, exist_ok=True)

            # Step 1: Collect file hashes
            file_hashes = {}
            duplicates = []

            for root, _, files in os.walk(wildcards_dir):
                for file in files:
                    if not file.endswith(".txt"):
                        continue
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, wildcards_dir)

                    with open(file_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    content_hash = hashlib.md5(content.encode("utf-8")).hexdigest()

                    if content_hash in file_hashes:
                        duplicates.append((rel_path, file_path))
                    else:
                        file_hashes[content_hash] = rel_path

            # Step 2: Move duplicates
            for rel_path, full_path in duplicates:
                dest_path = os.path.join(duplicates_dir, rel_path)
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                shutil.move(full_path, dest_path)

            return {"status": "ok", "moved": [rel for rel, _ in duplicates]}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/sd-prompt-lab/wildcards/cleanup")
    async def cleanup_wildcards():
        try:
            wildcards_dir = utils.get_wildcards_dir()
            duplicates_dir = os.path.join(wildcards_dir, "duplicates")
            removed_files = []
            removed_dirs = []

            # Step 1: Remove empty and non-txt files
            for root, dirs, files in os.walk(wildcards_dir, topdown=False):
                for file in files:
                    file_path = os.path.join(root, file)
                    if not file.endswith(".txt") or os.path.getsize(file_path) == 0:
                        os.remove(file_path)
                        removed_files.append(os.path.relpath(file_path, wildcards_dir))

            # Step 2: Remove empty directories
            for root, dirs, files in os.walk(wildcards_dir, topdown=False):
                for d in dirs:
                    dir_path = os.path.join(root, d)
                    if not any(os.scandir(dir_path)):
                        os.rmdir(dir_path)
                        removed_dirs.append(os.path.relpath(dir_path, wildcards_dir))

            # Step 3: Remove duplicates directory
            if os.path.exists(duplicates_dir):
                shutil.rmtree(duplicates_dir)
                removed_dirs.append("duplicates")

            return {
                "status": "ok",
                "removed_files": removed_files,
                "removed_dirs": removed_dirs
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
