import gradio as gr
from modules import ui_components


def ui_tab_browse():
    with gr.Column():
        with gr.Row():
            gr.Textbox(label='Search', elem_id="sd-prompt-lab-search-input")
            ui_components.ToolButton(value='🗑',
                                     elem_id="sd-prompt-lab-clear-search-button",
                                     tooltip="Clear search")
            refresh_button = ui_components.ToolButton(value='🔄',
                                                      elem_id="sd-prompt-lab-refresh-button",
                                                      tooltip="Refresh prompts")

        cards_output = gr.HTML(elem_id='sd-prompt-lab-cards-output')
    return refresh_button, cards_output
