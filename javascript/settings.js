(() => {
    const API = '/sd-prompt-lab';
    const PAGE_SIZE = 200;
    const SCROLL_THRESHOLD = 200;

    const state = {
        initialized: false,
        q: '',
        offset: 0,
        total: 0,
        loading: false,
        done: false,
        seq: 0,
        editingId: null,
    };

    const ids = {
        root: 'sd-prompt-lab-settings-root',
        count: 'spl-set-words-count',
        filter: 'spl-set-words-filter',
        list: 'spl-set-words-list',
        spellCheck: 'spl-set-spell-check',
        tagUnderscores: 'spl-set-tag-underscores',
        clear: 'spl-set-words-clear',
        status: 'spl-set-status',
        clearDialog: 'spl-set-clear-dialog',
        clearCancel: 'spl-set-clear-cancel',
        clearConfirm: 'spl-set-clear-confirm',
    };

    const $ = (id) => gradioApp()?.getElementById(id);

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    }

    function ensureAssets() {
        window.spl.loadStyle('sd-prompt-lab-settings-style', 'javascript/settings.css').catch((e) => console.error(e));
    }

    async function api(path, opts) {
        const res = await fetch(API + path, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `Request failed: ${res.status}`);
        return data;
    }

    function jsonBody(method, obj) {
        return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(obj)};
    }

    function setStatus(text, tone = 'neutral') {
        const el = $(ids.status);
        if (!el) return;
        el.textContent = text;
        el.dataset.tone = tone;
        clearTimeout(setStatus._t);
        if (text) setStatus._t = setTimeout(() => { el.textContent = ''; }, 4000);
    }

    // ---- autocompletion words --------------------------------------------

    function updateCount() {
        const el = $(ids.count);
        if (el) el.textContent = state.total.toLocaleString();
    }

    function wordRowHtml(w) {
        return `
            <div class="spl-set-word" data-id="${w.id}">
                <span class="spl-set-word-text">${escapeHtml(w.word)}</span>
                <span class="spl-set-word-actions">
                    <button type="button" class="spl-set-icon-btn" data-action="edit" title="Edit" aria-label="Edit">
                        <span class="material-symbols-rounded" aria-hidden="true">edit</span>
                    </button>
                    <button type="button" class="spl-set-icon-btn spl-set-icon-btn-danger" data-action="remove" title="Remove" aria-label="Remove">
                        <span class="material-symbols-rounded" aria-hidden="true">close</span>
                    </button>
                </span>
            </div>`;
    }

    function renderEmpty(list) {
        list.innerHTML = `<div class="spl-set-empty">${
            state.q ? 'No matching prompts.' : 'No autocompletion prompts saved yet.'}</div>`;
    }

    async function loadPage(reset) {
        if (state.loading && !reset) return;
        if (!reset && state.done) return;
        const list = $(ids.list);
        if (!list) return;

        const seq = ++state.seq;
        const offset = reset ? 0 : state.offset;
        state.loading = true;
        try {
            const p = new URLSearchParams({limit: PAGE_SIZE, offset});
            if (state.q) p.set('q', state.q);
            const data = await api(`/words?${p}`);
            if (seq !== state.seq) return;   // superseded by a newer filter

            const words = data.words || [];
            if (reset) {
                list.innerHTML = '';
                list.scrollTop = 0;
                state.editingId = null;
            }
            state.total = data.total || 0;
            state.offset = offset + words.length;
            state.done = words.length < PAGE_SIZE || state.offset >= state.total;
            updateCount();

            if (state.total === 0) renderEmpty(list);
            else list.insertAdjacentHTML('beforeend', words.map(wordRowHtml).join(''));
        } catch (e) {
            if (seq === state.seq) setStatus(e.message, 'error');
        } finally {
            if (seq === state.seq) state.loading = false;
        }
    }

    function startEdit(row) {
        if (state.editingId != null) cancelEdit();
        const textEl = row.querySelector('.spl-set-word-text');
        if (!textEl) return;
        state.editingId = row.dataset.id;
        row.classList.add('is-editing');
        row.dataset.original = textEl.textContent;

        const input = document.createElement('input');
        input.className = 'spl-set-word-input';
        input.value = textEl.textContent;
        input.autocomplete = 'off';
        textEl.replaceWith(input);
        input.focus();
        input.select();

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit(row).catch((err) => setStatus(err.message, 'error'));
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        });
        input.addEventListener('blur', () => {
            // Let a click on another row's button win before cancelling.
            setTimeout(() => {
                if (state.editingId === row.dataset.id) cancelEdit();
            }, 120);
        });
    }

    function finishEdit(row, text) {
        const input = row.querySelector('.spl-set-word-input');
        if (input) {
            const span = document.createElement('span');
            span.className = 'spl-set-word-text';
            span.textContent = text;
            input.replaceWith(span);
        }
        row.classList.remove('is-editing', 'has-error');
        row.removeAttribute('title');
        delete row.dataset.original;
        state.editingId = null;
    }

    function cancelEdit() {
        const row = $(ids.list)?.querySelector('.spl-set-word.is-editing');
        if (row) finishEdit(row, row.dataset.original || '');
        else state.editingId = null;
    }

    async function commitEdit(row) {
        const input = row.querySelector('.spl-set-word-input');
        if (!input) return;
        const word = input.value.trim();
        if (!word || word === row.dataset.original) {
            cancelEdit();
            return;
        }
        try {
            const data = await api(`/words/${row.dataset.id}`, jsonBody('PATCH', {word}));
            finishEdit(row, data.word || word);
            setStatus('Prompt updated', 'ok');
        } catch (e) {
            // Keep the input open so the user can fix a conflict.
            row.classList.add('has-error');
            row.title = e.message;
            setStatus(e.message, 'error');
            input.focus();
        }
    }

    async function removeWord(row) {
        await api(`/words/${row.dataset.id}`, {method: 'DELETE'});
        row.remove();
        state.total = Math.max(0, state.total - 1);
        state.offset = Math.max(0, state.offset - 1);
        updateCount();
        const list = $(ids.list);
        if (list && state.total === 0) renderEmpty(list);
    }

    async function clearWords() {
        $(ids.clearDialog).hidden = true;
        await api('/words/clear', {method: 'POST'});
        setStatus('Autocompletion prompts removed', 'ok');
        await loadPage(true);
    }

    // ---- general settings ------------------------------------------------

    async function loadSettings() {
        const settings = await api('/settings');
        const spell = $(ids.spellCheck);
        if (spell) spell.checked = settings.spell_check !== false;
        const underscores = $(ids.tagUnderscores);
        if (underscores) underscores.checked = settings.tag_underscores === true;
    }

    async function saveSetting(key, value) {
        const settings = await api('/settings', jsonBody('PUT', {[key]: value}));
        // Open editors listen for this to apply the change without a reload.
        window.dispatchEvent(new CustomEvent('sd-prompt-lab:settings-changed', {detail: settings}));
        setStatus('Settings saved', 'ok');
    }

    // ---- wiring ----------------------------------------------------------

    let filterTimer = null;

    function wireEvents() {
        $(ids.filter)?.addEventListener('input', (e) => {
            clearTimeout(filterTimer);
            const value = e.target.value.trim();
            filterTimer = setTimeout(() => {
                state.q = value;
                loadPage(true);
            }, 200);
        });

        const list = $(ids.list);
        list?.addEventListener('scroll', () => {
            if (state.loading || state.done) return;
            if (list.scrollTop + list.clientHeight >= list.scrollHeight - SCROLL_THRESHOLD) {
                loadPage(false);
            }
        });
        list?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            const row = e.target.closest('.spl-set-word');
            if (!btn || !row) return;
            if (btn.dataset.action === 'edit') {
                if (row.classList.contains('is-editing')) {
                    commitEdit(row).catch((err) => setStatus(err.message, 'error'));
                } else {
                    startEdit(row);
                }
            } else if (btn.dataset.action === 'remove') {
                removeWord(row).catch((err) => setStatus(err.message, 'error'));
            }
        });
        // Keep focus in the edit input when its row buttons are pressed (avoids blur-cancel).
        list?.addEventListener('mousedown', (e) => {
            if (e.target.closest('.spl-set-word.is-editing [data-action="edit"]')) e.preventDefault();
        });
        list?.addEventListener('dblclick', (e) => {
            const row = e.target.closest('.spl-set-word');
            if (row && !row.classList.contains('is-editing') && e.target.closest('.spl-set-word-text')) {
                startEdit(row);
            }
        });

        $(ids.spellCheck)?.addEventListener('change', (e) => {
            saveSetting('spell_check', e.target.checked).catch((err) => {
                e.target.checked = !e.target.checked;
                setStatus(err.message, 'error');
            });
        });

        $(ids.tagUnderscores)?.addEventListener('change', (e) => {
            saveSetting('tag_underscores', e.target.checked).catch((err) => {
                e.target.checked = !e.target.checked;
                setStatus(err.message, 'error');
            });
        });

        $(ids.clear)?.addEventListener('click', () => { $(ids.clearDialog).hidden = false; });
        $(ids.clearCancel)?.addEventListener('click', () => { $(ids.clearDialog).hidden = true; });
        $(ids.clearConfirm)?.addEventListener('click', () => {
            clearWords().catch((err) => setStatus(err.message, 'error'));
        });
        $(ids.clearDialog)?.addEventListener('click', (e) => {
            if (e.target.id === ids.clearDialog) $(ids.clearDialog).hidden = true;
        });
    }

    // Reload on every visit: new words appear whenever a prompt is saved in Create.
    async function open() {
        if (!$(ids.root)) return;
        if (!state.initialized) {
            state.initialized = true;
            ensureAssets();
            wireEvents();
        }
        try {
            await Promise.all([loadSettings(), loadPage(true)]);
        } catch (e) {
            setStatus(e.message, 'error');
        }
    }

    function setupLazyInit() {
        window.spl.onTabOpened('sd-prompt-lab-settings-tab', () => open());
    }

    onUiLoaded(() => {
        setupLazyInit();
    });
})();
