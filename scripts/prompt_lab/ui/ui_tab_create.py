import gradio as gr


def ui_tab_create():
    with gr.Row():
        with gr.Column(scale=5):
            gr.HTML("""<textarea id="code-editor""></textarea>""")
        with gr.Column(scale=1):
            gr.Textbox(label='Name', elem_id='sd-prompt-lab-name-input')
            gr.Checkbox(label='Override existing', elem_id='sd-prompt-lab-override-checkbox')
            gr.Textbox(label='Description', elem_id='sd-prompt-lab-description-input')
            gr.Textbox(label='Image Path', elem_id='sd-prompt-lab-image-path-input')
            gr.Button('🗑 Clear', elem_id='sd-prompt-lab-clear-button')
            gr.Button('🏞 txt2img', elem_id='sd-prompt-lab-txt2img-button')
            gr.Button('💾 Save', elem_id='sd-prompt-lab-save-button')
            gr.HTML('', elem_id='sd-prompt-lab-output-html')
