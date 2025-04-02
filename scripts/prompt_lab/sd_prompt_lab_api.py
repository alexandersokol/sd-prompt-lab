import os
import re

from fastapi import FastAPI, HTTPException
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


def parse_prompts(raw_prompt: str) -> list:
    """Parses a prompt string, expands variations, ignores __wrapped__ prompts"""
    prompts = []
    parts = [p.strip() for p in raw_prompt.split(",") if p.strip()]

    for part in parts:
        # Ignore __wrapped__ parts
        if re.match(r"^__.+__$", part):
            continue

        # Find variations
        match = re.search(r"\{([^}]+)\}", part)
        if match:
            variations = match.group(1).split("|")
            # Remove empty strings
            variations = [v for v in variations if v.strip()]
            if variations:
                # Generate prompt for each variation
                for var in variations:
                    expanded = part.replace(match.group(0), var.strip())
                    # Remove potential leftover empty strings
                    if expanded.strip():
                        prompts.append(expanded.strip())
            else:
                # If all empty, ignore
                continue
        else:
            prompts.append(part.strip())

    # Remove duplicates and exclude prompts containing '__'
    return list(sorted({p for p in prompts if '__' not in p}))


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

            prompts_list = parse_prompts(data.prompt)
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
    async def get_all_prompts():
        try:
            prompts = db.get_all_prompts()
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
