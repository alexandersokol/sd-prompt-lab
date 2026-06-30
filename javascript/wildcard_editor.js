window.sdPromptLabLoadCodeMirror = window.sdPromptLabLoadCodeMirror || (() => {
    let loadPromise = null;

    return () => {
        if (window.createSdPromptLabWildcardEditor) return Promise.resolve();
        if (loadPromise) return loadPromise;

        loadPromise = new Promise((resolve, reject) => {
            const ensureIcons = () => {
                if (document.getElementById('sd-prompt-lab-material-symbols')) return;
                const icons = document.createElement('link');
                icons.id = 'sd-prompt-lab-material-symbols';
                icons.rel = 'stylesheet';
                icons.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..32,400,0,0';
                document.head.appendChild(icons);
            };

            const loadScript = () => {
                ensureIcons();
                if (window.createSdPromptLabWildcardEditor) {
                    resolve();
                    return;
                }

                let script = document.getElementById('sd-prompt-lab-codemirror-bundle');
                if (!script) {
                    script = document.createElement('script');
                    script.id = 'sd-prompt-lab-codemirror-bundle';
                    script.src = `/file/extensions/sd-prompt-lab/javascript/lib/codemirror6.bundle.js?v=${Date.now()}`;
                    script.onload = () => resolve();
                    script.onerror = () => reject(new Error('Failed to load CodeMirror bundle'));
                    document.head.appendChild(script);
                } else {
                    script.addEventListener('load', () => resolve(), {once: true});
                    script.addEventListener('error', () => reject(new Error('Failed to load CodeMirror bundle')), {once: true});
                }
            };

            let styles = document.getElementById('sd-prompt-lab-editor-style');
            if (!styles) {
                styles = document.createElement('link');
                styles.id = 'sd-prompt-lab-editor-style';
                styles.rel = 'stylesheet';
                styles.href = `file=extensions/sd-prompt-lab/editor/style.css?v=${Date.now()}`;
                styles.onload = loadScript;
                styles.onerror = () => reject(new Error('Failed to load editor styles'));
                document.head.appendChild(styles);
            } else {
                loadScript();
            }
        });

        return loadPromise;
    };
})();

const sdPromptLabWildcardEditor = (() => {
    const state = {
        tree: [],
        files: new Map(),
        activePath: null,
        selectedPath: null,
        selectedType: null,
        editor: null,
        autosaveTimer: null,
        openFolders: new Set(),
        silentChange: false,
        initialized: false
    };

    const ids = {
        root: 'sd-prompt-lab-wildcard-editor-root',
        tree: 'sd-prompt-lab-wildcard-editor-tree',
        search: 'sd-prompt-lab-wildcard-editor-search',
        host: 'sd-prompt-lab-wildcard-editor-host',
        tabs: 'sd-prompt-lab-wildcard-editor-tabs',
        path: 'sd-prompt-lab-wildcard-editor-path',
        status: 'sd-prompt-lab-wildcard-editor-status',
        save: 'sd-prompt-lab-wildcard-editor-save',
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
            throw new Error(data.detail || `Request failed: ${response.status}`);
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

    async function loadTree() {
        const data = await requestJson('/sd-prompt-lab/wildcards/editor/tree');
        state.tree = data.tree || [];
        renderTree();
    }

    function applyTreeDepth(row, depth) {
        row.style.setProperty('--spl-tree-depth', String(depth));
    }

    function createTreeNode(item, search, depth = 0) {
        if (search && item.type === 'folder') {
            const childMatches = (item.children || [])
                .map(child => createTreeNode(child, search, depth + 1))
                .filter(Boolean);
            if (!childMatches.length && !item.name.toLowerCase().includes(search)) return null;

            const folder = document.createElement('div');
            folder.className = 'spl-tree-folder is-open';
            const summary = createFolderRow(item, true);
            applyTreeDepth(summary, depth);
            folder.appendChild(summary);

            const list = document.createElement('ul');
            childMatches.forEach(child => list.appendChild(child));
            folder.appendChild(list);
            return folder;
        }

        if (item.type === 'folder') {
            const isOpen = state.openFolders.has(item.path);
            const folder = document.createElement('div');
            folder.className = `spl-tree-folder${isOpen ? ' is-open' : ''}`;
            const summary = createFolderRow(item, isOpen);
            applyTreeDepth(summary, depth);
            folder.appendChild(summary);
            const list = document.createElement('ul');
            if (isOpen) {
                (item.children || []).forEach(child => {
                    const node = createTreeNode(child, search, depth + 1);
                    if (node) list.appendChild(node);
                });
            }
            folder.appendChild(list);
            return folder;
        }

        if (search && !item.name.toLowerCase().includes(search) && !item.path.toLowerCase().includes(search)) {
            return null;
        }

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'spl-tree-row spl-tree-file';
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

        row.addEventListener('click', () => openFile(item.path).catch(error => setStatus(error.message, 'error')));
        row.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openFile(item.path).catch(error => setStatus(error.message, 'error'));
        });
        return row;
    }

    function createFolderRow(item, isOpen) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'spl-tree-row spl-tree-folder-row';
        row.dataset.path = item.path;
        row.dataset.type = 'folder';
        row.title = item.path;
        if (state.selectedPath === item.path) row.classList.add('is-selected');

        row.appendChild(icon(isOpen ? 'folder_open' : 'folder', 'spl-tree-icon spl-folder-icon'));

        const label = document.createElement('span');
        label.className = 'spl-tree-label';
        label.textContent = item.name;
        row.appendChild(label);
        row.addEventListener('click', () => toggleFolder(item.path));
        row.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggleFolder(item.path);
        });
        return row;
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
    }

    function renderTree() {
        const container = getEl(ids.tree);
        if (!container) return;

        const search = (getEl(ids.search)?.value || '').trim().toLowerCase();
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
            const node = createTreeNode(item, search, 0);
            if (node) list.appendChild(node);
        });
        container.appendChild(list);
    }

    function updateTabs() {
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

    function ensureEditor() {
        if (state.editor) return;

        const host = getEl(ids.host);
        host.innerHTML = '';
        state.editor = window.createSdPromptLabWildcardEditor({
            parent: host,
            doc: '',
            onChange: (doc) => {
                if (state.silentChange || !state.activePath) return;
                const file = state.files.get(state.activePath);
                if (!file) return;

                file.content = doc;
                file.dirty = file.content !== file.savedContent;
                updateTabs();
                updateHeader();
                validateActiveFile();

                if (file.dirty && isAutosaveEnabled()) {
                    scheduleAutosave();
                }
            }
        });

        host.addEventListener('click', handleEditorLinkClick);
    }

    function setEditorDocument(content) {
        state.silentChange = true;
        window.setSdPromptLabEditorDocument(state.editor, content || '');
        state.silentChange = false;
    }

    async function openFile(path) {
        path = ensureTxtPath(path);
        const existing = state.files.get(path);
        if (existing) {
            activateFile(path);
            return;
        }

        setStatus(`Opening ${path}...`);
        const data = await requestJson(`/sd-prompt-lab/wildcards/content?path=${encodeURIComponent(path)}`);
        state.files.set(path, {
            path,
            content: data.content || '',
            savedContent: data.content || '',
            dirty: false
        });
        activateFile(path);
        setStatus(`Opened ${path}`);
    }

    function activateFile(path) {
        ensureEditor();
        if (state.activePath && state.files.has(state.activePath)) {
            state.files.get(state.activePath).content = state.editor.state.doc.toString();
        }

        const file = state.files.get(path);
        if (!file) return;

        state.activePath = path;
        selectPath(path, 'file');
        setEditorDocument(file.content);
        updateTabs();
        updateHeader();
        validateActiveFile();
        state.editor.focus();
    }

    async function closeFile(path) {
        const file = state.files.get(path);
        if (!file) return;
        if (file.dirty) {
            const shouldClose = await awaitConfirm(`Close "${path}" without saving?`, 'Unsaved changes', 'close', 'Close');
            if (!shouldClose) return;
        }

        const paths = Array.from(state.files.keys());
        const index = paths.indexOf(path);
        state.files.delete(path);

        if (state.activePath === path) {
            const nextPath = paths[index + 1] || paths[index - 1] || null;
            state.activePath = null;
            if (nextPath && state.files.has(nextPath)) {
                activateFile(nextPath);
            } else {
                setEditorDocument('');
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

    function scheduleAutosave() {
        clearTimeout(state.autosaveTimer);
        state.autosaveTimer = setTimeout(() => saveActiveFile(true), 900);
    }

    async function saveActiveFile(isAuto = false) {
        if (!state.activePath || !state.files.has(state.activePath)) return;

        const file = state.files.get(state.activePath);
        file.content = state.editor.state.doc.toString();
        if (!file.dirty && file.content === file.savedContent) return;

        try {
            setStatus(isAuto ? `Autosaving ${file.path}...` : `Saving ${file.path}...`);
            await requestJson('/sd-prompt-lab/wildcards/save', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({path: file.path, content: file.content})
            });
            file.savedContent = file.content;
            file.dirty = false;
            updateTabs();
            updateHeader();
            setStatus(isAuto ? `Autosaved ${file.path}` : `Saved ${file.path}`, 'ok');
        } catch (error) {
            setStatus(error.message, 'error');
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
        const shouldDelete = await awaitConfirm(
            `This will remove "${selected.path}" from the wildcards directory.`,
            `Delete ${selected.type}`,
            'delete',
            'Delete',
            true
        );
        if (!shouldDelete) return;

        try {
            await requestJson('/sd-prompt-lab/wildcards/editor/delete', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({path: selected.path})
            });
            closeDeletedOpenFiles(selected.path, selected.type);
            await loadTree();
            state.selectedPath = null;
            state.selectedType = null;
            setStatus(`Deleted ${selected.path}`, 'ok');
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
        Array.from(state.files.keys()).forEach(filePath => {
            if (filePath === path || (type === 'folder' && filePath.startsWith(`${path}/`))) {
                state.files.delete(filePath);
                if (state.activePath === filePath) state.activePath = null;
            }
        });

        const nextPath = Array.from(state.files.keys())[0] || null;
        if (nextPath) activateFile(nextPath);
        else {
            if (state.editor) setEditorDocument('');
            updateTabs();
            updateHeader();
        }
    }

    function validateActiveFile() {
        if (!state.activePath || !state.editor) return;
        const content = state.editor.state.doc.toString();
        const weightedWildcard = /\{([^{}\n]*\d+(?:\.\d+)?::[^{}\n]*)\}/g;
        let match;

        while ((match = weightedWildcard.exec(content))) {
            const parts = match[1].split('|').map(part => part.trim()).filter(Boolean);
            if (!parts.length || !parts.every(part => /^-?\d+(?:\.\d+)?::/.test(part))) continue;

            const sum = parts.reduce((total, part) => total + Number(part.split('::')[0]), 0);
            if (Math.abs(sum - 1) > 0.001) {
                setStatus(`Weighted wildcard sum is ${sum.toFixed(3)} in ${match[0]}`, 'warn');
                return;
            }
        }

        const file = state.files.get(state.activePath);
        if (file?.dirty) setStatus('Unsaved changes', 'warn');
    }

    async function handleEditorLinkClick(event) {
        if (!state.editor || !(event.metaKey || event.ctrlKey)) return;
        const pos = state.editor.posAtCoords({x: event.clientX, y: event.clientY});
        if (pos == null) return;

        const doc = state.editor.state.doc.toString();
        const linkRegex = /__([^_\n]+?)__/g;
        let match;
        while ((match = linkRegex.exec(doc))) {
            if (pos >= match.index && pos <= match.index + match[0].length) {
                event.preventDefault();
                const linkedPath = ensureTxtPath(match[1]);
                try {
                    await openFile(linkedPath);
                } catch (error) {
                    setStatus(`Linked wildcard not found: ${linkedPath}`, 'error');
                }
                return;
            }
        }
    }

    function setupEvents() {
        getEl(ids.newFile)?.addEventListener('click', createFile);
        getEl(ids.newFolder)?.addEventListener('click', createFolder);
        getEl(ids.refresh)?.addEventListener('click', () => loadTree().catch(error => setStatus(error.message, 'error')));
        getEl(ids.save)?.addEventListener('click', () => saveActiveFile(false));
        getEl(ids.rename)?.addEventListener('click', renameSelected);
        getEl(ids.delete)?.addEventListener('click', deleteSelected);
        getEl(ids.search)?.addEventListener('input', renderTree);
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

        getEl(ids.root)?.addEventListener('keydown', event => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                saveActiveFile(false);
            }
        });
    }

    async function init() {
        if (state.initialized || !getEl(ids.root)) return;
        state.initialized = true;

        try {
            await window.sdPromptLabLoadCodeMirror();
            setupEvents();
            await loadTree();
            setStatus('Ready');
        } catch (error) {
            setStatus(error.message, 'error');
            console.error(error);
        }
    }

    return {init};
})();

onUiLoaded(() => {
    sdPromptLabWildcardEditor.init();
});
