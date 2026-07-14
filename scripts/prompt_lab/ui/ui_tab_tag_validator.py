import gradio as gr


def ui_tab_tag_validator():
    gr.HTML("""
        <div id="sd-prompt-lab-tag-validator-root" class="spl-tv">
            <div class="spl-tv-toolbar">
                <div class="spl-tv-toolbar-left">
                    <button id="spl-tv-import" class="spl-tv-btn spl-tv-btn-primary" title="Import prompts">
                        <span class="material-symbols-rounded" aria-hidden="true">add</span>
                        <span>Import</span>
                    </button>
                    <button id="spl-tv-export" class="spl-tv-btn" title="Export prompts">
                        <span class="material-symbols-rounded" aria-hidden="true">ios_share</span>
                        <span>Export</span>
                    </button>
                    <button id="spl-tv-clear" class="spl-tv-btn spl-tv-btn-danger" title="Clear all cards">
                        <span class="material-symbols-rounded" aria-hidden="true">delete</span>
                        <span>Clear</span>
                    </button>
                    <div class="spl-tv-counts">
                        <button id="spl-tv-counter-approved" type="button"
                                class="spl-tv-count spl-tv-count-approved spl-tv-count-btn"
                                title="Manage approved tags">
                            <span class="material-symbols-rounded" aria-hidden="true">check_circle</span>
                            <span id="spl-tv-count-approved">0</span>
                        </button>
                        <button id="spl-tv-counter-declined" type="button"
                                class="spl-tv-count spl-tv-count-declined spl-tv-count-btn"
                                title="Manage declined tags">
                            <span class="material-symbols-rounded" aria-hidden="true">cancel</span>
                            <span id="spl-tv-count-declined">0</span>
                        </button>
                    </div>
                </div>

                <div id="spl-tv-card-controls" class="spl-tv-toolbar-right" hidden>
                    <button id="spl-tv-undo" class="spl-tv-btn spl-tv-btn-icon" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled>
                        <span class="material-symbols-rounded" aria-hidden="true">undo</span>
                    </button>
                    <button id="spl-tv-redo" class="spl-tv-btn spl-tv-btn-icon" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" disabled>
                        <span class="material-symbols-rounded" aria-hidden="true">redo</span>
                    </button>
                    <div class="spl-tv-mode-switch" role="tablist">
                        <button id="spl-tv-mode-tags" class="spl-tv-mode-btn is-active" role="tab">
                            <span class="material-symbols-rounded" aria-hidden="true">sell</span>
                            <span>Tags</span>
                        </button>
                        <button id="spl-tv-mode-text" class="spl-tv-mode-btn" role="tab">
                            <span class="material-symbols-rounded" aria-hidden="true">edit_note</span>
                            <span>Text</span>
                        </button>
                    </div>
                    <button id="spl-tv-cleanup" class="spl-tv-btn" title="Remove declined tags and broken commas from this prompt">
                        <span class="material-symbols-rounded" aria-hidden="true">filter_alt_off</span>
                        <span>Clean-up</span>
                    </button>
                    <button id="spl-tv-fix" class="spl-tv-btn" title="Auto-fix issues (dangling commas, brackets, weights, prose, BREAK, lora)">
                        <span class="material-symbols-rounded" aria-hidden="true">auto_fix_high</span>
                        <span>Fix</span>
                    </button>
                    <button id="spl-tv-approve" class="spl-tv-btn spl-tv-btn-approve" title="Approve this card">
                        <span class="material-symbols-rounded" aria-hidden="true">check</span>
                        <span id="spl-tv-approve-label">Approve</span>
                    </button>
                    <button id="spl-tv-remove-card" class="spl-tv-btn spl-tv-btn-danger" title="Remove this card">
                        <span class="material-symbols-rounded" aria-hidden="true">delete</span>
                        <span>Remove</span>
                    </button>
                </div>
            </div>

            <div class="spl-tv-body">
                <aside id="spl-tv-cards" class="spl-tv-cards">
                    <div id="spl-tv-cards-empty" class="spl-tv-cards-empty">
                        <span class="material-symbols-rounded" aria-hidden="true">inbox</span>
                        <div>No prompts yet</div>
                        <div class="spl-tv-cards-empty-hint">Use <b>Import</b> to add prompts.</div>
                    </div>
                    <div id="spl-tv-cards-list" class="spl-tv-cards-list"></div>
                </aside>

                <main id="spl-tv-main" class="spl-tv-main">
                    <div id="spl-tv-main-empty" class="spl-tv-main-empty">
                        <span class="material-symbols-rounded" aria-hidden="true">ads_click</span>
                        <div>Select a prompt card to edit it.</div>
                    </div>
                    <div id="spl-tv-main-body" class="spl-tv-main-body" hidden>
                        <div id="spl-tv-issues" class="spl-tv-issues"></div>
                        <div id="spl-tv-chips" class="spl-tv-chips"></div>
                        <div id="spl-tv-text-host" class="spl-tv-text-host" hidden></div>
                    </div>
                </main>
            </div>

            <!-- Import dialog -->
            <div id="spl-tv-import-dialog" class="spl-tv-dialog-backdrop" hidden>
                <div class="spl-tv-dialog">
                    <div class="spl-tv-dialog-header">
                        <div class="spl-tv-dialog-title">
                            <span class="material-symbols-rounded" aria-hidden="true">add</span>
                            Import prompts
                        </div>
                    </div>
                    <div class="spl-tv-dialog-msg">
                        Paste one or more prompts. Separate prompts with a blank line (two or more
                        newlines) to create multiple cards.
                    </div>
                    <textarea id="spl-tv-import-text" class="spl-tv-textarea"
                              placeholder="1girl, solo, blue hair, ...&#10;&#10;another prompt, ..."></textarea>
                    <div class="spl-tv-dialog-actions">
                        <button id="spl-tv-import-cancel" class="spl-tv-btn">Cancel</button>
                        <button id="spl-tv-import-add" class="spl-tv-btn spl-tv-btn-primary">Add</button>
                    </div>
                </div>
            </div>

            <!-- Export dialog -->
            <div id="spl-tv-export-dialog" class="spl-tv-dialog-backdrop" hidden>
                <div class="spl-tv-dialog">
                    <div class="spl-tv-dialog-header">
                        <div class="spl-tv-dialog-title">
                            <span class="material-symbols-rounded" aria-hidden="true">ios_share</span>
                            Export prompts
                        </div>
                        <label class="spl-tv-switch">
                            <input id="spl-tv-export-approved" type="checkbox">
                            <span class="spl-tv-switch-track" aria-hidden="true">
                                <span class="spl-tv-switch-knob"></span>
                            </span>
                            <span>Approved only</span>
                        </label>
                    </div>
                    <textarea id="spl-tv-export-text" class="spl-tv-textarea" readonly></textarea>
                    <div class="spl-tv-dialog-actions">
                        <button id="spl-tv-export-copy" class="spl-tv-btn spl-tv-btn-primary">
                            <span class="material-symbols-rounded" aria-hidden="true">content_copy</span>
                            <span>Copy</span>
                        </button>
                        <button id="spl-tv-export-close" class="spl-tv-btn">Close</button>
                    </div>
                </div>
            </div>

            <!-- Remove single card confirm dialog -->
            <div id="spl-tv-remove-dialog" class="spl-tv-dialog-backdrop" hidden>
                <div class="spl-tv-dialog spl-tv-dialog-sm">
                    <div class="spl-tv-dialog-header">
                        <div class="spl-tv-dialog-title">
                            <span class="material-symbols-rounded" aria-hidden="true">delete</span>
                            Remove this card?
                        </div>
                    </div>
                    <div class="spl-tv-dialog-msg">
                        This removes the currently opened prompt card. This cannot be undone.
                    </div>
                    <div class="spl-tv-dialog-actions">
                        <button id="spl-tv-remove-cancel" class="spl-tv-btn">Cancel</button>
                        <button id="spl-tv-remove-confirm" class="spl-tv-btn spl-tv-btn-danger">Remove card</button>
                    </div>
                </div>
            </div>

            <!-- Clear confirm dialog -->
            <div id="spl-tv-clear-dialog" class="spl-tv-dialog-backdrop" hidden>
                <div class="spl-tv-dialog spl-tv-dialog-sm">
                    <div class="spl-tv-dialog-header">
                        <div class="spl-tv-dialog-title">
                            <span class="material-symbols-rounded" aria-hidden="true">warning</span>
                            Clear all cards?
                        </div>
                    </div>
                    <div class="spl-tv-dialog-msg">
                        This removes every prompt card. Your approved and declined tags are kept.
                        This cannot be undone.
                    </div>
                    <div class="spl-tv-dialog-actions">
                        <button id="spl-tv-clear-cancel" class="spl-tv-btn">Cancel</button>
                        <button id="spl-tv-clear-confirm" class="spl-tv-btn spl-tv-btn-danger">Clear cards</button>
                    </div>
                </div>
            </div>

            <!-- Manage approved / declined tags dialog -->
            <div id="spl-tv-tags-dialog" class="spl-tv-dialog-backdrop" hidden>
                <div class="spl-tv-dialog">
                    <div class="spl-tv-dialog-header">
                        <div id="spl-tv-tags-dialog-title" class="spl-tv-dialog-title">Approved tags</div>
                        <button id="spl-tv-tags-close" class="spl-tv-btn spl-tv-btn-icon"
                                title="Close" aria-label="Close">
                            <span class="material-symbols-rounded" aria-hidden="true">close</span>
                        </button>
                    </div>
                    <label class="spl-tv-tags-filter-wrap">
                        <span class="material-symbols-rounded" aria-hidden="true">search</span>
                        <input id="spl-tv-tags-filter" class="spl-tv-tags-filter"
                               placeholder="Filter tags by name" autocomplete="off">
                    </label>
                    <div id="spl-tv-tags-list" class="spl-tv-tags-manage-list"></div>
                </div>
            </div>
        </div>
    """)
