import os.path

import gradio as gr

import scripts.prompt_lab.sd_prompt_lab_utils as utils

from scripts.prompt_lab.ui.ui_tab_browse import ui_tab_browse
from scripts.prompt_lab.ui.ui_tab_create import ui_tab_create
from scripts.prompt_lab.ui.ui_tab_wildcards import ui_tab_wildcards


def ui_main_block():
    with gr.Blocks(elem_id='prompt_lab_tab') as main_block:
        with gr.Tab("Create", elem_id='sd-prompt-lab-create-tab'):
            with gr.Column():
                ui_tab_create()
        with gr.Tab("Browse", elem_id='sd-prompt-lab-browse-tab'):
            with gr.Column():
                ui_tab_browse()

        if os.path.exists(utils.get_wildcards_dir()):
            with gr.Tab("Wildcards", elem_id='sd-prompt-lab-wildcards-tab'):
                with gr.Column():
                    ui_tab_wildcards()

    return main_block
