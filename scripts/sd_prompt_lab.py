from typing import Optional

import gradio as gr
import modules.scripts as scripts

import scripts.prompt_lab.sd_promt_lab_env as env

from fastapi import FastAPI
from gradio import Blocks
from modules import script_callbacks
from modules import shared, sd_models, sd_vae, paths, ui_extra_networks
from modules.shared import OptionInfo

from scripts.prompt_lab.ui.ui_main import ui_main_block
from scripts.prompt_lab.sd_prompt_lab_api import init_api
from scripts.prompt_lab.sd_prompt_lab_db import init_db

env.script_dir = scripts.basedir()


def on_ui_tabs():
    return ((ui_main_block(), "Prompt Lab", "sd_prompt_lab"),)


def on_app_started(demo: Optional[Blocks], app: FastAPI):
    init_db()
    init_api(app)


script_callbacks.on_ui_tabs(on_ui_tabs)
script_callbacks.on_app_started(on_app_started)
