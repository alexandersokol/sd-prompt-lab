import gradio as gr


def ui_tab_wildcard_editor():
    gr.HTML("""
        <div id="sd-prompt-lab-wildcard-editor-root" class="spl-ide">
            <aside class="spl-ide-sidebar">
                <div class="spl-ide-sidebar-header">
                    <div class="spl-ide-title">
                        <span class="material-symbols-rounded" aria-hidden="true">account_tree</span>
                        <span>Explorer</span>
                    </div>
                    <div class="spl-ide-actions">
                        <button class="spl-icon-button" id="sd-prompt-lab-wildcard-editor-new-file" title="New file" aria-label="New file">
                            <span class="material-symbols-rounded" aria-hidden="true">note_add</span>
                        </button>
                        <button class="spl-icon-button" id="sd-prompt-lab-wildcard-editor-new-folder" title="New folder" aria-label="New folder">
                            <span class="material-symbols-rounded" aria-hidden="true">create_new_folder</span>
                        </button>
                        <button class="spl-icon-button" id="sd-prompt-lab-wildcard-editor-refresh" title="Refresh" aria-label="Refresh">
                            <span class="material-symbols-rounded" aria-hidden="true">refresh</span>
                        </button>
                    </div>
                </div>
                <label class="spl-ide-search-wrap">
                    <span class="material-symbols-rounded" aria-hidden="true">search</span>
                    <input id="sd-prompt-lab-wildcard-editor-search" class="spl-ide-search" placeholder="Search files">
                </label>
                <div id="sd-prompt-lab-wildcard-editor-tree" class="spl-ide-tree"></div>
            </aside>
            <main class="spl-ide-main">
                <div class="spl-ide-topbar">
                    <div id="sd-prompt-lab-wildcard-editor-path" class="spl-ide-path">No file selected</div>
                    <label class="spl-ide-autosave">
                        <input id="sd-prompt-lab-wildcard-editor-autosave" type="checkbox" checked>
                        <span>Autosave</span>
                    </label>
                    <div class="spl-ide-toolbar">
                        <button class="spl-icon-button" id="sd-prompt-lab-wildcard-editor-save" title="Save" aria-label="Save">
                            <span class="material-symbols-rounded" aria-hidden="true">save</span>
                        </button>
                        <button class="spl-icon-button" id="sd-prompt-lab-wildcard-editor-rename" title="Rename" aria-label="Rename">
                            <span class="material-symbols-rounded" aria-hidden="true">drive_file_rename_outline</span>
                        </button>
                        <button class="spl-icon-button spl-danger-button" id="sd-prompt-lab-wildcard-editor-delete" title="Delete" aria-label="Delete">
                            <span class="material-symbols-rounded" aria-hidden="true">delete</span>
                        </button>
                    </div>
                </div>
                <div id="sd-prompt-lab-wildcard-editor-tabs" class="spl-ide-tabs"></div>
                <div id="sd-prompt-lab-wildcard-editor-host" class="spl-ide-editor-host">
                    <div class="spl-ide-empty">Open a wildcard file from the explorer</div>
                </div>
                <div id="sd-prompt-lab-wildcard-editor-status" class="spl-ide-status">Ready</div>
            </main>
            <div id="sd-prompt-lab-wildcard-editor-dialog" class="spl-dialog-backdrop" hidden>
                <form class="spl-dialog" id="sd-prompt-lab-wildcard-editor-dialog-form">
                    <div class="spl-dialog-icon">
                        <span class="material-symbols-rounded" id="sd-prompt-lab-wildcard-editor-dialog-icon" aria-hidden="true">edit_note</span>
                    </div>
                    <div class="spl-dialog-body">
                        <div class="spl-dialog-title" id="sd-prompt-lab-wildcard-editor-dialog-title">Create file</div>
                        <div class="spl-dialog-message" id="sd-prompt-lab-wildcard-editor-dialog-message"></div>
                        <input id="sd-prompt-lab-wildcard-editor-dialog-input" class="spl-dialog-input" autocomplete="off">
                        <div class="spl-dialog-actions">
                            <button type="button" class="spl-dialog-cancel" id="sd-prompt-lab-wildcard-editor-dialog-cancel">Cancel</button>
                            <button type="submit" class="spl-dialog-submit" id="sd-prompt-lab-wildcard-editor-dialog-submit">Create</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    """)
