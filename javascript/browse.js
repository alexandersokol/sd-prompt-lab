// Browse tab: saved prompts as cards, with search, sort, favourites and paging.
(() => {
    const API = '/sd-prompt-lab';
    const PAGE_SIZE = 40;
    const EXCERPT_CHARS = 1200;

    const state = {
        initialized: false,
        search: '',
        sort: 'newest',
        favorites: false,
        offset: 0,
        total: 0,
        loading: false,
        done: false,
        seq: 0,
        prompts: new Map(),   // id -> prompt, for the card buttons
    };

    const ids = {
        root: 'sd-prompt-lab-browse-root',
        search: 'sd-prompt-lab-browse-search',
        sort: 'sd-prompt-lab-browse-sort',
        favorites: 'sd-prompt-lab-browse-favorites',
        count: 'sd-prompt-lab-browse-count',
        refresh: 'sd-prompt-lab-browse-refresh',
        grid: 'sd-prompt-lab-browse-grid',
        empty: 'sd-prompt-lab-browse-empty',
        more: 'sd-prompt-lab-browse-more',
    };

    const $ = (id) => gradioApp()?.getElementById(id);
    const escapeHtml = (value) => window.spl.escapeHtml(value);

    function highlight(text) {
        const excerpt = String(text ?? '').slice(0, EXCERPT_CHARS);
        return typeof window.sdPromptLabHighlightHtml === 'function'
            ? window.sdPromptLabHighlightHtml(excerpt)
            : escapeHtml(excerpt);
    }

    function iconButton(action, icon, label) {
        return `<button type="button" class="spl-card-btn" data-action="${action}" title="${label}" aria-label="${label}">`
            + `<span class="material-symbols-rounded" aria-hidden="true">${icon}</span></button>`;
    }

    function cardHtml(p) {
        // image_version is set only when the image file exists.
        const thumb = p.image_version
            ? `<img class="spl-card-thumb" loading="lazy" alt="" src="${API}/thumbnail/${p.id}?v=${p.image_version || 0}">`
            : '';
        return `
            <article class="spl-card${p.is_favorite ? ' is-favorite' : ''}" data-id="${p.id}">
                <div class="spl-card-header">
                    <h3 class="spl-card-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
                    <button type="button" class="spl-card-fav" data-action="favorite"
                            aria-pressed="${p.is_favorite ? 'true' : 'false'}"
                            title="${p.is_favorite ? 'Remove from favourites' : 'Add to favourites'}"
                            aria-label="Favourite">
                        <span class="material-symbols-rounded" aria-hidden="true">favorite</span>
                    </button>
                </div>
                <div class="spl-card-desc" title="${escapeHtml(p.description || '')}">${escapeHtml(p.description || '')}</div>
                <div class="spl-card-body">
                    <div class="spl-card-prompt" data-action="preview" title="Click to preview">
                        <div class="spl-card-prompt-text spl-highlight">${highlight(p.prompt)}</div>
                    </div>
                    ${thumb}
                </div>
                <div class="spl-card-actions">
                    <button type="button" class="spl-card-btn spl-card-btn-wide" data-action="txt2img" title="Send to txt2img">
                        <span class="material-symbols-rounded" aria-hidden="true">image</span><span>txt2img</span>
                    </button>
                    ${iconButton('preview', 'visibility', 'Preview')}
                    ${iconButton('edit', 'edit', 'Edit')}
                    ${iconButton('copy', 'content_copy', 'Copy prompt')}
                    <span class="spl-card-spacer"></span>
                    ${iconButton('remove', 'delete', 'Delete')}
                </div>
            </article>`;
    }

    function renderEmpty() {
        const empty = $(ids.empty);
        if (!empty) return;
        empty.hidden = state.total > 0;
        if (state.total > 0) return;
        const filtered = state.search || state.favorites;
        empty.innerHTML = `
            <span class="material-symbols-rounded" aria-hidden="true">${filtered ? 'search' : 'inbox'}</span>
            <div class="spl-browse-empty-title">${filtered ? 'No prompts match' : 'No prompts saved yet'}</div>
            <div>${filtered
                ? 'Try a different search, or turn off the Favourites filter.'
                : 'Write a prompt in the Create tab and press Save.'}</div>`;
    }

    async function loadPage(reset) {
        const grid = $(ids.grid);
        if (!grid) return;
        if (!reset && (state.loading || state.done)) return;

        const seq = ++state.seq;
        const offset = reset ? 0 : state.offset;
        state.loading = true;
        try {
            const params = new URLSearchParams({sort: state.sort, limit: PAGE_SIZE, offset});
            if (state.search) params.set('search', state.search);
            if (state.favorites) params.set('favorites', 'true');
            const response = await fetch(`${API}/all?${params}`);
            if (!response.ok) throw new Error('Failed to load prompts');
            const data = await response.json();
            if (seq !== state.seq) return;   // superseded by a newer request

            const prompts = data.prompts || [];
            if (reset) {
                grid.innerHTML = '';
                state.prompts.clear();
            }
            prompts.forEach((p) => state.prompts.set(String(p.id), p));
            grid.insertAdjacentHTML('beforeend', prompts.map(cardHtml).join(''));

            state.total = data.total ?? prompts.length;
            state.offset = offset + prompts.length;
            state.done = prompts.length < PAGE_SIZE || state.offset >= state.total;

            const count = $(ids.count);
            if (count) count.textContent = `${state.total.toLocaleString()} prompt${state.total === 1 ? '' : 's'}`;
            renderEmpty();
        } catch (e) {
            if (seq === state.seq) window.spl.toast(e.message, 'error');
        } finally {
            if (seq === state.seq) state.loading = false;
        }
    }

    const reload = () => loadPage(true);

    // ---- card actions ----------------------------------------------------------------

    async function toggleFavorite(prompt) {
        const next = !prompt.is_favorite;
        const response = await fetch(`${API}/favorite/${prompt.id}?is_favorite=${next}`, {method: 'POST'});
        if (!response.ok) throw new Error('Failed to update favourite');
        await reload();   // favourites sort first, so the order may change
    }

    async function removePrompt(prompt) {
        const confirmed = await window.spl.confirm({
            title: 'Delete this prompt?',
            message: `"${prompt.name}" will be removed. This cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!confirmed) return;
        const response = await fetch(`${API}/delete/${prompt.id}`, {method: 'DELETE'});
        if (!response.ok) throw new Error('Failed to delete prompt');
        window.spl.toast('Prompt deleted');
        await reload();
    }

    async function editPrompt(prompt) {
        if (!await confirmDiscardCreateChanges()) return;
        const response = await fetch(`${API}/${prompt.id}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status !== 'ok') throw new Error('Failed to load prompt data');
        fillCreateTabFields({...data.prompt, image_version: prompt.image_version});
        switchToCreateTab();
    }

    async function onCardAction(action, prompt) {
        if (action === 'preview') {
            window.sdPromptLabShowPreview?.(prompt);
        } else if (action === 'txt2img') {
            updateTxt2ImgPositivePrompt(prompt.prompt || '');
        } else if (action === 'copy') {
            const ok = await window.spl.copyToClipboard(prompt.prompt || '');
            window.spl.toast(ok ? 'Prompt copied' : 'Failed to copy', ok ? 'ok' : 'error');
        } else if (action === 'edit') {
            await editPrompt(prompt);
        } else if (action === 'favorite') {
            await toggleFavorite(prompt);
        } else if (action === 'remove') {
            await removePrompt(prompt);
        }
    }

    // ---- wiring ----------------------------------------------------------------------

    let searchTimer = null;

    function wireEvents() {
        const search = $(ids.search);
        search?.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.search = search.value.trim();
                reload();
            }, 250);
        });
        // Gradio treats Enter in a text field as "submit"; keep it local.
        search?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') event.stopPropagation();
        });

        $(ids.sort)?.addEventListener('change', (event) => {
            state.sort = event.target.value;
            reload();
        });

        $(ids.favorites)?.addEventListener('click', (event) => {
            state.favorites = !state.favorites;
            event.currentTarget.setAttribute('aria-pressed', String(state.favorites));
            reload();
        });

        $(ids.refresh)?.addEventListener('click', reload);

        $(ids.grid)?.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            const card = event.target.closest('.spl-card');
            const prompt = card && state.prompts.get(card.dataset.id);
            if (!target || !prompt) return;
            onCardAction(target.dataset.action, prompt).catch((e) => window.spl.toast(e.message, 'error'));
        });

        // Load the next page when the end of the grid scrolls into view.
        const more = $(ids.more);
        if (more && 'IntersectionObserver' in window) {
            new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting)) loadPage(false);
            }, {rootMargin: '400px'}).observe(more);
        }
    }

    async function open() {
        if (!$(ids.root)) return;
        // Asked for on every visit: a stylesheet that failed to load is retried.
        window.spl.loadStyle('sd-prompt-lab-browse-style', 'javascript/browse.css').catch((e) => console.error(e));
        if (!state.initialized) {
            state.initialized = true;
            wireEvents();
            // The highlighter ships in the editor bundle; cards fall back to plain text without it.
            await window.spl.loadCodeMirror().catch((e) => console.error(e));
        }
        await reload();
    }

    // Called after a save in the Create tab.
    window.sdPromptLabReloadBrowse = () => {
        if (state.initialized) reload();
    };

    onUiLoaded(() => {
        window.spl.onTabOpened('sd-prompt-lab-browse-tab', () => open());
    });
})();
