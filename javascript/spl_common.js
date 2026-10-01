// Shared browser helpers for every Prompt Lab tab, exposed as `window.spl`.
(() => {
    const EXTENSION_PATH = 'extensions/sd-prompt-lab';

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    }

    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) {
            // Not permitted (insecure context, no focus): fall back to execCommand below.
        }
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

    // ---- assets ------------------------------------------------------------------
    // Files are versioned by their modification time, so the browser can cache them and
    // still picks up a new build right away.

    let versions = {};

    const ready = fetch('/sd-prompt-lab/assets')
        .then((res) => (res.ok ? res.json() : {}))
        .then((data) => {
            versions = data.versions || {};
        })
        .catch(() => {});

    function assetUrl(path) {
        const version = versions[path];
        return `/file=${EXTENSION_PATH}/${path}${version ? `?v=${version}` : ''}`;
    }

    const pending = new Map();

    function loadOnce(id, create) {
        if (!pending.has(id)) {
            pending.set(id, ready.then(() => new Promise((resolve, reject) => {
                if (document.getElementById(id)) {
                    resolve();
                    return;
                }
                const el = create();
                el.id = id;
                el.onload = () => resolve();
                el.onerror = () => {
                    pending.delete(id);
                    el.remove();
                    reject(new Error(`Failed to load ${id}`));
                };
                document.head.appendChild(el);
            })));
        }
        return pending.get(id);
    }

    function loadStyle(id, path) {
        return loadOnce(id, () => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = assetUrl(path);
            return link;
        });
    }

    function loadScript(id, path) {
        return loadOnce(id, () => {
            const script = document.createElement('script');
            script.src = assetUrl(path);
            return script;
        });
    }

    // Icons, dialogs and toasts: needed by every tab.
    const commonStyle = loadStyle('sd-prompt-lab-common-style', 'javascript/spl_common.css');
    commonStyle.catch((e) => console.error(e));

    // The CodeMirror bundle plus the editor stylesheet.
    function loadCodeMirror() {
        return Promise.all([
            commonStyle,
            loadStyle('sd-prompt-lab-editor-style', 'editor/style.css'),
            loadScript('sd-prompt-lab-codemirror-bundle', 'javascript/lib/codemirror6.bundle.js'),
        ]).then(() => {
            if (!window.initCodeMirror6 || !window.createSdPromptLabWildcardEditor) {
                throw new Error('CodeMirror bundle did not initialise');
            }
        });
    }

    // ---- tabs --------------------------------------------------------------------
    // Gradio tab buttons carry no id, so a button is found through its panel: the Nth
    // `.tabitem` of a tab group is opened by the Nth button of that group's `.tab-nav`.

    function tabParts(panelId) {
        const panel = gradioApp()?.getElementById(panelId);
        const group = panel?.parentElement;
        if (!group) return null;
        const panels = Array.from(group.children).filter((el) => el.classList.contains('tabitem'));
        const nav = Array.from(group.children).find((el) => el.classList.contains('tab-nav'));
        if (!nav) return null;
        return {nav, index: panels.indexOf(panel)};
    }

    function tabButton(panelId) {
        const parts = tabParts(panelId);
        return parts ? parts.nav.querySelectorAll('button')[parts.index] || null : null;
    }

    // Runs `callback` every time the tab is opened. Gradio re-creates a tab's button when
    // its selected state changes, so the listener sits on the (stable) nav container. It
    // listens in the capture phase: by the time the click bubbles up, Gradio may already
    // have replaced the clicked button, and its position could no longer be told.
    function onTabOpened(panelId, callback) {
        const parts = tabParts(panelId);
        if (!parts) return false;
        parts.nav.addEventListener('click', (event) => {
            const button = event.target.closest?.('button');
            if (!button || !parts.nav.contains(button)) return;
            if (Array.from(parts.nav.querySelectorAll('button')).indexOf(button) !== parts.index) return;
            // Run once Gradio has shown the panel.
            setTimeout(callback, 0);
        }, true);
        return true;
    }

    function openTab(panelId) {
        const button = tabButton(panelId);
        if (button) button.click();
        return !!button;
    }

    function openTxt2Img() {
        if (typeof switch_to_txt2img === 'function') {
            switch_to_txt2img();
            return true;
        }
        return openTab('tab_txt2img');
    }

    // ---- toasts ------------------------------------------------------------------

    const TOAST_ICONS = {ok: 'check_circle', warn: 'warning', error: 'error'};

    function toast(message, tone = 'ok') {
        if (!message) return;
        let host = document.getElementById('sd-prompt-lab-toasts');
        if (!host) {
            host = document.createElement('div');
            host.id = 'sd-prompt-lab-toasts';
            host.className = 'spl-toasts';
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        const el = document.createElement('div');
        el.className = `spl-toast spl-toast-${TOAST_ICONS[tone] ? tone : 'ok'}`;
        el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        el.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">${TOAST_ICONS[tone] || TOAST_ICONS.ok}</span>`
            + `<span class="spl-toast-text">${escapeHtml(message)}</span>`;
        host.appendChild(el);

        const dismiss = () => {
            el.classList.add('is-leaving');
            setTimeout(() => el.remove(), 200);
        };
        el.addEventListener('click', dismiss);
        setTimeout(dismiss, tone === 'error' ? 6000 : 4000);
    }

    // ---- confirm dialog ----------------------------------------------------------

    // Resolves true (confirmed), false (cancelled / Escape) or 'extra' (the optional
    // third button, when `extraLabel` is given).
    function confirmDialog({
        title = 'Are you sure?',
        message = '',
        confirmLabel = 'OK',
        cancelLabel = 'Cancel',
        extraLabel = '',
        danger = false,
    } = {}) {
        return new Promise((resolve) => {
            const previousFocus = document.activeElement;
            const backdrop = document.createElement('div');
            backdrop.className = 'spl-confirm-backdrop';
            backdrop.innerHTML = `
                <div class="spl-confirm" role="alertdialog" aria-modal="true" aria-labelledby="spl-confirm-title">
                    <div id="spl-confirm-title" class="spl-confirm-title">
                        <span class="material-symbols-rounded" aria-hidden="true">${danger ? 'warning' : 'help'}</span>
                        <span>${escapeHtml(title)}</span>
                    </div>
                    ${message ? `<div class="spl-confirm-message">${escapeHtml(message)}</div>` : ''}
                    <div class="spl-confirm-actions">
                        <button type="button" class="spl-confirm-btn" data-result="cancel">${escapeHtml(cancelLabel)}</button>
                        ${extraLabel ? `<button type="button" class="spl-confirm-btn" data-result="extra">${escapeHtml(extraLabel)}</button>` : ''}
                        <button type="button" class="spl-confirm-btn ${danger ? 'is-danger' : 'is-primary'}" data-result="confirm">${escapeHtml(confirmLabel)}</button>
                    </div>
                </div>`;

            const finish = (result) => {
                document.removeEventListener('keydown', onKeyDown, true);
                backdrop.remove();
                if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
                resolve(result);
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false);
                }
            };

            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop) {
                    finish(false);
                    return;
                }
                const result = event.target.closest('[data-result]')?.dataset.result;
                if (result) finish(result === 'extra' ? 'extra' : result === 'confirm');
            });
            document.addEventListener('keydown', onKeyDown, true);
            document.body.appendChild(backdrop);
            // A destructive action should not be one accidental Enter away.
            backdrop.querySelector(`[data-result="${danger ? 'cancel' : 'confirm'}"]`).focus();
        });
    }

    window.spl = {
        escapeHtml,
        copyToClipboard,
        ready,
        assetUrl,
        loadStyle,
        loadCodeMirror,
        onTabOpened,
        openTab,
        openTxt2Img,
        toast,
        confirm: confirmDialog,
    };

    // Older name, still used by the bundle's consumers.
    window.sdPromptLabLoadCodeMirror = loadCodeMirror;
})();
