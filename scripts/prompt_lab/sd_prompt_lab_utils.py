import os
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
