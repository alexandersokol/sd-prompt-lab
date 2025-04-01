function showPopupMessage(message) {
    const outputHtml = document.getElementById('sd-prompt-lab-output-html');
    outputHtml.innerHTML = message
    setTimeout(() => {
        outputHtml.innerHTML = '';
    }, 5000);
}

function showInfoMessage(content) {
    if (content) {
        const message = `<div style="
          background-color: rgba(74,255,2,0.4);
          color: white;
          height: 48px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          font-size: 14px;
        ">✅ ${content}</div>`;

        showPopupMessage(message);
    }
}

function showWarningMessage(content) {
    if (content) {
        const message = `<div style="
          background-color: rgba(255,213,0,0.4);
          color: white;
          height: 48px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          font-size: 14px;
        ">⚠️ ${content}</div>`;

        showPopupMessage(message);
    }
}

function showErrorMessage(content) {
    if (content) {
        const message = `<div style="
          background-color: rgba(202,14,15,0.4);
          color: white;
          height: 48px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          font-size: 14px;
        ">🆘 ${content}</div>`;

        showPopupMessage(message);
    }
}


function setupBrowseTab() {
    const refreshButton = gradioApp().getElementById('sd-prompt-lab-refresh-button');
    const cardsContainer = gradioApp().getElementById('sd-prompt-lab-cards-output');

    const loadCards = async () => {
        try {
            const response = await fetch('/sd-prompt-lab/all');
            if (!response.ok) throw new Error('Failed to load prompts');
            const data = await response.json();

            let html = `<div style="
                display: flex;
                flex-wrap: wrap;
                gap: 16px;
                justify-content: space-between;
            ">`;

            data.prompts.forEach(p => {
                const thumbnail = p.image_path ? `/sd-prompt-lab/thumbnail/${p.id}` : '';

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
                            <div style="font-weight: bold; color: #eee; font-size: 18px;">${p.name}</div>
                            ${p.description ? `<div style="color: #aaa; font-size: 13px; margin-top: 4px;">${p.description}</div>` : ''}
                            <div style="
                                margin-top: 8px;
                                margin-right: ${thumbnail ? '145px' : '0'};
                                color: #ccc;
                                font-size: 13px;
                                white-space: pre-wrap;
                                word-break: break-word;
                            ">${p.prompt}</div>
                        </div>

                        <!-- Buttons -->
                        <div style="
                            margin-top: 12px;
                            display: flex;
                            gap: 8px;
                        ">
                            <button data-id="${p.id}" data-action="txt2img" data-prompt="${p.prompt}" style="
                                padding: 4px 10px;
                                background: #333;
                                color: #ddd;
                                border: 1px solid #555;
                                border-radius: 6px;
                                cursor: pointer;
                            ">🏞 txt2img</button>
                            <button data-id="${p.id}" data-action="edit" data-prompt="${p.prompt}" style="
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
                            <button data-id="${p.id}" data-action="copy" data-prompt="${p.prompt}" style="
                                padding: 4px 10px;
                                background: #333;
                                color: #ddd;
                                border: 1px solid #555;
                                border-radius: 6px;
                                cursor: pointer;
                            ">📋 copy</button>
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
            cardsContainer.innerHTML = html;

        } catch (e) {
            cardsContainer.innerHTML = `<div style="color: red;">${e.message}</div>`;
        }
    };

    if (refreshButton && cardsContainer) {
        refreshButton.addEventListener('click', loadCards);
        loadCards(); // auto-load

        cardsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-id]');
            if (!btn) return;
            const id = btn.dataset.id;
            const action = btn.dataset.action;
            const promptText = btn.dataset.prompt || '';

            if (action === 'remove') {
                if (confirm('Are you sure you want to delete this prompt?')) {
                    fetch(`/sd-prompt-lab/delete/${id}`, {method: 'DELETE'})
                        .then((res) => res.ok ? loadCards() : alert('Failed to delete prompt'))
                        .catch(() => alert('Failed to delete prompt'));
                }
            } else if (action === 'edit') {
                alert(`Edit prompt:\n${promptText}`);
            } else if (action === 'txt2img') {
                if (typeof updateTxt2ImgPositivePrompt === 'function') {
                    updateTxt2ImgPositivePrompt(promptText);
                } else {
                    alert('updateTxt2ImgPositivePrompt is not defined');
                }
            } else if (action === 'copy') {
                if (!promptText) return;
                const textarea = document.createElement('textarea');
                textarea.value = promptText;
                textarea.style.position = 'fixed'; // Prevent scrolling to bottom of page in MS Edge.
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                try {
                    document.execCommand('copy');
                    btn.innerText = '✅ copied';
                    setTimeout(() => {
                        btn.innerText = '📋 copy';
                    }, 1500);
                } catch (err) {
                    alert('Failed to copy');
                }
                document.body.removeChild(textarea);
            }
        });
    }
}


function setupSaveButton() {
    const saveButton = document.getElementById('sd-prompt-lab-save-button');
    const nameBlock = document.getElementById('sd-prompt-lab-name-input');
    const descriptionBlock = document.getElementById('sd-prompt-lab-description-input');
    const imagePathBlock = document.getElementById('sd-prompt-lab-image-path-input');
    const overrideBlock = document.getElementById('sd-prompt-lab-override-checkbox');
    const outputHtml = document.getElementById('sd-prompt-lab-output-html');

    if (saveButton && nameBlock && descriptionBlock && imagePathBlock && overrideBlock && outputHtml) {
        saveButton.addEventListener('click', async () => {
            const getValue = (block) => block.querySelector('textarea')?.value.trim() || '';
            const name = getValue(nameBlock);
            const description = getValue(descriptionBlock);
            const image_path = getValue(imagePathBlock);
            const prompt = window.sdPromptLabEditor?.state.doc.toString().trim() || '';

            const override = overrideBlock.querySelector('input[type="checkbox"]')?.checked || false;

            if (!name || !prompt) {
                showWarningMessage('Name and Prompt are required');
                return
            }

            if (!name.trim() || !prompt.trim()) {
                showWarningMessage('Name and Prompt are required');
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
                    showInfoMessage('Saved successfully');
                } else {
                    const error = await response.json();
                    throw new Error(error.detail || "Unknown error");
                }
            } catch (e) {
                showErrorMessage(`Save failed: ${e.message}`)
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

    // 4. Click txt2img tab button
    const tabNav = document.querySelector('.tab-nav');
    if (tabNav) {
        const buttons = tabNav.querySelectorAll('button');
        const txt2imgTab = Array.from(buttons).find(btn =>
            btn.textContent.trim().toLowerCase().startsWith('txt2img')
        );

        if (txt2imgTab) {
            txt2imgTab.click();
        } else {
            console.warn('txt2img tab button not found');
        }
    }
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

onUiLoaded(() => {
    const script = document.createElement('script');
    script.src = '/file/extensions/sd-prompt-lab/javascript/codemirror6.bundle.js';
    script.onload = () => {
        window.initCodeMirror6('#code-editor');
    };
    document.head.appendChild(script);

    setupSaveButton()
    setupTxt2ImgButton()
    setupBrowseTab()
});