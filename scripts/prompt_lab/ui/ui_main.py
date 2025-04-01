import gradio as gr

from scripts.prompt_lab.ui.ui_tab_browse import ui_tab_browse
from scripts.prompt_lab.ui.ui_tab_create import ui_tab_create
from scripts.prompt_lab.ui.ui_tab_wildcards import ui_tab_wildcards


def ui_main_block():
    with gr.Blocks(elem_id='prompt_lab_tab') as main_block:
        with gr.Tab("Create"):
            with gr.Column():
                ui_tab_create()
        with gr.Tab("Browse"):
            with gr.Column():
                ui_tab_browse()
        with gr.Tab("Wildcards"):
            with gr.Column():
                ui_tab_wildcards()

    return main_block
