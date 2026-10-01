import gradio as gr


def ui_tab_settings():
    gr.HTML("""
        <div id="sd-prompt-lab-settings-root" class="spl-set">
            <section class="spl-set-panel spl-set-words">
                <div class="spl-set-panel-header">
                    <div class="spl-set-title">
                        <span class="material-symbols-rounded" aria-hidden="true">spellcheck</span>
                        <span>Autocompletion prompts</span>
                    </div>
                    <div id="spl-set-words-count" class="spl-set-count"></div>
                </div>
                <div class="spl-set-hint">
                    Words suggested while typing in the editors. They are collected from the
                    prompts you save.
                </div>
                <label class="spl-set-filter-wrap">
                    <span class="material-symbols-rounded" aria-hidden="true">search</span>
                    <input id="spl-set-words-filter" class="spl-set-filter"
                           placeholder="Filter prompts" autocomplete="off">
                </label>
                <div id="spl-set-words-list" class="spl-set-words-list"></div>
            </section>

            <section class="spl-set-panel spl-set-general">
                <div class="spl-set-panel-header">
                    <div class="spl-set-title">
                        <span class="material-symbols-rounded" aria-hidden="true">tune</span>
                        <span>General</span>
                    </div>
                </div>

                <div class="spl-set-row">
                    <div class="spl-set-row-text">
                        <div class="spl-set-row-title">Spell check</div>
                        <div class="spl-set-row-desc">
                            Underline misspelled words in the prompt editors.
                        </div>
                    </div>
                    <label class="spl-set-switch">
                        <input id="spl-set-spell-check" type="checkbox">
                        <span class="spl-set-switch-track" aria-hidden="true">
                            <span class="spl-set-switch-knob"></span>
                        </span>
                    </label>
                </div>

                <div class="spl-set-row">
                    <div class="spl-set-row-text">
                        <div class="spl-set-row-title">Keep underscores in completed tags</div>
                        <div class="spl-set-row-desc">
                            Off: tags are inserted as <code>long hair</code> with parentheses
                            escaped. On: exactly as in the tag dataset, <code>long_hair</code>.
                        </div>
                    </div>
                    <label class="spl-set-switch">
                        <input id="spl-set-tag-underscores" type="checkbox">
                        <span class="spl-set-switch-track" aria-hidden="true">
                            <span class="spl-set-switch-knob"></span>
                        </span>
                    </label>
                </div>

                <div class="spl-set-row">
                    <div class="spl-set-row-text">
                        <div class="spl-set-row-title">Clean autocompletion prompts</div>
                        <div class="spl-set-row-desc">
                            Remove every saved autocompletion prompt. Saved prompts in
                            Browse are not affected.
                        </div>
                    </div>
                    <button type="button" id="spl-set-words-clear" class="spl-set-btn spl-set-btn-danger">
                        <span class="material-symbols-rounded" aria-hidden="true">delete_sweep</span>
                        <span>Clean</span>
                    </button>
                </div>

                <div id="spl-set-status" class="spl-set-status"></div>
            </section>

            <div id="spl-set-clear-dialog" class="spl-set-dialog-backdrop" hidden>
                <div class="spl-set-dialog">
                    <div class="spl-set-dialog-title">
                        <span class="material-symbols-rounded" aria-hidden="true">warning</span>
                        Clean autocompletion prompts?
                    </div>
                    <div class="spl-set-dialog-msg">
                        This removes all saved autocompletion prompts. This cannot be undone.
                    </div>
                    <div class="spl-set-dialog-actions">
                        <button type="button" id="spl-set-clear-cancel" class="spl-set-btn">Cancel</button>
                        <button type="button" id="spl-set-clear-confirm" class="spl-set-btn spl-set-btn-danger-solid">Clean</button>
                    </div>
                </div>
            </div>
        </div>
    """)
