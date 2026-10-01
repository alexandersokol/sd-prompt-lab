// Read-only prompt preview popup used by the Browse tab.
(() => {
    let backdrop = null;
    let view = null;
    let current = null;

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

    function close() {
        if (!backdrop) return;
        backdrop.hidden = true;
        if (view) {
            view.destroy();
            view = null;
        }
        current = null;
        document.removeEventListener('keydown', onKeyDown, true);
    }

    function onKeyDown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
    }

    function ensureDom() {
        if (backdrop) return;
        backdrop = document.createElement('div');
        backdrop.className = 'spl-preview-backdrop';
        backdrop.hidden = true;
        backdrop.innerHTML = `
            <div class="spl-preview" role="dialog" aria-modal="true" aria-labelledby="spl-preview-title">
                <div class="spl-preview-header">
                    <div class="spl-preview-heading">
                        <div id="spl-preview-title" class="spl-preview-title"></div>
                        <div class="spl-preview-desc"></div>
                    </div>
                    <button type="button" class="spl-preview-icon-btn" data-action="close" title="Close" aria-label="Close">
                        <span class="material-symbols-rounded" aria-hidden="true">close</span>
                    </button>
                </div>
                <div class="spl-preview-body"></div>
                <div class="spl-preview-footer">
                    <div class="spl-preview-meta"></div>
                    <button type="button" class="spl-preview-btn spl-preview-btn-primary" data-action="copy">
                        <span class="material-symbols-rounded" aria-hidden="true">content_copy</span>
                        <span class="spl-preview-copy-label">Copy</span>
                    </button>
                    <button type="button" class="spl-preview-btn" data-action="close">Close</button>
                </div>
            </div>`;
        document.body.appendChild(backdrop);

        backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) {
                close();
                return;
            }
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (action === 'close') {
                close();
            } else if (action === 'copy' && current) {
                const label = backdrop.querySelector('.spl-preview-copy-label');
                label.textContent = copyToClipboard(current.prompt || '') ? 'Copied!' : 'Copy failed';
                setTimeout(() => {
                    label.textContent = 'Copy';
                }, 1500);
            }
        });
    }

    // ---- sample expansions --------------------------------------------------------

    async function fetchSamples(prompt, count = 6) {
        const res = await fetch('/sd-prompt-lab/sample', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({prompt, count}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `Request failed: ${res.status}`);
        return data.samples || [];
    }

    let samplesBackdrop = null;

    function closeSamples() {
        if (!samplesBackdrop) return;
        samplesBackdrop.remove();
        samplesBackdrop = null;
        document.removeEventListener('keydown', onSamplesKeyDown, true);
    }

    function onSamplesKeyDown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        closeSamples();
    }

    function renderSamples(list, samples) {
        list.innerHTML = samples.map((sample, i) => `
            <div class="spl-sample">
                <span class="spl-sample-num">${i + 1}</span>
                <span class="spl-sample-text">${window.spl.escapeHtml(sample)}</span>
                <button type="button" class="spl-preview-icon-btn" data-copy="${i}" title="Copy" aria-label="Copy">
                    <span class="material-symbols-rounded" aria-hidden="true">content_copy</span>
                </button>
            </div>`).join('');
    }

    // Random expansions of `prompt` by the Dynamic Prompts library, with Re-roll.
    window.sdPromptLabShowSamples = async ({title = 'Sample expansions', prompt}) => {
        let samples;
        try {
            await window.spl.loadCodeMirror();   // popup styles live in the editor stylesheet
            samples = await fetchSamples(prompt);
        } catch (e) {
            window.spl.toast(e.message, 'error');
            return;
        }

        closeSamples();
        samplesBackdrop = document.createElement('div');
        samplesBackdrop.className = 'spl-preview-backdrop';
        samplesBackdrop.innerHTML = `
            <div class="spl-preview" role="dialog" aria-modal="true" aria-labelledby="spl-samples-title">
                <div class="spl-preview-header">
                    <div class="spl-preview-heading">
                        <div id="spl-samples-title" class="spl-preview-title">${window.spl.escapeHtml(title)}</div>
                        <div class="spl-preview-desc">Random results of the dynamic syntax. Each roll is different.</div>
                    </div>
                    <button type="button" class="spl-preview-icon-btn" data-action="close" title="Close" aria-label="Close">
                        <span class="material-symbols-rounded" aria-hidden="true">close</span>
                    </button>
                </div>
                <div class="spl-preview-body spl-samples"></div>
                <div class="spl-preview-footer">
                    <div class="spl-preview-meta"></div>
                    <button type="button" class="spl-preview-btn spl-preview-btn-primary" data-action="reroll">
                        <span class="material-symbols-rounded" aria-hidden="true">casino</span>
                        <span>Re-roll</span>
                    </button>
                    <button type="button" class="spl-preview-btn" data-action="close">Close</button>
                </div>
            </div>`;
        const list = samplesBackdrop.querySelector('.spl-samples');
        renderSamples(list, samples);

        samplesBackdrop.addEventListener('click', async (event) => {
            if (event.target === samplesBackdrop) {
                closeSamples();
                return;
            }
            const copy = event.target.closest('[data-copy]');
            if (copy) {
                const ok = await window.spl.copyToClipboard(samples[Number(copy.dataset.copy)] || '');
                window.spl.toast(ok ? 'Copied' : 'Failed to copy', ok ? 'ok' : 'error');
                return;
            }
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (action === 'close') {
                closeSamples();
            } else if (action === 'reroll') {
                try {
                    samples = await fetchSamples(prompt);
                    if (samplesBackdrop) renderSamples(list, samples);
                } catch (e) {
                    window.spl.toast(e.message, 'error');
                }
            }
        });
        document.body.appendChild(samplesBackdrop);
        document.addEventListener('keydown', onSamplesKeyDown, true);
        samplesBackdrop.querySelector('[data-action="reroll"]').focus();
    };

    window.sdPromptLabShowPreview = async (prompt) => {
        try {
            await window.spl.loadCodeMirror();   // also loads the popup styles
        } catch (e) {
            console.error(e);
        }
        ensureDom();
        if (view) {
            view.destroy();
            view = null;
        }
        current = prompt;

        const text = prompt.prompt || '';
        const desc = backdrop.querySelector('.spl-preview-desc');
        const body = backdrop.querySelector('.spl-preview-body');
        backdrop.querySelector('.spl-preview-title').textContent = prompt.name || 'Prompt';
        desc.textContent = prompt.description || '';
        desc.hidden = !prompt.description;
        backdrop.querySelector('.spl-preview-meta').textContent =
            `${text.length.toLocaleString()} characters`;

        body.innerHTML = '';
        if (typeof window.createSdPromptLabReadOnlyView === 'function') {
            view = window.createSdPromptLabReadOnlyView({parent: body, doc: text});
        }
        if (!view) {
            const pre = document.createElement('pre');
            pre.className = 'spl-preview-plain';
            pre.textContent = text;
            body.appendChild(pre);
        }

        backdrop.hidden = false;
        body.scrollTop = 0;
        document.addEventListener('keydown', onKeyDown, true);
        backdrop.querySelector('[data-action="copy"]').focus();
    };
})();
