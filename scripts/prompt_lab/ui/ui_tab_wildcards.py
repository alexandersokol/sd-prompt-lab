import gradio as gr

from modules import ui_components


def ui_tab_wildcards():
    with gr.Row():
        with gr.Column(scale=4):
            with gr.Row():
                gr.Textbox(
                    label="Search wildcards...",
                    elem_id="sd-prompt-lab-wildcards-search-input",
                    placeholder="Type to search in file tree..."
                )
            gr.HTML(
                "",
                elem_id="sd-prompt-lab-wildcards-tree",
            )

        with gr.Column(scale=5):
            with gr.Row():
                gr.Textbox(
                    label="Wildcard Name",
                    elem_id="sd-prompt-lab-wildcards-selected-name",
                    interactive=False
                )
                ui_components.ToolButton(value='💾',
                                         elem_id="sd-prompt-lab-wildcards-save-button",
                                         tooltip="Save file changes")
                ui_components.ToolButton(value='🗑',
                                         elem_id="sd-prompt-lab-wildcards-remove-button",
                                         tooltip="Remove file")

            gr.TextArea(
                label="Wildcard Content",
                elem_id="sd-prompt-lab-wildcards-content",
                lines=30,
                max_lines=150,
                interactive=True
            )
            with gr.Row():
                gr.Textbox(
                    label="New Wildcard File (with optional folders)",
                    elem_id="sd-prompt-lab-wildcards-newfile-input",
                    placeholder="example: characters/heroes/new_file.txt"
                )
                ui_components.ToolButton(value='✅',
                                         elem_id="sd-prompt-lab-wildcards-create-button",
                                         tooltip="Create new wildcard file")
            gr.HTML(
                "",
                elem_id="sd-prompt-lab-wildcards-output-html"
            )

            gr.HTML()
            gr.HTML()
            with gr.Row():
                gr.Button('Extract duplicated', elem_id="sd-prompt-lab-wildcards-remove-duplicates-button", )
                gr.Button('Clear Up', elem_id="sd-prompt-lab-wildcards-clear-up-button", )
