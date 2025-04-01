import gradio as gr


def ui_tab_browse():
    with gr.Column():
        refresh_button = gr.Button('🔄 Refresh', elem_id='sd-prompt-lab-refresh-button')
        cards_output = gr.HTML(elem_id='sd-prompt-lab-cards-output')
    return refresh_button, cards_output
