import os.path

import gradio as gr

import scripts.prompt_lab.sd_prompt_lab_utils as utils

from scripts.prompt_lab.ui.ui_tab_browse import ui_tab_browse
from scripts.prompt_lab.ui.ui_tab_create import ui_tab_create
from scripts.prompt_lab.ui.ui_tab_tag_browser import ui_tab_tag_browser
from scripts.prompt_lab.ui.ui_tab_tag_validator import ui_tab_tag_validator
from scripts.prompt_lab.ui.ui_tab_wildcard_editor import ui_tab_wildcard_editor
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

            with gr.Tab("Wildcard Editor", elem_id='sd-prompt-lab-wildcard-editor-tab'):
                with gr.Column():
                    ui_tab_wildcard_editor()

        # Always available: datasets can be downloaded from within the tab.
        with gr.Tab("Tag Browser", elem_id='sd-prompt-lab-tag-browser-tab'):
            with gr.Column():
                ui_tab_tag_browser()

        with gr.Tab("Tag Validator", elem_id='sd-prompt-lab-tag-validator-tab'):
            with gr.Column():
                ui_tab_tag_validator()

    return main_block
