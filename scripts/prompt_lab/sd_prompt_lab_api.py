import os

from fastapi import FastAPI, HTTPException, Query
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


def init_api(app: FastAPI):
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
