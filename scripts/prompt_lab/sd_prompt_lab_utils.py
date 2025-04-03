import os
import re

from PIL import Image

import scripts.prompt_lab.sd_promt_lab_env as env

VALID_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def create_thumbnail(image_path: str, prompt_id: int):
    if not image_path:
        return None

    if not os.path.isfile(image_path):
        return None

    ext = os.path.splitext(image_path)[1].lower()
    if ext not in VALID_IMAGE_EXTENSIONS:
        return None

    # Open image
    try:
        with Image.open(image_path) as img:
            # Center crop
            width, height = img.size
            target_ratio = 250 / 350
            current_ratio = width / height

            if current_ratio > target_ratio:
                # Crop width
                new_width = int(height * target_ratio)
                left = (width - new_width) // 2
                box = (left, 0, left + new_width, height)
            else:
                # Crop height
                new_height = int(width / target_ratio)
                top = (height - new_height) // 2
                box = (0, top, width, top + new_height)

            img = img.crop(box)
            img = img.resize((250, 350), Image.LANCZOS)

            # Save
            pics_dir = os.path.join(env.script_dir, "pics")
            os.makedirs(pics_dir, exist_ok=True)
            out_path = os.path.join(pics_dir, f"{prompt_id}.png")
            img.save(out_path, format="PNG")

            return out_path
    except Exception as e:
        print(f"Thumbnail creation failed: {e}")
        return None


def get_extensions_dir():
    return os.path.abspath(os.path.join(env.script_dir, ".."))


def get_wildcards_dir():
    return os.path.join(get_extensions_dir(), "sd-dynamic-prompts", "wildcards")


def parse_prompts(raw_prompt: str) -> list:
    """Parses a prompt string, expands variations, and ignores __wrapped__ prompts and weights like :0.2"""
    prompts = []

    # Split by comma, newline, or pipe
    parts = re.split(r'[,\n|]+', raw_prompt)
    parts = [p.strip() for p in parts if p.strip()]

    for part in parts:
        # Ignore __wrapped__ parts
        if re.match(r"^__.+__$", part):
            continue

        # Remove weight suffix like ":0.2"
        part = re.sub(r":[0-9.]+$", "", part).strip()

        # Skip empty after removing weight
        if not part:
            continue

        # Find variations inside {...}
        match = re.search(r"\{([^}]+)\}", part)
        if match:
            variations = match.group(1).split("|")
            variations = [v.strip() for v in variations if v.strip()]
            for var in variations:
                expanded = part.replace(match.group(0), var)
                if expanded.strip():
                    prompts.append(expanded.strip())
        else:
            prompts.append(part)

    # Remove duplicates and any that still contain '__'
    return list(sorted({p for p in prompts if '__' not in p}))


def list_txt_files(directory, base=""):
    """Recursively list all .txt files as a tree."""
    result = []
    for entry in sorted(os.scandir(directory), key=lambda e: e.name):
        if entry.is_dir():
            sub_items = list_txt_files(entry.path, os.path.join(base, entry.name))
            if sub_items:
                result.append({
                    "name": entry.name,
                    "path": os.path.join(base, entry.name),
                    "type": "folder",
                    "children": sub_items
                })
        elif entry.is_file() and entry.name.endswith(".txt"):
            result.append({
                "name": entry.name,
                "path": os.path.join(base, entry.name),
                "type": "file"
            })
    return result
