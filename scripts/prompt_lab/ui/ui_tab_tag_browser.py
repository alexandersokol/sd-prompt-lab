import gradio as gr


def ui_tab_tag_browser():
    gr.HTML("""
        <div id="sd-prompt-lab-tag-browser-root" class="spl-tags">
            <div id="sd-prompt-lab-tags-empty" class="spl-tags-empty" hidden>
                <span class="material-symbols-rounded" aria-hidden="true">database</span>
                <div class="spl-tags-empty-title">No tag datasets found</div>
                <div class="spl-tags-empty-hint">
                    Add <code>.jsonl</code>, <code>.json</code> or <code>.csv</code> tag files
                    anywhere under the <code>datasets/</code> directory, then press refresh.
                </div>
                <div class="spl-tags-empty-actions">
                    <button id="sd-prompt-lab-tags-empty-add" class="spl-tags-btn spl-tags-btn-primary">
                        <span class="material-symbols-rounded" aria-hidden="true">cloud_download</span>
                        Add from Hugging Face
                    </button>
                    <button id="sd-prompt-lab-tags-empty-refresh" class="spl-tags-btn">
                        <span class="material-symbols-rounded" aria-hidden="true">refresh</span>
                        Refresh
                    </button>
                </div>
            </div>

            <div id="sd-prompt-lab-tags-main" class="spl-tags-main" hidden>
                <div class="spl-tags-toolbar">
                    <label class="spl-tags-field">
                        <span class="spl-tags-field-label">Source</span>
                        <select id="sd-prompt-lab-tags-source" class="spl-tags-select"></select>
                    </label>
                    <label class="spl-tags-search-wrap">
                        <span class="material-symbols-rounded" aria-hidden="true">search</span>
                        <input id="sd-prompt-lab-tags-search" class="spl-tags-search"
                               placeholder="Search tags" autocomplete="off">
                    </label>
                    <label class="spl-tags-field">
                        <span class="spl-tags-field-label">Sort</span>
                        <select id="sd-prompt-lab-tags-sort" class="spl-tags-select">
                            <option value="post_count">Popularity</option>
                            <option value="name">Name (A–Z)</option>
                            <option value="post_count_asc">Least used</option>
                        </select>
                    </label>
                    <label class="spl-tags-toggle">
                        <input id="sd-prompt-lab-tags-deprecated" type="checkbox">
                        <span>Show deprecated</span>
                    </label>
                    <div id="sd-prompt-lab-tags-count" class="spl-tags-count"></div>
                    <button id="sd-prompt-lab-tags-add" class="spl-tags-btn" title="Download a dataset from Hugging Face">
                        <span class="material-symbols-rounded" aria-hidden="true">cloud_download</span>
                        Add dataset
                    </button>
                </div>

                <div id="sd-prompt-lab-tags-categories" class="spl-tags-categories"></div>

                <div class="spl-tags-body">
                    <div id="sd-prompt-lab-tags-list" class="spl-tags-list"></div>
                    <aside id="sd-prompt-lab-tags-detail" class="spl-tags-detail" hidden>
                        <div class="spl-tags-detail-header">
                            <div id="sd-prompt-lab-tags-detail-name" class="spl-tags-detail-name"></div>
                            <button id="sd-prompt-lab-tags-detail-close" class="spl-tags-icon-btn"
                                    title="Close" aria-label="Close">
                                <span class="material-symbols-rounded" aria-hidden="true">close</span>
                            </button>
                        </div>
                        <div id="sd-prompt-lab-tags-detail-body" class="spl-tags-detail-body"></div>
                    </aside>
                </div>

                <div id="sd-prompt-lab-tags-status" class="spl-tags-status">Ready</div>
            </div>

            <div id="sd-prompt-lab-tags-dialog" class="spl-tags-dialog-backdrop" hidden>
                <form id="sd-prompt-lab-tags-dialog-form" class="spl-tags-dialog">
                    <div class="spl-tags-dialog-title">
                        <span class="material-symbols-rounded" aria-hidden="true">cloud_download</span>
                        Add dataset from Hugging Face
                    </div>
                    <div class="spl-tags-dialog-msg">
                        Paste a Hugging Face dataset link. The tag file
                        (<code>.jsonl</code> preferred, otherwise <code>.json</code> or
                        <code>.csv</code>) is downloaded into <code>datasets/&lt;name&gt;/</code>
                        and added to the browser.
                    </div>
                    <input id="sd-prompt-lab-tags-dialog-input" class="spl-tags-dialog-input"
                           placeholder="https://huggingface.co/datasets/owner/name" autocomplete="off">
                    <div id="sd-prompt-lab-tags-dialog-status" class="spl-tags-dialog-status"></div>
                    <div class="spl-tags-dialog-actions">
                        <button type="button" id="sd-prompt-lab-tags-dialog-cancel"
                                class="spl-tags-btn">Cancel</button>
                        <button type="submit" id="sd-prompt-lab-tags-dialog-submit"
                                class="spl-tags-btn spl-tags-btn-primary">Download</button>
                    </div>
                </form>
            </div>
        </div>
    """)
