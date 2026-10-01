const escapeHtml = (value) => window.spl.escapeHtml(value);

// Prompts shown in the Browse tab, keyed by id (card buttons look their prompt up here).
const loadedPrompts = new Map();

function setOverrideChecked(checked) {
    const overrideBlock = gradioApp().getElementById('sd-prompt-lab-override-checkbox');
    const checkbox = overrideBlock?.querySelector('input[type="checkbox"]');
    if (!checkbox || checkbox.checked === checked) return;
    checkbox.checked = checked;
    checkbox.dispatchEvent(new Event('change', {bubbles: true}));
}

function getSearchInputText() {
    const searchInput = gradioApp().getElementById('sd-prompt-lab-search-input');
    return searchInput.querySelector('textarea')?.value || '';
}


function fillCreateTabFields(prompt) {
    const nameInput = gradioApp().getElementById('sd-prompt-lab-name-input');
    const descInput = gradioApp().getElementById('sd-prompt-lab-description-input');
    const imagePathInput = gradioApp().getElementById('sd-prompt-lab-image-path-input');

    // Find textarea inside Gradio block
    const getTextArea = (block) => block ? block.querySelector('textarea') : null;

    const nameArea = getTextArea(nameInput);
    const descArea = getTextArea(descInput);
    const imageArea = getTextArea(imagePathInput);

    if (nameArea) nameArea.value = prompt.name || '';
    if (descArea) descArea.value = prompt.description || '';
    if (imageArea) imageArea.value = prompt.image_path || '';

    // Update CodeMirror content
    if (window.sdPromptLabEditor) {
        window.sdPromptLabEditor.dispatch({
            changes: {from: 0, to: window.sdPromptLabEditor.state.doc.length, insert: prompt.prompt || ''}
        });
    }

    // A freshly opened prompt never starts with "Override existing" ticked.
    setOverrideChecked(false);
}


function switchToCreateTab() {
    window.spl.openTab('sd-prompt-lab-create-tab');
}

const loadCards = async () => {
    const search = getSearchInputText();
    const cardsContainer = gradioApp().getElementById('sd-prompt-lab-cards-output');

    try {
        const url = search
            ? `/sd-prompt-lab/all?search=${encodeURIComponent(search)}`
            : '/sd-prompt-lab/all';
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to load prompts');
        const data = await response.json();

        loadedPrompts.clear();
        data.prompts.forEach(p => loadedPrompts.set(String(p.id), p));

        let html = `<div style="
                display: flex;
                flex-wrap: wrap;
                gap: 16px;
                justify-content: space-between;
            ">`;

        data.prompts.forEach(p => {
            const thumbnail = p.image_path ? `/sd-prompt-lab/thumbnail/${p.id}` : '';
            const favoriteIcon = p.is_favorite ? '❤️' : '🩶';

            html += `
                    <div style="
                        width: 48%;
                        min-height: 250px;
                        position: relative;
                        border: 1px solid #444;
                        border-radius: 12px;
                        padding: 12px;
                        display: flex;
                        flex-direction: column;
                        background: #1e1e1e;
                        box-shadow: 0 0 6px #000;
                        color: #ccc;
                    ">

                        <!-- Image -->
                        ${thumbnail ? `<img src="${thumbnail}" style="
                            position: absolute;
                            top: 12px;
                            right: 12px;
                            width: 125px;
                            height: 175px;
                            object-fit: cover;
                            border-radius: 6px;
                        ">` : ''}

                        <!-- Main content -->
                        <div style="flex: 1;">
                            <div style="font-weight: bold; color: #eee; font-size: 18px;">${escapeHtml(p.name)}</div>
                            ${p.description ? `<div style="color: #aaa; font-size: 13px; margin-top: 4px;">${escapeHtml(p.description)}</div>` : ''}
                            <div style="
                                margin-top: 8px;
                                margin-right: ${thumbnail ? '145px' : '0'};
                                color: #ccc;
                                font-size: 13px;
                                white-space: pre-wrap;
                                word-break: break-word;
                                max-height: 200px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                display: -webkit-box;
                                -webkit-line-clamp: 12; /* approximate line limit for 200px */
                                -webkit-box-orient: vertical;
                            ">${escapeHtml(p.prompt)}</div>

                        </div>

                        <!-- Buttons -->
                        <div style="
                            margin-top: 12px;
                            display: flex;
                            flex-wrap: wrap;
                            gap: 8px;
                        ">
                            <button data-id="${p.id}" data-action="preview" style="
                                padding: 4px 10px;
                                background: #333;
                                color: #ddd;
                                border: 1px solid #555;
                                border-radius: 6px;
                                cursor: pointer;
                            ">👁 preview</button>
                            <button data-id="${p.id}" data-action="txt2img" style="
                                padding: 4px 10px;
                                background: #333;
                                color: #ddd;
                                border: 1px solid #555;
                                border-radius: 6px;
                                cursor: pointer;
                            ">🖼 txt2img</button>
                            <button data-id="${p.id}" data-action="edit" style="
                                padding: 4px 10px;
                                background: #333;
                                color: #ddd;
                                border: 1px solid #555;
                                border-radius: 6px;
                                cursor: pointer;
                            ">✏️ edit</button>
                            <button data-id="${p.id}" data-action="remove" style="
                                padding: 4px 10px;
                                background: #333;
                                color: #ddd;
                                border: 1px solid #555;
                                border-radius: 6px;
                                cursor: pointer;
                            ">🗑 remove</button>
                            <button data-id="${p.id}" data-action="copy" style="
                                padding: 4px 10px;
                                background: #333;
                                color: #ddd;
                                border: 1px solid #555;
                                border-radius: 6px;
                                cursor: pointer;
                            ">📋 copy</button>
                            <button data-id="${p.id}" data-action="favorite" data-favorite="${p.is_favorite}" style="
                                padding: 4px 10px;
                                background: #333;
                                color: #ddd;
                                border: 1px solid #555;
                                border-radius: 6px;
                                cursor: pointer;
                            ">${favoriteIcon}</button>
                        </div>
                    </div>
                `;
        });

        html += `</div>`;
        cardsContainer.innerHTML = html;

    } catch (e) {
        cardsContainer.innerHTML = `<div style="color: red;">${escapeHtml(e.message)}</div>`;
    }
};

function setupBrowseTab() {
    const refreshButton = gradioApp().getElementById('sd-prompt-lab-refresh-button');
    const cardsContainer = gradioApp().getElementById('sd-prompt-lab-cards-output');
    const clearSearchButton = document.getElementById('sd-prompt-lab-clear-search-button');

    const searchInput = gradioApp().getElementById('sd-prompt-lab-search-input');
    if (searchInput) {
        const textarea = searchInput.querySelector('textarea');
        textarea.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            loadCards(value);
        });
    }

    if (refreshButton && cardsContainer && clearSearchButton) {
        refreshButton.addEventListener('click', loadCards);
        clearSearchButton.addEventListener('click', () => {
            const searchInput = gradioApp().getElementById('sd-prompt-lab-search-input');
            const searchTextArea = searchInput.querySelector('textarea')
            if (searchTextArea) searchTextArea.value = '';
            loadCards()
        })
        loadCards(); // auto-load

        cardsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-id]');
            if (!btn) return;
            const id = btn.dataset.id;
            const action = btn.dataset.action;
            const prompt = loadedPrompts.get(String(id));
            const promptText = prompt?.prompt || '';

            if (action === 'preview') {
                if (prompt && typeof window.sdPromptLabShowPreview === 'function') {
                    window.sdPromptLabShowPreview(prompt);
                }
            } else if (action === 'favorite') {
                const isFavorite = btn.dataset.favorite === '1'; // because it's "0" or "1"
                const newFavorite = !isFavorite;

                fetch(`/sd-prompt-lab/favorite/${id}?is_favorite=${newFavorite}`, {method: 'POST'})
                    .then((res) => res.json())
                    .then(() => {
                        btn.dataset.favorite = newFavorite ? '1' : '0';
                        btn.innerText = newFavorite ? '❤️' : '🩶';
                    })
                    .catch(() => window.spl.toast('Failed to update favorite', 'error'));
            } else if (action === 'remove') {
                window.spl.confirm({
                    title: 'Delete this prompt?',
                    message: `"${prompt?.name || id}" will be removed. This cannot be undone.`,
                    confirmLabel: 'Delete',
                    danger: true,
                }).then((confirmed) => {
                    if (!confirmed) return;
                    fetch(`/sd-prompt-lab/delete/${id}`, {method: 'DELETE'})
                        .then((res) => {
                            if (!res.ok) throw new Error('Failed to delete prompt');
                            window.spl.toast('Prompt deleted');
                            loadCards();
                        })
                        .catch((e) => window.spl.toast(e.message, 'error'));
                });
            } else if (action === 'edit') {
                fetch(`/sd-prompt-lab/${id}`)
                    .then((res) => res.json())
                    .then((data) => {
                        if (data.status === 'ok') {
                            fillCreateTabFields(data.prompt);
                            switchToCreateTab();
                        } else {
                            window.spl.toast('Failed to load prompt data', 'error');
                        }
                    })
                    .catch(() => window.spl.toast('Failed to load prompt data', 'error'));
            } else if (action === 'txt2img') {
                updateTxt2ImgPositivePrompt(promptText);
            } else if (action === 'copy') {
                if (!promptText) return;
                window.spl.copyToClipboard(promptText).then((ok) => {
                    if (!ok) {
                        window.spl.toast('Failed to copy', 'error');
                        return;
                    }
                    btn.innerText = '✅ copied';
                    setTimeout(() => {
                        btn.innerText = '📋 copy';
                    }, 1500);
                });
            }
        });
    }
}

function setupClearFieldsButton() {
    const clearFieldsButton = document.getElementById('sd-prompt-lab-clear-button');
    const nameBlock = document.getElementById('sd-prompt-lab-name-input');
    const descriptionBlock = document.getElementById('sd-prompt-lab-description-input');
    const imagePathBlock = document.getElementById('sd-prompt-lab-image-path-input');
    const overrideBlock = document.getElementById('sd-prompt-lab-override-checkbox');

    if (clearFieldsButton && nameBlock && descriptionBlock && imagePathBlock && overrideBlock) {
        clearFieldsButton.addEventListener('click', async () => {
            const setValue = (block) => {
                const textarea = block.querySelector('textarea');
                if (textarea) {
                    textarea.value = '';
                    textarea.dispatchEvent(new Event('input', {bubbles: true}));
                }
            };

            setValue(nameBlock);
            setValue(descriptionBlock);
            setValue(imagePathBlock);

            if (window.sdPromptLabEditor) {
                window.sdPromptLabEditor.dispatch({
                    changes: {from: 0, to: window.sdPromptLabEditor.state.doc.length, insert: ''}
                });
            }

            setOverrideChecked(false);

            window.spl.toast('Fields cleared');
        });
    }
}


function setupSaveButton() {
    const saveButton = document.getElementById('sd-prompt-lab-save-button');
    const nameBlock = document.getElementById('sd-prompt-lab-name-input');
    const descriptionBlock = document.getElementById('sd-prompt-lab-description-input');
    const imagePathBlock = document.getElementById('sd-prompt-lab-image-path-input');
    const overrideBlock = document.getElementById('sd-prompt-lab-override-checkbox');

    if (saveButton && nameBlock && descriptionBlock && imagePathBlock && overrideBlock) {
        saveButton.addEventListener('click', async () => {
            const getValue = (block) => block.querySelector('textarea')?.value.trim() || '';
            const name = getValue(nameBlock);
            const description = getValue(descriptionBlock);
            const image_path = getValue(imagePathBlock);
            const prompt = window.sdPromptLabEditor?.state.doc.toString().trim() || '';

            const override = overrideBlock.querySelector('input[type="checkbox"]')?.checked || false;

            if (!name || !prompt) {
                window.spl.toast('Name and Prompt are required', 'warn');
                return
            }

            if (!name.trim() || !prompt.trim()) {
                window.spl.toast('Name and Prompt are required', 'warn');
                return
            }

            const data = {name, description, image_path, prompt, override};

            try {
                const response = await fetch('/sd-prompt-lab/save', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    window.spl.toast('Saved successfully');
                    loadCards();   // keep the Browse tab in sync with the saved prompt
                } else {
                    const error = await response.json();
                    throw new Error(error.detail || "Unknown error");
                }
            } catch (e) {
                window.spl.toast(`Save failed: ${e.message}`, 'error');
            }
        });
    }
}

function updateTxt2ImgPositivePrompt(codeContent) {
    const promptBlock = document.getElementById('txt2img_prompt');
    const textarea = promptBlock?.querySelector('textarea');

    if (!textarea) {
        console.warn('txt2img prompt textarea not found');
        return;
    }

    // 3. Set content
    textarea.value = codeContent;
    // Dispatch input event so Gradio knows content changed
    textarea.dispatchEvent(new Event('input', {bubbles: true}));

    window.spl.openTxt2Img();
}


function setupTxt2ImgButton() {
    const txt2imgButton = document.getElementById('sd-prompt-lab-txt2img-button');

    if (txt2imgButton) {
        txt2imgButton.addEventListener('click', () => {
            // 1. Get CodeMirror content
            const codeContent = window.sdPromptLabEditor?.state.doc.toString().trim();

            if (!codeContent) {
                console.warn('CodeMirror content is empty');
                return;
            }

            updateTxt2ImgPositivePrompt(codeContent);
        });
    }
}

function cleanUpPrompt() {
    let prompt = window.sdPromptLabEditor?.state.doc.toString().trim() || '';

    const seen = new Set();

    const parts = prompt
        .split(',')
        .map(p => p.trim())
        .filter(p => {
            const key = p.toLowerCase(); // use lowercase for comparison
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    prompt = parts.join(', ');

    if (window.sdPromptLabEditor) {
        window.sdPromptLabEditor.dispatch({
            changes: {from: 0, to: window.sdPromptLabEditor.state.doc.length, insert: prompt}
        });
    }
}

function removeUnmatchedBrackets(str) {
    const pairs = {'(': ')', '{': '}', '<': '>'};
    const open = Object.keys(pairs);
    const close = Object.values(pairs);
    const stack = [];

    const keep = new Array(str.length).fill(true);

    for (let i = 0; i < str.length; i++) {
        const char = str[i];

        if (open.includes(char)) {
            stack.push({char, index: i});
        } else if (close.includes(char)) {
            const matchIndex = stack.findLastIndex(item => pairs[item.char] === char);
            if (matchIndex !== -1) {
                stack.splice(matchIndex, 1); // valid pair, leave them
            } else {
                keep[i] = false; // unmatched closing
            }
        }
    }

    // remove leftover unmatched openings
    for (const item of stack) {
        keep[item.index] = false;
    }

    return [...str].filter((_, i) => keep[i]).join('');
}


function reformatPrompt() {
    let prompt = window.sdPromptLabEditor?.state.doc.toString().trim() || '';
    prompt = prompt.replace(/BREAK/gi, '')  // remove all "BREAK"
        .replace(/\s+/g, ' ')      // collapse all whitespace
        .replace(/\s+,/g, ', ')    // remove space before comma, add one after
        .replace(/,(?!\s)/g, ', ') // ensure space after comma
        .split(',')                              // split by comma
        .map(item => item.trim())                  // trim each part
        .filter(item => item.length > 0)           // remove empty entries
        .join(', ')                                       // join with clean commas
        .trim();                                          // final trim

    // Step 2: Extract LoRA tags
    const loraRegex = /<lora:[^>]+?>/gi;
    const loraMatches = [...prompt.matchAll(loraRegex)].map(m => m[0]);

    // Step 3: Remove LoRA tags from main prompt
    let cleanedPrompt = prompt.replace(loraRegex, '').replace(/\s+/g, ' ').trim();
    cleanedPrompt = removeUnmatchedBrackets(cleanedPrompt);

    // Step 4: Split, clean and filter empty entries
    const promptParts = cleanedPrompt
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    // Step 5: Join main prompt and LoRAs
    const finalPrompt = promptParts.join(', ') + (loraMatches.length > 0 ? ',' : '');
    const loraLine = loraMatches.join(', ');

    const clearedPrompt = loraMatches.length > 0 ? `${finalPrompt}\n${loraLine}` : finalPrompt;

    if (window.sdPromptLabEditor) {
        window.sdPromptLabEditor.dispatch({
            changes: {from: 0, to: window.sdPromptLabEditor.state.doc.length, insert: clearedPrompt}
        });
    }
}

function onButtonClick(buttonId, onClick) {
    const button = document.getElementById(buttonId);
    if (button && typeof onClick === 'function') {
        button.addEventListener('click', async () => {
            await onClick();
        });
    }
}

function setupPromptCleanUpButton() {
    onButtonClick('sd-prompt-lab-clean-up-button', async () => {
        reformatPrompt();
        cleanUpPrompt();
        reformatPrompt();
        window.spl.toast('Prompt cleaned up');
    });
}

function setupPromptReformatButton() {
    onButtonClick('sd-prompt-lab-reformat-button', async () => {
        reformatPrompt()
        window.spl.toast('Prompt reformatted');
    });
}

onUiLoaded(() => {
    window.spl.loadCodeMirror().then(() => {
        window.initCodeMirror6('#code-editor');
    }).catch((error) => {
        console.error(error);
    });

    setupSaveButton()
    setupTxt2ImgButton()
    setupClearFieldsButton()
    setupBrowseTab()

    setupPromptCleanUpButton()
    setupPromptReformatButton()
});
