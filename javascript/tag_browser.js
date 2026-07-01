(() => {
    const API = '/sd-prompt-lab';
    const PAGE_SIZE = 60;
    const SCROLL_THRESHOLD = 300;

    // Danbooru tag categories -> label + badge color. Unknown codes still render.
    const CATEGORIES = {
        0: {label: 'General', color: '#4a9eff'},
        1: {label: 'Artist', color: '#ff6b6b'},
        3: {label: 'Copyright', color: '#c56bff'},
        4: {label: 'Character', color: '#4ade80'},
        5: {label: 'Meta', color: '#f5b642'},
    };

    const state = {
        initialized: false,
        source: '',
        q: '',
        category: null,
        sort: 'post_count',
        includeDeprecated: false,
        offset: 0,
        total: 0,
        loading: false,
        done: false,
    };

    const ids = {
        root: 'sd-prompt-lab-tag-browser-root',
        empty: 'sd-prompt-lab-tags-empty',
        emptyRefresh: 'sd-prompt-lab-tags-empty-refresh',
        main: 'sd-prompt-lab-tags-main',
        source: 'sd-prompt-lab-tags-source',
        search: 'sd-prompt-lab-tags-search',
        sort: 'sd-prompt-lab-tags-sort',
        deprecated: 'sd-prompt-lab-tags-deprecated',
        count: 'sd-prompt-lab-tags-count',
        categories: 'sd-prompt-lab-tags-categories',
        list: 'sd-prompt-lab-tags-list',
        status: 'sd-prompt-lab-tags-status',
        detail: 'sd-prompt-lab-tags-detail',
        detailName: 'sd-prompt-lab-tags-detail-name',
        detailBody: 'sd-prompt-lab-tags-detail-body',
        detailClose: 'sd-prompt-lab-tags-detail-close',
        add: 'sd-prompt-lab-tags-add',
        emptyAdd: 'sd-prompt-lab-tags-empty-add',
        dialog: 'sd-prompt-lab-tags-dialog',
        dialogForm: 'sd-prompt-lab-tags-dialog-form',
        dialogInput: 'sd-prompt-lab-tags-dialog-input',
        dialogStatus: 'sd-prompt-lab-tags-dialog-status',
        dialogCancel: 'sd-prompt-lab-tags-dialog-cancel',
        dialogSubmit: 'sd-prompt-lab-tags-dialog-submit',
    };

    const $ = (id) => gradioApp()?.getElementById(id);

    function ensureAssets() {
        if (!document.getElementById('sd-prompt-lab-material-symbols')) {
            const icons = document.createElement('link');
            icons.id = 'sd-prompt-lab-material-symbols';
            icons.rel = 'stylesheet';
            icons.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..32,400,0,0';
            document.head.appendChild(icons);
        }
        if (!document.getElementById('sd-prompt-lab-tags-style')) {
            const style = document.createElement('link');
            style.id = 'sd-prompt-lab-tags-style';
            style.rel = 'stylesheet';
            style.href = `file=extensions/sd-prompt-lab/javascript/tag_browser.css?v=${Date.now()}`;
            document.head.appendChild(style);
        }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    }

    function formatCount(n) {
        n = Number(n) || 0;
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(n);
    }

    function catInfo(category) {
        return CATEGORIES[category] || {
            label: category == null ? 'Unknown' : '#' + category,
            color: '#888',
        };
    }

    function setStatus(text) {
        const el = $(ids.status);
        if (el) el.textContent = text;
    }

    function flashStatus(text) {
        setStatus(text);
        clearTimeout(flashStatus._t);
        flashStatus._t = setTimeout(() => setStatus('Ready'), 1800);
    }

    // ---- clipboard / prompt integration --------------------------------------

    function copyToClipboard(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        document.body.removeChild(textarea);
        return ok;
    }

    function appendToEditor(tag) {
        const editor = window.sdPromptLabEditor;
        if (!editor) {
            flashStatus('Create editor is not ready yet');
            return;
        }
        const current = editor.state.doc.toString();
        const sep = current.trim().length ? (/[,\s]$/.test(current) ? '' : ', ') : '';
        editor.dispatch({changes: {from: current.length, insert: sep + tag}});
        flashStatus(`Added "${tag}" to the Create editor`);
    }

    function appendToTxt2Img(tag) {
        const promptBlock = document.getElementById('txt2img_prompt');
        const textarea = promptBlock?.querySelector('textarea');
        if (!textarea) {
            flashStatus('txt2img prompt not found');
            return;
        }
        const current = textarea.value;
        const sep = current.trim().length ? (/[,\s]$/.test(current) ? '' : ', ') : '';
        textarea.value = current + sep + tag;
        textarea.dispatchEvent(new Event('input', {bubbles: true}));
        flashStatus(`Added "${tag}" to the txt2img prompt`);
    }

    // ---- rendering -----------------------------------------------------------

    function tagRowHtml(tag) {
        const info = catInfo(tag.category);
        const pills = [];
        if (tag.is_deprecated) {
            pills.push('<span class="spl-tags-pill spl-tags-pill-warn">deprecated</span>');
        }
        if (tag.source_count > 1) {
            pills.push(`<span class="spl-tags-pill">×${tag.source_count} sources</span>`);
        }
        const name = escapeHtml(tag.name);
        return `
            <div class="spl-tags-row" data-name="${name}" title="Click to copy">
                <span class="spl-tags-badge" style="--cat:${info.color}">${escapeHtml(info.label)}</span>
                <span class="spl-tags-name">${name}</span>
                <span class="spl-tags-postcount" title="${(Number(tag.post_count) || 0).toLocaleString()} posts">${formatCount(tag.post_count)}</span>
                <span class="spl-tags-pills">${pills.join('')}</span>
                <span class="spl-tags-actions">
                    <button class="spl-tags-icon-btn" data-action="copy" title="Copy tag">
                        <span class="material-symbols-rounded">content_copy</span></button>
                    <button class="spl-tags-icon-btn" data-action="editor" title="Append to Create editor">
                        <span class="material-symbols-rounded">edit_note</span></button>
                    <button class="spl-tags-icon-btn" data-action="txt2img" title="Send to txt2img">
                        <span class="material-symbols-rounded">image</span></button>
                    <button class="spl-tags-icon-btn" data-action="info" title="Details">
                        <span class="material-symbols-rounded">info</span></button>
                </span>
            </div>`;
    }

    function renderCategories(categories) {
        const el = $(ids.categories);
        if (!el) return;
        const total = categories.reduce((sum, c) => sum + c.count, 0);
        const chips = [
            `<button class="spl-tags-chip${state.category == null ? ' active' : ''}" data-cat="all">
                All <span class="spl-tags-chip-count">${total.toLocaleString()}</span></button>`,
        ];
        for (const c of categories) {
            const info = catInfo(c.category);
            const active = state.category === c.category ? ' active' : '';
            chips.push(
                `<button class="spl-tags-chip${active}" data-cat="${c.category}" style="--cat:${info.color}">
                    <span class="spl-tags-chip-dot"></span>${escapeHtml(info.label)}
                    <span class="spl-tags-chip-count">${c.count.toLocaleString()}</span></button>`);
        }
        el.innerHTML = chips.join('');
    }

    function renderSources(sources) {
        const el = $(ids.source);
        if (!el) return;
        const options = ['<option value="">All sources</option>'];
        for (const s of sources) {
            const selected = s.source === state.source ? ' selected' : '';
            options.push(
                `<option value="${escapeHtml(s.source)}"${selected}>${escapeHtml(s.source)} (${s.count.toLocaleString()})</option>`);
        }
        el.innerHTML = options.join('');
    }

    function updateCount() {
        const el = $(ids.count);
        if (el) el.textContent = `${state.total.toLocaleString()} tags`;
    }

    // ---- data loading --------------------------------------------------------

    function buildQuery(offset) {
        const p = new URLSearchParams();
        if (state.q) p.set('q', state.q);
        if (state.category != null) p.set('category', state.category);
        if (state.source) p.set('source', state.source);
        if (state.includeDeprecated) p.set('include_deprecated', 'true');
        p.set('sort', state.sort);
        p.set('limit', PAGE_SIZE);
        p.set('offset', offset);
        return p.toString();
    }

    async function loadSources() {
        setStatus('Loading datasets…');
        const res = await fetch(`${API}/tags/sources`);
        if (!res.ok) throw new Error('Failed to load datasets');
        const data = await res.json();
        const hasData = (data.sources || []).length > 0;
        $(ids.empty).hidden = hasData;
        $(ids.main).hidden = !hasData;
        if (!hasData) {
            setStatus('No datasets');
            return false;
        }
        renderSources(data.sources);
        return true;
    }

    async function loadPage(reset) {
        if (state.loading) return;
        if (!reset && state.done) return;
        state.loading = true;

        const offset = reset ? 0 : state.offset;
        setStatus(reset ? 'Searching…' : 'Loading more…');
        try {
            const res = await fetch(`${API}/tags?${buildQuery(offset)}`);
            if (!res.ok) throw new Error('Failed to load tags');
            const data = await res.json();

            const list = $(ids.list);
            if (reset) {
                list.innerHTML = '';
                list.scrollTop = 0;
                state.total = data.total;
                state.done = false;
                renderCategories(data.categories || []);
                updateCount();
            }

            const rows = (data.tags || []).map(tagRowHtml).join('');
            list.insertAdjacentHTML('beforeend', rows);

            state.offset = offset + (data.tags || []).length;
            if ((data.tags || []).length < PAGE_SIZE || state.offset >= state.total) {
                state.done = true;
            }

            if (state.total === 0) {
                list.innerHTML = '<div class="spl-tags-noresults">No tags match your filters.</div>';
            }
            setStatus('Ready');
        } catch (e) {
            setStatus(`Error: ${e.message}`);
        } finally {
            state.loading = false;
        }
    }

    function resetAndLoad() {
        state.offset = 0;
        state.done = false;
        loadPage(true);
    }

    async function openDetail(name) {
        const drawer = $(ids.detail);
        const body = $(ids.detailBody);
        const nameEl = $(ids.detailName);
        if (!drawer || !body) return;
        drawer.hidden = false;
        nameEl.textContent = name;
        body.innerHTML = '<div class="spl-tags-detail-loading">Loading…</div>';
        try {
            const res = await fetch(`${API}/tags/detail?name=${encodeURIComponent(name)}`);
            if (!res.ok) throw new Error('Failed to load tag details');
            const data = await res.json();
            body.innerHTML = detailHtml(data);
        } catch (e) {
            body.innerHTML = `<div class="spl-tags-detail-loading">${escapeHtml(e.message)}</div>`;
        }
    }

    function metaRow(label, value) {
        if (value === undefined || value === null || value === '') return '';
        return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
    }

    function detailHtml(data) {
        const m = data.metadata || {};
        const info = catInfo(m.category);
        const words = Array.isArray(m.words) ? m.words.join(', ') : m.words;
        const rows = [
            metaRow('ID', m.id),
            m.category != null
                ? `<tr><th>Category</th><td><span class="spl-tags-badge" style="--cat:${info.color}">${escapeHtml(info.label)}</span></td></tr>`
                : '',
            m.post_count != null
                ? metaRow('Post count', (Number(m.post_count) || 0).toLocaleString())
                : '',
            metaRow('Deprecated', m.is_deprecated ? 'yes' : 'no'),
            metaRow('Created', m.created_at),
            metaRow('Updated', m.updated_at),
            metaRow('Words', words),
        ].join('');

        const sources = (data.sources || [])
            .map((s) => `<li>${escapeHtml(s)}</li>`).join('');

        return `
            <table class="spl-tags-meta">${rows}</table>
            <div class="spl-tags-detail-section">
                <div class="spl-tags-detail-label">Source files (${(data.sources || []).length})</div>
                <ul class="spl-tags-sources">${sources}</ul>
            </div>
            <div class="spl-tags-detail-section">
                <div class="spl-tags-detail-label">Raw record</div>
                <pre class="spl-tags-raw">${escapeHtml(JSON.stringify(m, null, 2))}</pre>
            </div>`;
    }

    // ---- add dataset dialog --------------------------------------------------

    function openDialog() {
        const dialog = $(ids.dialog);
        if (!dialog) return;
        dialog.hidden = false;
        const input = $(ids.dialogInput);
        const status = $(ids.dialogStatus);
        if (input) input.value = '';
        if (status) {
            status.textContent = '';
            status.classList.remove('error');
        }
        setTimeout(() => input?.focus(), 0);
    }

    function closeDialog() {
        const dialog = $(ids.dialog);
        if (dialog) dialog.hidden = true;
    }

    async function downloadDataset(url) {
        const status = $(ids.dialogStatus);
        const submit = $(ids.dialogSubmit);
        if (status) {
            status.textContent = 'Downloading… this can take a while for large datasets.';
            status.classList.remove('error');
        }
        if (submit) submit.disabled = true;
        try {
            const res = await fetch(`${API}/tags/download`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({url}),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Download failed');

            closeDialog();
            state.source = data.source || '';
            const hasData = await loadSources();
            if (hasData) resetAndLoad();
            flashStatus(`Added dataset "${data.name}"`);
        } catch (e) {
            if (status) {
                status.textContent = e.message;
                status.classList.add('error');
            }
        } finally {
            if (submit) submit.disabled = false;
        }
    }

    // ---- wiring --------------------------------------------------------------

    let searchTimer = null;

    function wireEvents() {
        const search = $(ids.search);
        search?.addEventListener('input', (e) => {
            clearTimeout(searchTimer);
            const value = e.target.value.trim();
            searchTimer = setTimeout(() => {
                state.q = value;
                resetAndLoad();
            }, 250);
        });

        $(ids.sort)?.addEventListener('change', (e) => {
            state.sort = e.target.value;
            resetAndLoad();
        });

        $(ids.source)?.addEventListener('change', (e) => {
            state.source = e.target.value;
            resetAndLoad();
        });

        $(ids.deprecated)?.addEventListener('change', (e) => {
            state.includeDeprecated = e.target.checked;
            resetAndLoad();
        });

        $(ids.categories)?.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-cat]');
            if (!chip) return;
            const raw = chip.dataset.cat;
            const next = raw === 'all' ? null : Number(raw);
            state.category = state.category === next ? null : next;
            $(ids.categories).querySelectorAll('.spl-tags-chip').forEach((c) => {
                const cRaw = c.dataset.cat;
                const cVal = cRaw === 'all' ? null : Number(cRaw);
                c.classList.toggle('active', cVal === state.category);
            });
            resetAndLoad();
        });

        const list = $(ids.list);
        list?.addEventListener('scroll', () => {
            if (state.loading || state.done) return;
            if (list.scrollTop + list.clientHeight >= list.scrollHeight - SCROLL_THRESHOLD) {
                loadPage(false);
            }
        });

        list?.addEventListener('click', (e) => {
            const row = e.target.closest('.spl-tags-row');
            if (!row) return;
            const name = row.dataset.name;
            const btn = e.target.closest('[data-action]');
            const action = btn?.dataset.action || 'copy';

            if (action === 'copy') {
                if (copyToClipboard(name)) flashStatus(`Copied "${name}"`);
                else flashStatus('Copy failed');
            } else if (action === 'editor') {
                appendToEditor(name);
            } else if (action === 'txt2img') {
                appendToTxt2Img(name);
            } else if (action === 'info') {
                openDetail(name);
            }
        });

        $(ids.detailClose)?.addEventListener('click', () => {
            const drawer = $(ids.detail);
            if (drawer) drawer.hidden = true;
        });

        $(ids.emptyRefresh)?.addEventListener('click', () => init(true));

        $(ids.add)?.addEventListener('click', openDialog);
        $(ids.emptyAdd)?.addEventListener('click', openDialog);
        $(ids.dialogCancel)?.addEventListener('click', closeDialog);
        $(ids.dialog)?.addEventListener('click', (e) => {
            if (e.target === $(ids.dialog)) closeDialog();
        });
        $(ids.dialogForm)?.addEventListener('submit', (e) => {
            e.preventDefault();
            const url = $(ids.dialogInput)?.value.trim();
            if (!url) {
                const status = $(ids.dialogStatus);
                if (status) {
                    status.textContent = 'Please paste a dataset URL';
                    status.classList.add('error');
                }
                return;
            }
            downloadDataset(url);
        });
    }

    async function init(force) {
        if (state.initialized && !force) return;
        const root = $(ids.root);
        if (!root) return;

        if (!state.initialized) {
            ensureAssets();
            wireEvents();
            state.initialized = true;
        }

        try {
            const hasData = await loadSources();
            if (hasData) resetAndLoad();
        } catch (e) {
            setStatus(`Error: ${e.message}`);
        }
    }

    // Lazy-init only when the Tag Browser tab is first opened, so the (potentially
    // large) dataset import isn't triggered on every WebUI page load.
    function setupLazyInit() {
        const root = gradioApp()?.querySelector('#tab_sd_prompt_lab');
        if (!root) return;
        const tabNav = root.querySelector('.tab-nav');
        if (!tabNav) return;
        const btn = Array.from(tabNav.querySelectorAll('button')).find((b) =>
            b.textContent.trim().toLowerCase().startsWith('tag browser'));
        if (!btn) return;
        btn.addEventListener('click', () => init(false));
    }

    onUiLoaded(() => {
        setupLazyInit();
    });
})();
