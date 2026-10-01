const sdPromptLabWildcardEditor = (() => {
    const state = {
        tree: [],
        files: new Map(),
        activePath: null,
        selectedPath: null,
        selectedType: null,
        editor: null,
        openFolders: new Set(),
        contentSearch: false,
        contentMatches: null,
        contentSearchSeq: 0,
        contentSearchTimer: null,
        initialized: false
    };

    const ids = {
        root: 'sd-prompt-lab-wildcard-editor-root',
        tree: 'sd-prompt-lab-wildcard-editor-tree',
        search: 'sd-prompt-lab-wildcard-editor-search',
        searchContent: 'sd-prompt-lab-wildcard-editor-search-content',
        host: 'sd-prompt-lab-wildcard-editor-host',
        tabs: 'sd-prompt-lab-wildcard-editor-tabs',
        path: 'sd-prompt-lab-wildcard-editor-path',
        status: 'sd-prompt-lab-wildcard-editor-status',
        save: 'sd-prompt-lab-wildcard-editor-save',
        sample: 'sd-prompt-lab-wildcard-editor-sample',
        rename: 'sd-prompt-lab-wildcard-editor-rename',
        delete: 'sd-prompt-lab-wildcard-editor-delete',
        autosave: 'sd-prompt-lab-wildcard-editor-autosave',
        newFile: 'sd-prompt-lab-wildcard-editor-new-file',
        newFolder: 'sd-prompt-lab-wildcard-editor-new-folder',
        refresh: 'sd-prompt-lab-wildcard-editor-refresh',
        dialog: 'sd-prompt-lab-wildcard-editor-dialog',
        dialogForm: 'sd-prompt-lab-wildcard-editor-dialog-form',
        dialogIcon: 'sd-prompt-lab-wildcard-editor-dialog-icon',
        dialogTitle: 'sd-prompt-lab-wildcard-editor-dialog-title',
        dialogMessage: 'sd-prompt-lab-wildcard-editor-dialog-message',
        dialogInput: 'sd-prompt-lab-wildcard-editor-dialog-input',
        dialogCancel: 'sd-prompt-lab-wildcard-editor-dialog-cancel',
        dialogSubmit: 'sd-prompt-lab-wildcard-editor-dialog-submit'
    };

    const getEl = (id) => gradioApp().getElementById(id) || document.getElementById(id);
    const fileName = (path) => path.split('/').filter(Boolean).pop() || path;
    const parentPath = (path) => path.split('/').slice(0, -1).join('/');
    const isAutosaveEnabled = () => getEl(ids.autosave)?.checked !== false;

    function normalizePath(path) {
        return (path || '')
            .replaceAll('\\', '/')
            .replace(/^\/+/, '')
            .replace(/\/+/g, '/')
            .trim();
    }

    function ensureTxtPath(path) {
        path = normalizePath(path);
        return path.endsWith('.txt') ? path : `${path}.txt`;
    }

    function setStatus(message, tone = 'neutral') {
        const el = getEl(ids.status);
        if (!el) return;
        el.textContent = message;
        el.dataset.tone = tone;
    }

    async function requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const text = await response.text();
        let data = {};
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (_) {
                data = {detail: text};
            }
        }

        if (!response.ok) {
            const error = new Error(data.detail || `Request failed: ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function icon(name, className = '') {
        const span = document.createElement('span');
        span.className = `material-symbols-rounded ${className}`.trim();
        span.setAttribute('aria-hidden', 'true');
        span.textContent = name;
        return span;
    }

    function wildcardLinkForPath(path) {
        return `__${ensureTxtPath(path).replace(/\.txt$/, '')}__`;
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }

    function showDialog({
        title,
        message = '',
        value = '',
        iconName = 'edit_note',
        submitLabel = 'OK',
        danger = false,
        input = true
    }) {
        return new Promise((resolve) => {
            const backdrop = getEl(ids.dialog);
            const form = getEl(ids.dialogForm);
            const iconEl = getEl(ids.dialogIcon);
            const titleEl = getEl(ids.dialogTitle);
            const messageEl = getEl(ids.dialogMessage);
            const inputEl = getEl(ids.dialogInput);
            const cancelEl = getEl(ids.dialogCancel);
            const submitEl = getEl(ids.dialogSubmit);

            if (!backdrop || !form || !inputEl) {
                resolve(input ? null : false);
                return;
            }

            let resolved = false;
            const cleanup = () => {
                form.removeEventListener('submit', onSubmit);
                cancelEl.removeEventListener('click', onCancel);
                backdrop.removeEventListener('click', onBackdropClick);
                document.removeEventListener('keydown', onKeyDown);
                backdrop.hidden = true;
                submitEl.classList.remove('is-danger');
            };
            const finish = (result) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(result);
            };
            const onSubmit = (event) => {
                event.preventDefault();
                finish(input ? inputEl.value.trim() : true);
            };
            const onCancel = () => finish(null);
            const onBackdropClick = (event) => {
                if (event.target === backdrop) finish(null);
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') finish(null);
            };

            iconEl.textContent = iconName;
            titleEl.textContent = title;
            messageEl.textContent = message;
            inputEl.value = value;
            inputEl.hidden = !input;
            submitEl.textContent = submitLabel;
            if (danger) submitEl.classList.add('is-danger');

            form.addEventListener('submit', onSubmit);
            cancelEl.addEventListener('click', onCancel);
            backdrop.addEventListener('click', onBackdropClick);
            document.addEventListener('keydown', onKeyDown);

            backdrop.hidden = false;
            if (input) {
                inputEl.focus();
                inputEl.select();
            } else {
                submitEl.focus();
            }
        });
    }

    function selectPath(path, type) {
        state.selectedPath = path;
        state.selectedType = type;
        renderTree();
    }

    function normalizeTreePaths(nodes) {
        (nodes || []).forEach(node => {
            node.path = normalizePath(node.path);
            if (node.children) normalizeTreePaths(node.children);
        });
        return nodes;
    }

    async function loadTree() {
        const data = await requestJson('/sd-prompt-lab/wildcards/editor/tree');
        // Always present paths with forward slashes regardless of the server OS.
        state.tree = normalizeTreePaths(data.tree || []);
        renderTree();
        // Lets other editors (e.g. wildcard link validation) refresh their file list.
        window.dispatchEvent(new CustomEvent('sd-prompt-lab:wildcards-changed', {detail: {tree: state.tree}}));
    }

    const treeIndentStepPx = 16;

    function applyTreeDepth(row, depth) {
        row.style.setProperty('--spl-tree-depth', String(depth));
        row.style.setProperty('--spl-tree-indent', `${depth * treeIndentStepPx}px`);
    }

    function createTreeChildren() {
        const children = document.createElement('div');
        children.className = 'spl-tree-children';
        return children;
    }

    // Current explorer filter, or null when the search field is empty.
    // Name mode matches file/folder names; content mode matches the server's hit list.
    function treeFilter() {
        const search = (getEl(ids.search)?.value || '').trim().toLowerCase();
        if (!search) return null;
        if (state.contentSearch) {
            const matches = state.contentMatches || new Set();
            return {file: (item) => matches.has(item.path), folder: () => false};
        }
        return {
            file: (item) => item.name.toLowerCase().includes(search) || item.path.toLowerCase().includes(search),
            folder: (item) => item.name.toLowerCase().includes(search)
        };
    }

    function createTreeNode(item, filter, depth = 0) {
        if (filter && item.type === 'folder') {
            const childMatches = (item.children || [])
                .map(child => createTreeNode(child, filter, depth + 1))
                .filter(Boolean);
            if (!childMatches.length && !filter.folder(item)) return null;

            const folder = document.createElement('div');
            folder.className = 'spl-tree-folder is-open';
            const summary = createFolderRow(item, true);
            applyTreeDepth(summary, depth);
            folder.appendChild(summary);

            const children = createTreeChildren();
            childMatches.forEach(child => children.appendChild(child));
            folder.appendChild(children);
            return folder;
        }

        if (item.type === 'folder') {
            const isOpen = state.openFolders.has(item.path);
            const folder = document.createElement('div');
            folder.className = `spl-tree-folder${isOpen ? ' is-open' : ''}`;
            const summary = createFolderRow(item, isOpen);
            applyTreeDepth(summary, depth);
            folder.appendChild(summary);
            const children = createTreeChildren();
            if (isOpen) {
                (item.children || []).forEach(child => {
                    const node = createTreeNode(child, filter, depth + 1);
                    if (node) children.appendChild(node);
                });
            }
            folder.appendChild(children);
            return folder;
        }

        if (filter && !filter.file(item)) return null;

        const row = document.createElement('div');
        row.className = 'spl-tree-row spl-tree-file';
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.dataset.path = item.path;
        row.dataset.type = 'file';
        row.title = item.path;
        applyTreeDepth(row, depth);
        if (state.selectedPath === item.path) row.classList.add('is-selected');
        if (state.activePath === item.path) row.classList.add('is-active');

        const label = document.createElement('span');
        label.className = 'spl-tree-label';
        label.textContent = item.name;
        row.appendChild(icon('description', 'spl-tree-icon'));
        row.appendChild(label);
        row.appendChild(createTreeDeleteButton(item.path, 'file'));

        row.addEventListener('click', () => openFile(item.path).catch(error => setStatus(error.message, 'error')));
        row.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openFile(item.path).catch(error => setStatus(error.message, 'error'));
        });
        return row;
    }

    function createFolderRow(item, isOpen) {
        const row = document.createElement('div');
        row.className = 'spl-tree-row spl-tree-folder-row';
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.dataset.path = item.path;
        row.dataset.type = 'folder';
        row.title = item.path;
        if (state.selectedPath === item.path) row.classList.add('is-selected');

        row.appendChild(icon(isOpen ? 'folder_open' : 'folder', 'spl-tree-icon spl-folder-icon'));

        const label = document.createElement('span');
        label.className = 'spl-tree-label';
        label.textContent = item.name;
        row.appendChild(label);
        row.appendChild(createTreeDeleteButton(item.path, 'folder'));
        row.addEventListener('click', () => toggleFolder(item.path));
        row.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggleFolder(item.path);
        });
        return row;
    }

    function createTreeDeleteButton(path, type) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'spl-tree-delete';
        button.title = `Delete ${path}`;
        button.setAttribute('aria-label', `Delete ${path}`);
        button.appendChild(icon('delete', 'spl-tree-delete-icon'));
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            selectPath(path, type);
            deletePath(path, type).catch(error => setStatus(error.message, 'error'));
        });
        return button;
    }

    function toggleFolder(path) {
        if (state.openFolders.has(path)) {
            state.openFolders.delete(path);
        } else {
            state.openFolders.add(path);
        }
        state.selectedPath = path;
        state.selectedType = 'folder';
        renderTree();
        saveSessionSoon();
    }

    function renderTree() {
        const container = getEl(ids.tree);
        if (!container) return;

        const filter = treeFilter();
        container.innerHTML = '';

        if (!state.tree.length) {
            const empty = document.createElement('div');
            empty.className = 'spl-tree-empty';
            empty.textContent = 'No wildcard files';
            container.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'spl-tree-list';
        state.tree.forEach(item => {
            const node = createTreeNode(item, filter, 0);
            if (node) list.appendChild(node);
        });
        if (filter && !list.childElementCount) {
            const empty = document.createElement('div');
            empty.className = 'spl-tree-empty';
            empty.textContent = 'No matching files';
            container.appendChild(empty);
            return;
        }
        container.appendChild(list);
    }

    function onSearchInput() {
        if (!state.contentSearch) {
            renderTree();
            return;
        }
        clearTimeout(state.contentSearchTimer);
        state.contentSearchTimer = setTimeout(runContentSearch, 250);
    }

    async function runContentSearch() {
        const query = (getEl(ids.search)?.value || '').trim();
        const seq = ++state.contentSearchSeq;
        if (!query) {
            state.contentMatches = null;
            renderTree();
            setStatus('Ready');
            return;
        }
        try {
            const data = await requestJson(`/sd-prompt-lab/wildcards/editor/search?q=${encodeURIComponent(query)}`);
            if (seq !== state.contentSearchSeq) return;   // a newer search superseded this one
            state.contentMatches = new Set((data.paths || []).map(normalizePath));
            renderTree();
            const count = state.contentMatches.size;
            setStatus(`${count} file${count === 1 ? '' : 's'} contain "${query}"`, count ? 'ok' : 'warn');
        } catch (error) {
            if (seq === state.contentSearchSeq) setStatus(error.message, 'error');
        }
    }

    function toggleContentSearch({focus = true} = {}) {
        state.contentSearch = !state.contentSearch;
        saveSessionSoon();
        const button = getEl(ids.searchContent);
        const input = getEl(ids.search);
        if (button) button.setAttribute('aria-pressed', String(state.contentSearch));
        if (input) input.placeholder = state.contentSearch ? 'Search in file contents' : 'Search files';
        clearTimeout(state.contentSearchTimer);
        state.contentSearchSeq++;
        state.contentMatches = null;
        if (state.contentSearch) runContentSearch();
        else {
            renderTree();
            setStatus('Ready');
        }
        if (focus) input?.focus();
    }

    function updateTabs() {
        saveSessionSoon();
        const tabs = getEl(ids.tabs);
        if (!tabs) return;
        tabs.innerHTML = '';

        state.files.forEach((file, path) => {
            const tab = document.createElement('button');
            tab.className = 'spl-editor-tab';
            if (path === state.activePath) tab.classList.add('is-active');
            if (file.dirty) tab.classList.add('is-dirty');
            tab.title = path;

            const label = document.createElement('span');
            label.textContent = fileName(path);
            tab.appendChild(label);

            const close = document.createElement('span');
            close.className = 'spl-tab-close';
            close.appendChild(icon('close'));
            close.title = 'Close';
            tab.appendChild(close);

            tab.addEventListener('click', () => activateFile(path));
            close.addEventListener('click', (event) => {
                event.stopPropagation();
                closeFile(path);
            });
            tabs.appendChild(tab);
        });
    }

    const activeFile = () => (state.activePath ? state.files.get(state.activePath) : null) || null;

    // Every open file owns its editor state (document, undo history, selection), so
    // edits, undo and autosave can never leak between tabs.
    function createFileState(file) {
        return window.createSdPromptLabEditorState({
            doc: file.content,
            onChange: (doc) => onFileChanged(file, doc),
            onSave: () => saveFile(file, false)
        });
    }

    function onFileChanged(file, doc) {
        file.content = doc;
        file.dirty = file.content !== file.savedContent;
        updateTabs();
        updateHeader();
        if (activeFile() === file) validateActiveFile();

        if (file.dirty && isAutosaveEnabled()) {
            scheduleAutosave(file);
        }
    }

    function ensureEditor() {
        if (state.editor) return;

        const host = getEl(ids.host);
        state.editor = window.createSdPromptLabWildcardEditor({parent: host, doc: ''});

        configureEditorScrollBox();
        measureEditorSoon();
    }

    // The editor is only shown while a file is open; otherwise the "Open a wildcard
    // file" placeholder takes its place (an empty editable view would accept typing
    // that goes nowhere).
    function setEditorVisible(visible) {
        const placeholder = getEl(ids.host)?.querySelector('.spl-ide-empty');
        if (placeholder) placeholder.style.display = visible ? 'none' : '';
        if (!state.editor) return;
        // The editor stylesheet sets display with !important, so match it to hide.
        if (visible) state.editor.dom.style.removeProperty('display');
        else state.editor.dom.style.setProperty('display', 'none', 'important');
    }

    function showBlankEditor() {
        if (!state.editor) return;
        state.editor.setState(window.createSdPromptLabEditorState({doc: ''}));
        setEditorVisible(false);
    }

    function measureEditorSoon() {
        if (!state.editor?.requestMeasure) return;
        requestAnimationFrame(() => state.editor?.requestMeasure());
    }

    function configureEditorScrollBox() {
        if (!state.editor?.dom) return;
        state.editor.dom.style.height = '100%';
        state.editor.dom.style.overflow = 'auto';
    }

    async function openFile(path, {focus = true} = {}) {
        path = ensureTxtPath(path);
        const existing = state.files.get(path);
        if (existing) {
            activateFile(path, {focus});
            return;
        }

        setStatus(`Opening ${path}...`);
        const data = await requestJson(`/sd-prompt-lab/wildcards/content?path=${encodeURIComponent(path)}`);
        state.files.set(path, {
            path,
            content: data.content || '',
            savedContent: data.content || '',
            modified: data.modified ?? null,
            dirty: false
        });
        activateFile(path, {focus});
        setStatus(`Opened ${path}`);
    }

    function activateFile(path, {focus = true} = {}) {
        ensureEditor();
        const file = state.files.get(path);
        if (!file) return;

        const previous = activeFile();
        if (previous) {
            previous.editorState = state.editor.state;
            previous.scrollTop = state.editor.scrollDOM.scrollTop;
            if (previous !== file) flushAutosave(previous);
        }

        state.activePath = path;
        if (!file.editorState) file.editorState = createFileState(file);
        state.editor.setState(file.editorState);
        setEditorVisible(true);
        configureEditorScrollBox();
        requestAnimationFrame(() => {
            if (activeFile() !== file || !state.editor) return;
            state.editor.requestMeasure();
            state.editor.scrollDOM.scrollTop = file.scrollTop || 0;
        });

        selectPath(path, 'file');
        updateTabs();
        updateHeader();
        validateActiveFile();
        if (focus) state.editor.focus();
        checkDiskVersion(file);
        saveSessionSoon();
    }

    async function closeFile(path) {
        const file = state.files.get(path);
        if (!file) return;
        if (file.dirty && isAutosaveEnabled()) await saveFile(file, true);
        if (file.dirty) {
            const shouldClose = await awaitConfirm(`Close "${path}" without saving?`, 'Unsaved changes', 'close', 'Close');
            if (!shouldClose) return;
        }
        clearTimeout(file.autosaveTimer);

        // The file may have been renamed while a dialog/save was pending.
        path = file.path;
        const paths = Array.from(state.files.keys());
        const index = paths.indexOf(path);
        state.files.delete(path);

        if (state.activePath === path) {
            const nextPath = paths[index + 1] || paths[index - 1] || null;
            state.activePath = null;
            if (nextPath && state.files.has(nextPath)) {
                activateFile(nextPath);
            } else {
                showBlankEditor();
                updateHeader();
            }
        }
        updateTabs();
    }

    function updateHeader() {
        const pathEl = getEl(ids.path);
        const file = state.activePath ? state.files.get(state.activePath) : null;
        if (!pathEl) return;

        if (file) {
            const link = wildcardLinkForPath(file.path);
            pathEl.textContent = `${file.path}${file.dirty ? ' *' : ''}`;
            pathEl.dataset.copyValue = link;
            pathEl.title = `Click to copy ${link}`;
            pathEl.classList.add('is-copyable');
        } else {
            pathEl.textContent = 'No file selected';
            delete pathEl.dataset.copyValue;
            pathEl.title = '';
            pathEl.classList.remove('is-copyable');
        }
    }

    function scheduleAutosave(file) {
        // While a disk conflict is unresolved, autosave must not keep retrying.
        if (file.conflict) return;
        clearTimeout(file.autosaveTimer);
        file.autosaveTimer = setTimeout(() => saveFile(file, true), 900);
    }

    // Save a pending autosave right away (used when leaving a tab).
    function flushAutosave(file) {
        if (file.autosaveTimer) saveFile(file, true);
    }

    const sameModified = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.001;

    async function saveFile(file, isAuto = false, {force = false} = {}) {
        if (!file) return;
        clearTimeout(file.autosaveTimer);
        file.autosaveTimer = null;
        if (file === activeFile() && state.editor) file.content = state.editor.state.doc.toString();
        if (!force && !file.dirty && file.content === file.savedContent) return;

        const content = file.content;
        const body = {path: file.path, content};
        // Lets the server refuse the save if the file changed on disk since we read it.
        if (!force && file.modified != null) body.expected_modified = file.modified;

        file.saving = true;
        try {
            setStatus(isAuto ? `Autosaving ${file.path}...` : `Saving ${file.path}...`);
            const data = await requestJson('/sd-prompt-lab/wildcards/save', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body)
            });
            file.savedContent = content;
            file.modified = data.modified ?? file.modified;
            file.conflict = false;
            // Edits made while the request was in flight keep the file dirty.
            file.dirty = file.content !== file.savedContent;
            updateTabs();
            updateHeader();
            setStatus(isAuto ? `Autosaved ${file.path}` : `Saved ${file.path}`, 'ok');
        } catch (error) {
            if (error.status === 409) {
                file.saving = false;
                await resolveDiskConflict(file);
                return;
            }
            setStatus(error.message, 'error');
        } finally {
            file.saving = false;
        }
    }

    // The file was modified outside the editor while it has unsaved changes here.
    async function resolveDiskConflict(file) {
        file.conflict = true;
        setStatus(`${file.path} changed on disk`, 'error');
        if (file.conflictDialogOpen) return;

        file.conflictDialogOpen = true;
        const choice = await window.spl.confirm({
            title: 'File changed on disk',
            message: `"${file.path}" was modified outside the editor. Overwrite it with your version, or reload it and lose your changes here?`,
            confirmLabel: 'Overwrite',
            extraLabel: 'Reload from disk',
            cancelLabel: 'Cancel',
            danger: true,
        });
        file.conflictDialogOpen = false;
        if (!state.files.has(file.path)) return;   // closed or deleted meanwhile

        try {
            if (choice === true) await saveFile(file, false, {force: true});
            else if (choice === 'extra') await reloadFile(file);
        } catch (error) {
            setStatus(error.message, 'error');
        }
    }

    function applyDiskContent(file, data) {
        clearTimeout(file.autosaveTimer);
        file.autosaveTimer = null;
        file.content = data.content || '';
        file.savedContent = file.content;
        file.modified = data.modified ?? null;
        file.dirty = false;
        file.conflict = false;
        file.editorState = createFileState(file);
        if (activeFile() === file && state.editor) {
            state.editor.setState(file.editorState);
            configureEditorScrollBox();
            measureEditorSoon();
        }
        updateTabs();
        updateHeader();
    }

    async function reloadFile(file) {
        const data = await requestJson(`/sd-prompt-lab/wildcards/content?path=${encodeURIComponent(file.path)}`);
        applyDiskContent(file, data);
        setStatus(`Reloaded ${file.path} from disk`, 'ok');
    }

    // Called when a tab is activated or the window regains focus: pick up changes made
    // by other programs. A clean file is reloaded quietly; a dirty one asks.
    async function checkDiskVersion(file) {
        if (!file || file.saving || file.checking || file.conflictDialogOpen || file.modified == null) return;
        file.checking = true;
        try {
            const data = await requestJson(`/sd-prompt-lab/wildcards/content?path=${encodeURIComponent(file.path)}`);
            if (file.saving || !state.files.has(file.path) || sameModified(data.modified, file.modified)) return;
            if (file.dirty) {
                await resolveDiskConflict(file);
            } else {
                applyDiskContent(file, data);
                setStatus(`Reloaded ${file.path} (changed on disk)`, 'ok');
            }
        } catch (error) {
            // Deleted or unreadable: leave the tab as it is; saving will report the problem.
        } finally {
            file.checking = false;
        }
    }

    async function createFile() {
        const base = state.selectedType === 'folder' ? `${state.selectedPath}/` : parentPath(state.selectedPath || '');
        const rawPath = await showDialog({
            title: 'New wildcard file',
            message: 'Create a .txt file in the wildcards directory.',
            value: base ? `${base}/new-file.txt`.replace('//', '/') : 'new-file.txt',
            iconName: 'note_add',
            submitLabel: 'Create'
        });
        if (!rawPath) return;

        const path = ensureTxtPath(rawPath);
        try {
            await requestJson(`/sd-prompt-lab/wildcards/editor/file/create?path=${encodeURIComponent(path)}`, {method: 'POST'});
            state.openFolders.add(parentPath(path));
            await loadTree();
            await openFile(path);
        } catch (error) {
            setStatus(error.message, 'error');
        }
    }

    async function createFolder() {
        const base = state.selectedType === 'folder' ? `${state.selectedPath}/` : parentPath(state.selectedPath || '');
        const rawPath = await showDialog({
            title: 'New folder',
            message: 'Create a folder for grouping wildcard files.',
            value: base ? `${base}/new-folder`.replace('//', '/') : 'new-folder',
            iconName: 'create_new_folder',
            submitLabel: 'Create'
        });
        if (!rawPath) return;

        const path = normalizePath(rawPath);
        try {
            await requestJson(`/sd-prompt-lab/wildcards/editor/folder/create?path=${encodeURIComponent(path)}`, {method: 'POST'});
            state.openFolders.add(parentPath(path));
            await loadTree();
            selectPath(path, 'folder');
        } catch (error) {
            setStatus(error.message, 'error');
        }
    }

    function selectedOrActivePath() {
        if (state.selectedPath) return {path: state.selectedPath, type: state.selectedType};
        if (state.activePath) return {path: state.activePath, type: 'file'};
        return null;
    }

    async function renameSelected() {
        const selected = selectedOrActivePath();
        if (!selected) return;

        const nextDefault = selected.path;
        const rawPath = await showDialog({
            title: `Rename ${selected.type}`,
            message: 'Use a path relative to the wildcards directory.',
            value: nextDefault,
            iconName: 'drive_file_rename_outline',
            submitLabel: 'Rename'
        });
        if (!rawPath) return;
        const newPath = selected.type === 'file' ? ensureTxtPath(rawPath) : normalizePath(rawPath);
        if (newPath === selected.path) return;

        try {
            await requestJson('/sd-prompt-lab/wildcards/editor/rename', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({old_path: selected.path, new_path: newPath})
            });
            updateOpenFilesAfterRename(selected.path, newPath, selected.type);
            await loadTree();
            selectPath(newPath, selected.type);
            if (selected.type === 'file' && state.files.has(newPath)) activateFile(newPath);
            setStatus(`Renamed to ${newPath}`, 'ok');
        } catch (error) {
            setStatus(error.message, 'error');
        }
    }

    function updateOpenFilesAfterRename(oldPath, newPath, type) {
        const replacements = [];
        state.files.forEach((file, path) => {
            if (path === oldPath || (type === 'folder' && path.startsWith(`${oldPath}/`))) {
                const movedPath = path === oldPath ? newPath : `${newPath}/${path.slice(oldPath.length + 1)}`;
                replacements.push([path, movedPath, file]);
            }
        });

        replacements.forEach(([oldFilePath, movedPath, file]) => {
            state.files.delete(oldFilePath);
            file.path = movedPath;
            state.files.set(movedPath, file);
            if (state.activePath === oldFilePath) state.activePath = movedPath;
        });
        updateTabs();
        updateHeader();
    }

    async function deleteSelected() {
        const selected = selectedOrActivePath();
        if (!selected) return;
        await deletePath(selected.path, selected.type);
    }

    async function deletePath(path, type) {
        const shouldDelete = await awaitConfirm(
            `This will remove "${path}" from the wildcards directory${type === 'folder' ? ' with all nested files and folders' : ''}.`,
            `Delete ${type}`,
            'delete',
            'Delete',
            true
        );
        if (!shouldDelete) return;

        try {
            await requestJson('/sd-prompt-lab/wildcards/editor/delete', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({path})
            });
            closeDeletedOpenFiles(path, type);
            await loadTree();
            state.selectedPath = null;
            state.selectedType = null;
            setStatus(`Deleted ${path}`, 'ok');
        } catch (error) {
            setStatus(error.message, 'error');
        }
    }

    function awaitConfirm(message, title = 'Confirm', iconName = 'help', submitLabel = 'OK', danger = false) {
        return showDialog({
            title,
            message,
            iconName,
            submitLabel,
            danger,
            input: false
        });
    }

    function closeDeletedOpenFiles(path, type) {
        let activeRemoved = false;
        Array.from(state.files.keys()).forEach(filePath => {
            if (filePath === path || (type === 'folder' && filePath.startsWith(`${path}/`))) {
                clearTimeout(state.files.get(filePath).autosaveTimer);
                state.files.delete(filePath);
                if (state.activePath === filePath) {
                    state.activePath = null;
                    activeRemoved = true;
                }
            }
        });

        if (activeRemoved) {
            const nextPath = Array.from(state.files.keys())[0] || null;
            if (nextPath) activateFile(nextPath);
            else showBlankEditor();
        }
        updateTabs();
        updateHeader();
    }

    function validateActiveFile() {
        if (!state.activePath || !state.editor) return;
        const file = state.files.get(state.activePath);
        if (file?.dirty) setStatus('Unsaved changes', 'warn');
    }

    // Open the file a __wildcard__ reference points to. Used by Ctrl/Cmd-click in every
    // prompt editor (exposed as window.sdPromptLabOpenWildcard).
    async function openWildcard(path) {
        if (/[*?]/.test(path)) {
            window.spl.toast(`"${path}" is a pattern that can match several files`, 'warn');
            return;
        }
        window.spl.openTab('sd-prompt-lab-wildcard-editor-tab');
        await init();
        const linkedPath = ensureTxtPath(path);
        try {
            await openFile(linkedPath);
            // The folder holding the file may be collapsed; reveal it in the explorer.
            const parts = linkedPath.split('/');
            for (let i = 1; i < parts.length; i++) state.openFolders.add(parts.slice(0, i).join('/'));
            renderTree();
            requestAnimationFrame(() => state.editor?.requestMeasure());
        } catch (error) {
            window.spl.toast(`Wildcard file not found: ${linkedPath}`, 'error');
        }
    }

    async function sampleActiveFile() {
        const file = activeFile();
        if (!file) {
            setStatus('Open a wildcard file to sample it', 'warn');
            return;
        }
        // Sampling reads the file from disk, so write pending edits first.
        if (file.dirty) await saveFile(file, true);
        const name = file.path.replace(/\.txt$/, '');
        window.sdPromptLabShowSamples({title: `Samples from ${file.path}`, prompt: `__${name}__`});
    }

    // ---- session: open tabs, folders and toggles survive a page reload ---------------

    const SESSION_KEY = 'sd-prompt-lab:wildcard-editor';
    let sessionTimer = null;
    let restoringSession = false;

    function saveSessionSoon() {
        if (restoringSession) return;
        clearTimeout(sessionTimer);
        sessionTimer = setTimeout(() => {
            try {
                localStorage.setItem(SESSION_KEY, JSON.stringify({
                    openFiles: Array.from(state.files.keys()),
                    activePath: state.activePath,
                    openFolders: Array.from(state.openFolders),
                    autosave: isAutosaveEnabled(),
                    contentSearch: state.contentSearch
                }));
            } catch (error) {
                // Storage unavailable or full: the session just is not remembered.
            }
        }, 300);
    }

    async function restoreSession() {
        let session = null;
        try {
            session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        } catch (error) {
            session = null;
        }
        if (!session || typeof session !== 'object') return;

        restoringSession = true;
        try {
            const autosave = getEl(ids.autosave);
            if (autosave && typeof session.autosave === 'boolean') autosave.checked = session.autosave;
            if (session.contentSearch && !state.contentSearch) toggleContentSearch({focus: false});
            for (const folder of session.openFolders || []) state.openFolders.add(folder);
            renderTree();
            for (const path of session.openFiles || []) {
                try {
                    await openFile(path, {focus: false});
                } catch (error) {
                    // The file was removed since the last visit: skip it.
                }
            }
            if (session.activePath && state.files.has(session.activePath)) {
                activateFile(session.activePath, {focus: false});
            }
        } finally {
            restoringSession = false;
        }
    }

    function setupEvents() {
        ensureAutosaveDefault();
        getEl(ids.newFile)?.addEventListener('click', createFile);
        getEl(ids.newFolder)?.addEventListener('click', createFolder);
        getEl(ids.refresh)?.addEventListener('click', () => loadTree().catch(error => setStatus(error.message, 'error')));
        getEl(ids.save)?.addEventListener('click', () => saveFile(activeFile(), false));
        getEl(ids.sample)?.addEventListener('click', () => sampleActiveFile().catch(error => setStatus(error.message, 'error')));
        getEl(ids.autosave)?.addEventListener('change', saveSessionSoon);
        // The editor is created while its tab may be hidden; measure once it is shown.
        window.spl.onTabOpened('sd-prompt-lab-wildcard-editor-tab', () => {
            requestAnimationFrame(() => state.editor?.requestMeasure());
        });
        getEl(ids.rename)?.addEventListener('click', renameSelected);
        getEl(ids.delete)?.addEventListener('click', deleteSelected);
        getEl(ids.search)?.addEventListener('input', onSearchInput);
        getEl(ids.searchContent)?.addEventListener('click', (event) => {
            event.preventDefault();
            toggleContentSearch();
        });
        getEl(ids.path)?.addEventListener('click', async () => {
            const pathEl = getEl(ids.path);
            const value = pathEl?.dataset.copyValue;
            if (!value) return;

            try {
                await copyToClipboard(value);
                setStatus(`Copied ${value}`, 'ok');
            } catch (error) {
                setStatus('Failed to copy wildcard link', 'error');
            }
        });

        window.addEventListener('focus', () => checkDiskVersion(activeFile()));

        getEl(ids.root)?.addEventListener('keydown', event => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                saveFile(activeFile(), false);
            }
        });
    }

    function ensureAutosaveDefault() {
        const checkbox = getEl(ids.autosave);
        if (!checkbox) return;
        checkbox.checked = true;
    }

    let initPromise = null;

    function init() {
        if (!getEl(ids.root)) return Promise.resolve();
        if (!initPromise) {
            state.initialized = true;
            initPromise = (async () => {
                try {
                    await window.spl.loadCodeMirror();
                    setupEvents();
                    await loadTree();
                    await restoreSession();
                    setStatus('Ready');
                } catch (error) {
                    setStatus(error.message, 'error');
                    console.error(error);
                }
            })();
        }
        return initPromise;
    }

    return {init, openWildcard, available: () => !!getEl(ids.root)};
})();

// Opens a wildcard file in the Wildcard Editor from any prompt editor.
window.sdPromptLabOpenWildcard = (path) => {
    if (!sdPromptLabWildcardEditor.available()) {
        window.spl.toast('The Wildcard Editor is not available (no wildcards directory)', 'warn');
        return;
    }
    sdPromptLabWildcardEditor.openWildcard(path).catch((error) => console.error(error));
};

onUiLoaded(() => {
    sdPromptLabWildcardEditor.init();
});
