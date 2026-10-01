// Create tab: the prompt editor and its side panel.
// (Shared helpers live in spl_common.js, the Browse tab in browse.js.)

const splCreateEl = (id) => gradioApp().getElementById(id);

function setOverrideChecked(checked) {
    const checkbox = splCreateEl('sd-prompt-lab-override-checkbox');
    if (checkbox) checkbox.checked = checked;
}

// ---- image block -------------------------------------------------------------------
// The prompt being edited may already have an image. It is kept unless a new path/URL
// is entered or "Remove" is pressed; the original source path is never shown.

const createImage = {promptId: null, version: null, remove: false};

function renderCreateImage() {
    const block = splCreateEl('sd-prompt-lab-image-current');
    const preview = splCreateEl('sd-prompt-lab-image-preview');
    const stateLabel = splCreateEl('sd-prompt-lab-image-state');
    const removeButton = splCreateEl('sd-prompt-lab-image-remove');
    const input = splCreateEl('sd-prompt-lab-image-path-input');
    if (!block || !preview || !input) return;

    const hasImage = createImage.promptId != null;
    block.hidden = !hasImage;
    if (hasImage) {
        preview.src = `/sd-prompt-lab/thumbnail/${createImage.promptId}?v=${createImage.version || 0}`;
        block.classList.toggle('is-removed', createImage.remove);
        stateLabel.textContent = createImage.remove ? 'Will be removed on save' : 'Current image';
        removeButton.textContent = createImage.remove ? 'Keep' : 'Remove';
    }
    input.placeholder = hasImage && !createImage.remove
        ? 'New file path or URL (empty keeps the current image)'
        : 'File path or image URL (optional)';
}

function setCreateImage(prompt) {
    createImage.promptId = prompt && prompt.image_path ? prompt.id : null;
    createImage.version = prompt?.image_version ?? Date.now();
    createImage.remove = false;
    renderCreateImage();
}

// ---- unsaved-changes tracking ------------------------------------------------------

function readCreateFields() {
    const value = (id) => splCreateEl(id)?.value || '';
    return {
        name: value('sd-prompt-lab-name-input'),
        description: value('sd-prompt-lab-description-input'),
        image: value('sd-prompt-lab-image-path-input'),
        removeImage: createImage.remove,
        prompt: window.sdPromptLabEditor?.state.doc.toString() || '',
    };
}

// What the Create tab looked like when it was last loaded, saved or cleared.
let createBaseline = {name: '', description: '', image: '', removeImage: false, prompt: ''};

function markCreateClean() {
    createBaseline = readCreateFields();
}

function isCreateDirty() {
    const current = readCreateFields();
    return Object.keys(createBaseline).some((key) => current[key] !== createBaseline[key]);
}

// Resolves true when it is fine to replace the Create tab's content.
function confirmDiscardCreateChanges() {
    if (!isCreateDirty()) return Promise.resolve(true);
    return window.spl.confirm({
        title: 'Discard unsaved changes?',
        message: 'The Create tab has changes that are not saved. They will be lost.',
        confirmLabel: 'Discard',
        danger: true,
    });
}

function setCreateFields({name = '', description = '', prompt = ''} = {}) {
    const set = (id, value) => {
        const el = splCreateEl(id);
        if (el) el.value = value;
    };
    set('sd-prompt-lab-name-input', name);
    set('sd-prompt-lab-description-input', description);
    set('sd-prompt-lab-image-path-input', '');

    const editor = window.sdPromptLabEditor;
    if (editor) {
        editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: prompt}});
    }
}

// Load a saved prompt into the Create tab (Browse → edit).
function fillCreateTabFields(prompt) {
    setCreateFields({name: prompt.name || '', description: prompt.description || '', prompt: prompt.prompt || ''});
    setCreateImage(prompt);
    // A freshly opened prompt never starts with "Override existing" ticked.
    setOverrideChecked(false);
    markCreateClean();
}

function switchToCreateTab() {
    window.spl.openTab('sd-prompt-lab-create-tab');
}

// ---- actions -----------------------------------------------------------------------

async function saveCreatePrompt() {
    const fields = readCreateFields();
    const name = fields.name.trim();
    const prompt = fields.prompt.trim();
    if (!name || !prompt) {
        window.spl.toast('Name and Prompt are required', 'warn');
        return;
    }

    const data = {
        name,
        description: fields.description.trim(),
        image_path: fields.image.trim(),
        remove_image: createImage.remove,
        prompt,
        override: splCreateEl('sd-prompt-lab-override-checkbox')?.checked || false,
    };

    try {
        const response = await fetch('/sd-prompt-lab/save', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || 'Unknown error');

        if (result.image_warning) window.spl.toast(result.image_warning, 'warn');
        else window.spl.toast('Saved successfully');

        // Show the saved prompt's image state (new thumbnail, removed, or unchanged).
        const hadImage = createImage.promptId != null && !createImage.remove;
        const hasImage = data.image_path ? !result.image_warning : hadImage;
        const input = splCreateEl('sd-prompt-lab-image-path-input');
        if (input) input.value = '';
        setCreateImage(hasImage ? {id: result.id, image_path: true} : null);

        markCreateClean();
        window.sdPromptLabReloadBrowse?.();   // keep the Browse tab in sync
    } catch (e) {
        window.spl.toast(`Save failed: ${e.message}`, 'error');
    }
}

async function clearCreateFields() {
    if (!await confirmDiscardCreateChanges()) return;
    setCreateFields();
    setCreateImage(null);
    setOverrideChecked(false);
    markCreateClean();
    window.spl.toast('Fields cleared');
}

function updateTxt2ImgPositivePrompt(codeContent) {
    const promptBlock = document.getElementById('txt2img_prompt');
    const textarea = promptBlock?.querySelector('textarea');

    if (!textarea) {
        console.warn('txt2img prompt textarea not found');
        return;
    }

    textarea.value = codeContent;
    // Dispatch input event so Gradio knows content changed
    textarea.dispatchEvent(new Event('input', {bubbles: true}));

    window.spl.openTxt2Img();
}

function sendCreatePromptToTxt2Img() {
    const prompt = window.sdPromptLabEditor?.state.doc.toString().trim();
    if (!prompt) {
        window.spl.toast('The prompt is empty', 'warn');
        return;
    }
    updateTxt2ImgPositivePrompt(prompt);
}

// Reformat / Clean Up are syntax-aware (editor/dp_format.js): they never touch comments,
// {} blocks, wildcards or line breaks. Applied as one change, so a single undo reverts it.
function applyPromptFormat(kind, doneMessage) {
    const editor = window.sdPromptLabEditor;
    const format = window.sdPromptLabFormat;
    if (!editor || !format) return;

    const current = editor.state.doc.toString();
    const next = format[kind](current);
    if (next === current) {
        window.spl.toast('Nothing to change');
        return;
    }
    // Its own user event keeps this change a separate undo step from surrounding edits.
    editor.dispatch({changes: {from: 0, to: current.length, insert: next}, userEvent: 'format'});
    window.spl.toast(doneMessage);
}

// Show a few random expansions of the prompt in the editor (needs Dynamic Prompts).
function sampleCreatePrompt() {
    const prompt = window.sdPromptLabEditor?.state.doc.toString().trim() || '';
    if (!prompt) {
        window.spl.toast('The prompt is empty', 'warn');
        return;
    }
    window.sdPromptLabShowSamples({title: 'Sample expansions', prompt});
}

function setupCreateTab() {
    const on = (id, handler) => splCreateEl(id)?.addEventListener('click', () => handler());

    on('sd-prompt-lab-save-button', saveCreatePrompt);
    on('sd-prompt-lab-txt2img-button', sendCreatePromptToTxt2Img);
    on('sd-prompt-lab-sample-button', sampleCreatePrompt);
    on('sd-prompt-lab-clear-button', clearCreateFields);
    on('sd-prompt-lab-reformat-button', () => applyPromptFormat('reformat', 'Prompt reformatted'));
    on('sd-prompt-lab-clean-up-button', () => applyPromptFormat('cleanUp', 'Prompt cleaned up'));
    on('sd-prompt-lab-image-remove', () => {
        createImage.remove = !createImage.remove;
        renderCreateImage();
    });

    // Ctrl/Cmd-S saves from anywhere in the Create tab (the editor binds it itself).
    splCreateEl('sd-prompt-lab-create-root')?.addEventListener('keydown', (event) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
        if (event.target.closest?.('.cm-editor')) return;
        event.preventDefault();
        saveCreatePrompt();
    });

    // Gradio treats Enter in a text field as "submit"; keep it local to our inputs.
    splCreateEl('sd-prompt-lab-create-root')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.stopPropagation();
    });
}

onUiLoaded(() => {
    window.spl.loadCodeMirror().then(() => {
        window.initCodeMirror6('#code-editor', {onSave: saveCreatePrompt});
    }).catch((error) => {
        console.error(error);
    });

    setupCreateTab();
});
