import gradio as gr


def ui_tab_create():
    gr.HTML("""
        <div id="sd-prompt-lab-create-root" class="spl-theme spl-create">
            <div class="spl-create-editor">
                <textarea id="code-editor"></textarea>
            </div>

            <aside class="spl-create-panel">
                <label class="spl-field">
                    <span class="spl-field-label">Name</span>
                    <input id="sd-prompt-lab-name-input" class="spl-input" autocomplete="off"
                           placeholder="Prompt name">
                </label>

                <label class="spl-field">
                    <span class="spl-field-label">Description</span>
                    <textarea id="sd-prompt-lab-description-input" class="spl-input" rows="2"
                              placeholder="Optional"></textarea>
                </label>

                <div class="spl-field">
                    <span class="spl-field-label">Image</span>
                    <div id="sd-prompt-lab-image-current" class="spl-create-image" hidden>
                        <img id="sd-prompt-lab-image-preview" alt="Current prompt image">
                        <div class="spl-create-image-info">
                            <div id="sd-prompt-lab-image-state">Current image</div>
                            <button type="button" id="sd-prompt-lab-image-remove" class="spl-link-btn">Remove</button>
                        </div>
                    </div>
                    <input id="sd-prompt-lab-image-path-input" class="spl-input" autocomplete="off"
                           placeholder="File path or image URL (optional)">
                </div>

                <label class="spl-switch-row" title="Replace the saved prompt that has this name">
                    <input id="sd-prompt-lab-override-checkbox" type="checkbox">
                    <span class="spl-switch" aria-hidden="true"><span class="spl-switch-knob"></span></span>
                    <span>Override existing</span>
                </label>

                <button type="button" id="sd-prompt-lab-save-button" class="spl-btn spl-btn-primary spl-btn-block"
                        title="Save (Ctrl/Cmd-S)">
                    <span class="material-symbols-rounded" aria-hidden="true">save</span>
                    <span>Save</span>
                </button>

                <div class="spl-btn-row">
                    <button type="button" id="sd-prompt-lab-txt2img-button" class="spl-btn" title="Send the prompt to txt2img">
                        <span class="material-symbols-rounded" aria-hidden="true">image</span>
                        <span>txt2img</span>
                    </button>
                    <button type="button" id="sd-prompt-lab-sample-button" class="spl-btn" title="Show random expansions of the prompt">
                        <span class="material-symbols-rounded" aria-hidden="true">casino</span>
                        <span>Sample</span>
                    </button>
                    <button type="button" id="sd-prompt-lab-clear-button" class="spl-btn spl-btn-danger" title="Clear all fields">
                        <span class="material-symbols-rounded" aria-hidden="true">delete</span>
                        <span>Clear</span>
                    </button>
                </div>

                <div class="spl-group">
                    <div class="spl-group-title">Prompt tools</div>
                    <div class="spl-btn-row">
                        <button type="button" id="sd-prompt-lab-reformat-button" class="spl-btn"
                                title="Tidy spacing and commas; keeps blocks, comments and line breaks">
                            <span class="material-symbols-rounded" aria-hidden="true">auto_fix_high</span>
                            <span>Reformat</span>
                        </button>
                        <button type="button" id="sd-prompt-lab-clean-up-button" class="spl-btn"
                                title="Reformat and remove duplicate tags">
                            <span class="material-symbols-rounded" aria-hidden="true">filter_alt_off</span>
                            <span>Clean up</span>
                        </button>
                    </div>
                </div>
            </aside>
        </div>
    """)
