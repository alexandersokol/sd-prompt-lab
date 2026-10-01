import gradio as gr


def ui_tab_browse():
    gr.HTML("""
        <div id="sd-prompt-lab-browse-root" class="spl-theme spl-browse">
            <div class="spl-browse-toolbar">
                <label class="spl-browse-search">
                    <span class="material-symbols-rounded" aria-hidden="true">search</span>
                    <input id="sd-prompt-lab-browse-search" placeholder="Search name, description or prompt"
                           autocomplete="off">
                </label>
                <label class="spl-browse-sort">
                    <span class="spl-browse-sort-label">Sort</span>
                    <select id="sd-prompt-lab-browse-sort">
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="name">Name (A–Z)</option>
                    </select>
                </label>
                <button type="button" id="sd-prompt-lab-browse-favorites" class="spl-btn" aria-pressed="false"
                        title="Show favourites only">
                    <span class="material-symbols-rounded" aria-hidden="true">favorite</span>
                    <span>Favourites</span>
                </button>
                <div id="sd-prompt-lab-browse-count" class="spl-browse-count"></div>
                <button type="button" id="sd-prompt-lab-browse-refresh" class="spl-btn spl-btn-icon"
                        title="Refresh" aria-label="Refresh">
                    <span class="material-symbols-rounded" aria-hidden="true">refresh</span>
                </button>
            </div>

            <div id="sd-prompt-lab-browse-grid" class="spl-browse-grid"></div>
            <div id="sd-prompt-lab-browse-empty" class="spl-browse-empty" hidden></div>
            <div id="sd-prompt-lab-browse-more" class="spl-browse-more" aria-hidden="true"></div>
        </div>
    """)
