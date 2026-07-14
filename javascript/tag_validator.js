(() => {
    const API = '/sd-prompt-lab/validator';

    // ---------------------------------------------------------------------
    // Pure logic (exported on window.SplTagValidator for unit testing in Node)
    // ---------------------------------------------------------------------

    const OPENERS = '([{<';
    const CLOSERS = ')]}>';
    const LORA_RE = /<lora:[^>]*?>/gi;
    const BREAK_RE = /\bBREAK\b/gi;

    // Split raw import text into separate prompts on runs of 2+ newlines
    // (blank line = new card). Single newlines stay within one prompt.
    function splitPrompts(raw) {
        return String(raw ?? '')
            .split(/\n[ \t]*\n+/)
            .map((p) => p.trim())
            .filter(Boolean);
    }

    // Split a prompt into tag segments. Top-level commas only (commas inside
    // ()[]{}<> are preserved); BREAK, semicolons and newlines act as separators.
    function tokenize(text) {
        const prepared = String(text ?? '')
            .replace(BREAK_RE, ',')
            .replace(/[;\r\n]+/g, ',');
        const segs = [];
        let depth = 0;
        let cur = '';
        for (const ch of prepared) {
            if (OPENERS.includes(ch)) {
                depth++;
                cur += ch;
            } else if (CLOSERS.includes(ch)) {
                if (depth > 0) depth--;
                cur += ch;
            } else if (ch === ',' && depth === 0) {
                segs.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
        segs.push(cur);
        return segs.map((s) => s.trim()).filter(Boolean);
    }

    // Canonical, case-insensitive identity for a tag segment.
    function tagKey(seg) {
        return String(seg ?? '').trim().toLowerCase();
    }

    // Collapse broken comma sequences: runs of commas (",,", ", ,") become one,
    // leading/trailing commas are dropped, and spacing is normalized to ", ".
    // Works inside brackets too, e.g. "(b,, c)" -> "(b, c)".
    function fixCommas(text) {
        return String(text ?? '')
            .replace(/,(?:\s*,)+/g, ',')   // runs of commas -> single comma
            .replace(/\s*,\s*/g, ', ')     // normalize spacing around commas
            .replace(/^\s*,\s*/, '')       // drop a leading comma
            .replace(/\s*,\s*$/, '')       // drop a trailing comma
            .trim();
    }

    // Auto-purge: strip <lora:...>, remove BREAK, fix broken commas, normalize
    // whitespace, dedupe case-insensitively keeping first occurrence.
    function purge(text) {
        const noLora = fixCommas(String(text ?? '').replace(LORA_RE, ''));
        const seen = new Set();
        const out = [];
        for (const seg of tokenize(noLora)) {
            const clean = seg.replace(/\s+/g, ' ').trim();
            if (!clean) continue;
            const key = clean.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(clean);
        }
        return out.join(', ');
    }

    // Remove the segment at `index`, re-joining the rest with ", ".
    function removeSegment(text, index) {
        const segs = tokenize(text);
        segs.splice(index, 1);
        return segs.join(', ');
    }

    function isBalanced(str) {
        const pairs = {')': '(', ']': '[', '}': '{', '>': '<'};
        const opens = new Set(['(', '[', '{', '<']);
        const stack = [];
        for (const ch of String(str ?? '')) {
            if (opens.has(ch)) {
                stack.push(ch);
            } else if (ch in pairs) {
                if (stack.pop() !== pairs[ch]) return false;
            }
        }
        return stack.length === 0;
    }

    // Live validation of a single prompt. Returns [{code, msg}].
    function validate(text) {
        const raw = String(text ?? '');
        const issues = [];
        if (BREAK_RE.test(raw)) issues.push({code: 'break', msg: 'Contains a BREAK keyword'});
        BREAK_RE.lastIndex = 0;
        if (/[\r\n]/.test(raw)) issues.push({code: 'newline', msg: 'Contains a line break'});
        if (/<lora:[^>]*>/i.test(raw)) issues.push({code: 'lora', msg: 'Contains a <lora:…> tag'});
        if (!isBalanced(raw)) issues.push({code: 'brackets', msg: 'Mismatched brackets ()[]{}<>'});

        const segs = tokenize(raw);
        if (segs.length === 0) {
            issues.push({code: 'empty', msg: 'Empty prompt — no tags'});
        }

        const seen = new Set();
        let dup = false;
        for (const s of segs) {
            const k = s.toLowerCase();
            if (seen.has(k)) {
                dup = true;
                break;
            }
            seen.add(k);
        }
        if (dup) issues.push({code: 'duplicate', msg: 'Duplicate tags'});

        if (raw.trim() && raw.split(',').some((p) => p.trim() === '')) {
            issues.push({code: 'dangling', msg: 'Empty / dangling comma segment'});
        }

        const weightRe = /\(([^()]*?):([^()]*?)\)/g;
        let m;
        while ((m = weightRe.exec(raw)) !== null) {
            const name = m[1].trim();
            const num = m[2].trim();
            if (name === '' || !/^\d*\.?\d+$/.test(num)) {
                issues.push({code: 'weight', msg: 'Malformed weight, e.g. (tag:1.2)'});
                break;
            }
        }

        if (segs.some((s) => s.length > 120)) {
            issues.push({code: 'prose', msg: 'Very long segment — looks like un-split prose'});
        }

        return issues;
    }

    // Remove only the brackets that have no matching partner, keeping balanced
    // ones (so emphasis like "((best))" survives). Fixes the 'brackets' issue.
    function removeUnmatchedBrackets(str) {
        const pairs = {'(': ')', '[': ']', '{': '}', '<': '>'};
        const opens = new Set(['(', '[', '{', '<']);
        const closes = {')': '(', ']': '[', '}': '{', '>': '<'};
        const s = String(str ?? '');
        const keep = new Array(s.length).fill(true);
        const stack = [];
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (opens.has(ch)) {
                stack.push({ch, i});
            } else if (ch in closes) {
                let m = -1;
                for (let j = stack.length - 1; j >= 0; j--) {
                    if (pairs[stack[j].ch] === ch) { m = j; break; }
                }
                if (m !== -1) stack.splice(m, 1);
                else keep[i] = false;   // unmatched closer
            }
        }
        for (const it of stack) keep[it.i] = false;   // unmatched openers
        return [...s].filter((_, i) => keep[i]).join('');
    }

    // Auto-resolve the fixable validation issues, leaving unfixable ones
    // (empty prompt, true prose without structure) for the user.
    function fixPrompt(text) {
        // BREAK / newlines -> separators; drop <lora:...>.
        let t = String(text ?? '')
            .replace(/[\r\n]+/g, ',')
            .replace(LORA_RE, '')
            .replace(BREAK_RE, ',');

        // Unpack grouped tag-lists and over-long prose segments: strip their
        // brackets and weights so the inner commas become real separators.
        // Emphasis "((best))" and lone weights "(x:1.2)" (no inner comma) are
        // left alone.
        const out = [];
        for (const seg of tokenize(t)) {
            // A comma still inside a tokenized segment must be bracket-protected,
            // i.e. a grouped tag-list — unpack it. Also unpack over-long prose.
            if (seg.length > 120 || seg.includes(',')) {
                const unpacked = seg
                    .replace(/\(\s*([^():]*?)\s*:\s*[-\d.]+\s*\)/g, '$1')   // (name:1.2) -> name
                    .replace(/[{}[\]()<>]/g, ' ');
                for (const p of unpacked.split(',')) {
                    const x = p.replace(/\s+/g, ' ').trim();
                    if (x) out.push(x);
                }
            } else {
                out.push(seg);
            }
        }
        t = out.join(', ');

        // Malformed weights: (name:not-a-number) -> name, (:1.2) -> removed.
        t = t.replace(/\(([^():]*):([^()]*)\)/g, (m, name, num) => {
            name = name.trim();
            num = num.trim();
            if (name === '') return '';
            return /^\d*\.?\d+$/.test(num) ? m : name;
        });

        t = removeUnmatchedBrackets(t);
        return purge(t);   // fixCommas + dedupe + normalize
    }

    window.SplTagValidator = {
        splitPrompts, tokenize, tagKey, purge, fixCommas, removeSegment,
        isBalanced, validate, removeUnmatchedBrackets, fixPrompt,
    };

    // Node unit-test harness stops here (no DOM). The app layer below only runs
    // in the browser via onUiLoaded.
    if (typeof onUiLoaded !== 'function') return;

    // ---------------------------------------------------------------------
    // App layer
    // ---------------------------------------------------------------------

    const state = {
        initialized: false,
        eventsBound: false,
        cards: [],          // [{id, text, approved}]
        tags: {},           // key -> 'approved' | 'declined'
        activeId: null,
        mode: 'tags',       // 'tags' | 'text'
        editor: null,
        silentChange: false,
        history: {undo: [], redo: []},   // tag-mode edit snapshots
    };

    const ids = {
        root: 'sd-prompt-lab-tag-validator-root',
        importBtn: 'spl-tv-import',
        exportBtn: 'spl-tv-export',
        clearBtn: 'spl-tv-clear',
        countApproved: 'spl-tv-count-approved',
        countDeclined: 'spl-tv-count-declined',
        counterApproved: 'spl-tv-counter-approved',
        counterDeclined: 'spl-tv-counter-declined',
        cardControls: 'spl-tv-card-controls',
        modeTags: 'spl-tv-mode-tags',
        modeText: 'spl-tv-mode-text',
        undo: 'spl-tv-undo',
        redo: 'spl-tv-redo',
        cleanup: 'spl-tv-cleanup',
        fix: 'spl-tv-fix',
        approve: 'spl-tv-approve',
        approveLabel: 'spl-tv-approve-label',
        removeCard: 'spl-tv-remove-card',
        removeDialog: 'spl-tv-remove-dialog',
        removeCancel: 'spl-tv-remove-cancel',
        removeConfirm: 'spl-tv-remove-confirm',
        cardsEmpty: 'spl-tv-cards-empty',
        cardsList: 'spl-tv-cards-list',
        mainEmpty: 'spl-tv-main-empty',
        mainBody: 'spl-tv-main-body',
        issues: 'spl-tv-issues',
        chips: 'spl-tv-chips',
        textHost: 'spl-tv-text-host',
        importDialog: 'spl-tv-import-dialog',
        importText: 'spl-tv-import-text',
        importCancel: 'spl-tv-import-cancel',
        importAdd: 'spl-tv-import-add',
        exportDialog: 'spl-tv-export-dialog',
        exportText: 'spl-tv-export-text',
        exportApproved: 'spl-tv-export-approved',
        exportCopy: 'spl-tv-export-copy',
        exportClose: 'spl-tv-export-close',
        clearDialog: 'spl-tv-clear-dialog',
        clearCancel: 'spl-tv-clear-cancel',
        clearConfirm: 'spl-tv-clear-confirm',
        tagsDialog: 'spl-tv-tags-dialog',
        tagsDialogTitle: 'spl-tv-tags-dialog-title',
        tagsFilter: 'spl-tv-tags-filter',
        tagsList: 'spl-tv-tags-list',
        tagsClose: 'spl-tv-tags-close',
    };

    const $ = (id) => gradioApp()?.getElementById(id);

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    }

    function ensureAssets() {
        if (!document.getElementById('sd-prompt-lab-material-symbols')) {
            const icons = document.createElement('link');
            icons.id = 'sd-prompt-lab-material-symbols';
            icons.rel = 'stylesheet';
            icons.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..32,400,0,0';
            document.head.appendChild(icons);
        }
        if (!document.getElementById('sd-prompt-lab-validator-style')) {
            const style = document.createElement('link');
            style.id = 'sd-prompt-lab-validator-style';
            style.rel = 'stylesheet';
            style.href = `file=extensions/sd-prompt-lab/javascript/tag_validator.css?v=${Date.now()}`;
            document.head.appendChild(style);
        }
    }

    async function api(path, opts) {
        const res = await fetch(API + path, opts);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? res.json() : null;
    }

    function jsonBody(obj) {
        return {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(obj)};
    }

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

    // ---- data helpers ----------------------------------------------------

    function activeCard() {
        return state.cards.find((c) => c.id === state.activeId) || null;
    }

    function chipStatus(key) {
        if (state.tags[key] === 'declined') return 'declined';
        if (state.tags[key] === 'approved') return 'approved';
        return 'neutral';
    }

    async function setTag(key, status) {
        if (status === 'none') {
            delete state.tags[key];
        } else {
            state.tags[key] = status;
        }
        await api(`/tags/${encodeURIComponent(key)}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({status}),
        });
    }

    async function patchCard(card, fields) {
        Object.assign(card, fields);
        await api(`/cards/${card.id}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(fields),
        });
    }

    // ---- undo / redo history (tag-mode edits) ---------------------------

    function snapshot() {
        return {
            cards: state.cards.map((c) => ({id: c.id, text: c.text, approved: c.approved})),
            tags: {...state.tags},
        };
    }

    // Record the current state before an undoable tag-mode edit.
    function pushHistory() {
        state.history.undo.push(snapshot());
        state.history.redo = [];
        updateUndoRedoButtons();
    }

    // Drop the history after any change that is not an undoable tag edit
    // (import, clear, card delete/approve, text-mode editing).
    function clearHistory() {
        state.history.undo = [];
        state.history.redo = [];
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        const u = $(ids.undo);
        const r = $(ids.redo);
        if (u) u.disabled = state.history.undo.length === 0;
        if (r) r.disabled = state.history.redo.length === 0;
    }

    async function restoreSnapshot(snap) {
        for (const sc of snap.cards) {
            const cur = state.cards.find((c) => c.id === sc.id);
            if (!cur) continue;
            const fields = {};
            if (cur.text !== sc.text) fields.text = sc.text;
            if (cur.approved !== sc.approved) fields.approved = !!sc.approved;
            if (Object.keys(fields).length) await patchCard(cur, fields);
        }
        const curKeys = Object.keys(state.tags);
        for (const [k, v] of Object.entries(snap.tags)) {
            if (state.tags[k] !== v) await setTag(k, v);
        }
        for (const k of curKeys) {
            if (!(k in snap.tags)) await setTag(k, 'none');
        }
    }

    async function undo() {
        if (state.history.undo.length === 0) return;
        state.history.redo.push(snapshot());
        const snap = state.history.undo.pop();
        await restoreSnapshot(snap);
        updateUndoRedoButtons();
        renderAll();
    }

    async function redo() {
        if (state.history.redo.length === 0) return;
        state.history.undo.push(snapshot());
        const snap = state.history.redo.pop();
        await restoreSnapshot(snap);
        updateUndoRedoButtons();
        renderAll();
    }

    // ---- rendering -------------------------------------------------------

    function renderCounts() {
        let approved = 0;
        let declined = 0;
        for (const status of Object.values(state.tags)) {
            if (status === 'approved') approved++;
            else if (status === 'declined') declined++;
        }
        const a = $(ids.countApproved);
        const d = $(ids.countDeclined);
        if (a) a.textContent = String(approved);
        if (d) d.textContent = String(declined);
    }

    function renderCards() {
        const list = $(ids.cardsList);
        const empty = $(ids.cardsEmpty);
        if (!list) return;
        if (empty) empty.hidden = state.cards.length > 0;

        list.innerHTML = state.cards.map((card, i) => {
            const cls = ['spl-tv-card'];
            if (card.approved) cls.push('is-approved');
            if (card.id === state.activeId) cls.push('is-active');
            return `
                <div class="${cls.join(' ')}" data-id="${card.id}">
                    <div class="spl-tv-card-num">${i + 1}</div>
                    <div class="spl-tv-card-text">${escapeHtml(card.text) || '<i>(empty)</i>'}</div>
                </div>`;
        }).join('');
    }

    function renderIssues() {
        const el = $(ids.issues);
        const card = activeCard();
        if (!el || !card) return;

        // Per-card tag counts (order: not-approved, approved, declined).
        let approved = 0;
        let declined = 0;
        let neutral = 0;
        for (const seg of tokenize(card.text)) {
            const st = chipStatus(tagKey(seg));
            if (st === 'approved') approved++;
            else if (st === 'declined') declined++;
            else neutral++;
        }
        const counts =
            `<span class="spl-tv-status-count" title="Not-approved tags in this prompt">`
            + `<span class="material-symbols-rounded" aria-hidden="true">radio_button_unchecked</span>${neutral}</span>`
            + `<span class="spl-tv-status-count is-approved" title="Approved tags in this prompt">`
            + `<span class="material-symbols-rounded" aria-hidden="true">check_circle</span>${approved}</span>`
            + `<span class="spl-tv-status-count is-declined" title="Declined tags in this prompt">`
            + `<span class="material-symbols-rounded" aria-hidden="true">cancel</span>${declined}</span>`;

        const issues = validate(card.text);
        const issuesHtml = issues.length === 0
            ? '<span class="spl-tv-issue spl-tv-issue-ok">'
                + '<span class="material-symbols-rounded" aria-hidden="true">verified</span>Valid</span>'
            : issues.map((iss) =>
                `<span class="spl-tv-issue" title="${escapeHtml(iss.msg)}">`
                + '<span class="material-symbols-rounded" aria-hidden="true">error</span>'
                + `${escapeHtml(iss.msg)}</span>`).join('');

        el.innerHTML = counts + issuesHtml;
    }

    function renderChips() {
        const el = $(ids.chips);
        const card = activeCard();
        if (!el || !card) return;
        const segs = tokenize(card.text);
        if (segs.length === 0) {
            el.innerHTML = '<div class="spl-tv-chips-empty">No tags in this prompt.</div>';
            return;
        }
        el.innerHTML = segs.map((seg, i) => {
            const status = chipStatus(tagKey(seg));
            return `
                <span class="spl-tv-chip is-${status}" data-index="${i}">
                    <span class="spl-tv-chip-text">${escapeHtml(seg)}</span>
                    <span class="spl-tv-chip-actions">
                        <button class="spl-tv-chip-approve" data-index="${i}" title="Approve tag" aria-label="Approve tag">
                            <span class="material-symbols-rounded" aria-hidden="true">check</span>
                        </button>
                        <button class="spl-tv-chip-remove" data-index="${i}" title="Remove tag" aria-label="Remove tag">
                            <span class="material-symbols-rounded" aria-hidden="true">close</span>
                        </button>
                    </span>
                </span>`;
        }).join('');
    }

    function renderApproveButton() {
        const card = activeCard();
        const label = $(ids.approveLabel);
        const btn = $(ids.approve);
        if (!card || !label || !btn) return;
        if (card.approved) {
            label.textContent = 'Unapprove';
            btn.classList.add('is-approved');
        } else {
            label.textContent = 'Approve';
            btn.classList.remove('is-approved');
        }
    }

    function updateModeButtons() {
        $(ids.modeTags)?.classList.toggle('is-active', state.mode === 'tags');
        $(ids.modeText)?.classList.toggle('is-active', state.mode === 'text');
    }

    function renderMain() {
        const card = activeCard();
        const controls = $(ids.cardControls);
        const mainEmpty = $(ids.mainEmpty);
        const mainBody = $(ids.mainBody);
        const chips = $(ids.chips);
        const textHost = $(ids.textHost);

        if (!card) {
            if (controls) controls.hidden = true;
            if (mainEmpty) mainEmpty.hidden = false;
            if (mainBody) mainBody.hidden = true;
            return;
        }

        if (controls) controls.hidden = false;
        if (mainEmpty) mainEmpty.hidden = true;
        if (mainBody) mainBody.hidden = false;

        updateModeButtons();
        renderApproveButton();
        renderIssues();

        // Undo/redo apply to Tag mode only; hide them in Text mode (CodeMirror
        // provides its own native undo there).
        const undoBtn = $(ids.undo);
        const redoBtn = $(ids.redo);
        if (undoBtn) undoBtn.hidden = state.mode !== 'tags';
        if (redoBtn) redoBtn.hidden = state.mode !== 'tags';
        updateUndoRedoButtons();

        if (state.mode === 'text') {
            if (chips) chips.hidden = true;
            if (textHost) textHost.hidden = false;
            mountEditor(card.text);
        } else {
            if (textHost) textHost.hidden = true;
            if (chips) chips.hidden = false;
            renderChips();
        }
    }

    function renderAll() {
        renderCounts();
        renderCards();
        renderMain();
    }

    // ---- text editor (CodeMirror) ---------------------------------------

    let saveTimer = null;

    function scheduleSave(card) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            api(`/cards/${card.id}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({text: card.text}),
            }).catch(() => {});
        }, 400);
    }

    async function mountEditor(text) {
        await window.sdPromptLabLoadCodeMirror();
        const host = $(ids.textHost);
        if (!host) return;
        if (!state.editor) {
            host.innerHTML = '';
            state.editor = window.createSdPromptLabWildcardEditor({
                parent: host,
                doc: text || '',
                onChange: (doc) => {
                    if (state.silentChange) return;
                    const card = activeCard();
                    if (!card) return;
                    card.text = doc;
                    clearHistory();   // text-mode edits are outside the tag-edit history
                    renderIssues();
                    renderCards();
                    scheduleSave(card);
                },
            });
        } else {
            state.silentChange = true;
            window.setSdPromptLabEditorDocument(state.editor, text || '');
            state.silentChange = false;
        }
    }

    // ---- actions ---------------------------------------------------------

    async function selectCard(id) {
        state.activeId = id;
        const card = activeCard();
        // Auto-purge every card as it is opened.
        if (card) await autoPurge(card);
        renderCards();
        renderMain();
    }

    function setMode(mode) {
        if (state.mode === mode) return;
        state.mode = mode;
        renderMain();
    }

    async function onChipApprove(index) {
        const card = activeCard();
        if (!card) return;
        const segs = tokenize(card.text);
        const key = tagKey(segs[index] || '');
        if (!key) return;
        pushHistory();
        await setTag(key, 'approved');   // explicit override, even if declined
        renderCounts();
        renderChips();
        renderCards();
        renderIssues();
    }

    async function onChipRemove(index) {
        const card = activeCard();
        if (!card) return;
        const segs = tokenize(card.text);
        const key = tagKey(segs[index] || '');
        const wasApproved = state.tags[key] === 'approved';
        pushHistory();
        const newText = removeSegment(card.text, index);
        await patchCard(card, {text: newText});
        // Removing an approved tag just drops it from this card (its approval
        // persists as a curated list). Removing a regular tag declines it.
        if (key && !wasApproved) await setTag(key, 'declined');
        renderCounts();
        renderChips();
        renderCards();
        renderIssues();
    }

    async function toggleApprove() {
        const card = activeCard();
        if (!card) return;
        // Approval is a card-level flag only; it never changes tag verdicts.
        await patchCard(card, {approved: !card.approved});
        clearHistory();
        renderAll();
    }

    function syncEditorDoc(text) {
        if (state.mode === 'text' && state.editor) {
            state.silentChange = true;
            window.setSdPromptLabEditorDocument(state.editor, text);
            state.silentChange = false;
        }
    }

    // Purge runs automatically (on import and on opening a card); it is not a
    // manual button. Returns true if the card text changed.
    async function autoPurge(card) {
        const cleaned = purge(card.text);
        if (cleaned === card.text) return false;
        await patchCard(card, {text: cleaned});
        return true;
    }

    // The "Clean-up" button: remove every declined tag from the open card.
    // The "Clean-up" button: remove declined tags and broken comma segments.
    async function refineActive() {
        const card = activeCard();
        if (!card) return;
        pushHistory();
        const kept = tokenize(card.text).filter((seg) => state.tags[tagKey(seg)] !== 'declined');
        const refined = fixCommas(kept.join(', '));
        await patchCard(card, {text: refined});
        syncEditorDoc(refined);
        renderCounts();
        renderCards();
        renderMain();
    }

    // The "Fix" button: auto-resolve the fixable validation issues on this card.
    async function fixActive() {
        const card = activeCard();
        if (!card) return;
        pushHistory();
        const fixed = fixPrompt(card.text);
        await patchCard(card, {text: fixed});
        syncEditorDoc(fixed);
        renderCounts();
        renderCards();
        renderMain();
    }

    // ---- dialogs ---------------------------------------------------------

    function openDialog(id) {
        const el = $(id);
        if (el) el.hidden = false;
    }

    function closeDialog(id) {
        const el = $(id);
        if (el) el.hidden = true;
    }

    function openImport() {
        const ta = $(ids.importText);
        if (ta) ta.value = '';
        openDialog(ids.importDialog);
        ta?.focus();
    }

    async function submitImport() {
        const ta = $(ids.importText);
        const raw = ta ? ta.value : '';
        const texts = splitPrompts(raw).map((p) => purge(p)).filter(Boolean);
        closeDialog(ids.importDialog);
        if (texts.length === 0) return;
        const data = await api('/cards', jsonBody({texts}));
        const created = data.cards || [];
        state.cards.push(...created);
        clearHistory();
        renderCards();
        if (created.length > 0) selectCard(created[0].id).catch((e) => console.error(e));
    }

    function buildExport(approvedOnly) {
        return state.cards
            .filter((c) => !approvedOnly || c.approved)
            .map((c) => c.text)
            .join('\n\n');
    }

    function openExport() {
        const approvedOnly = $(ids.exportApproved)?.checked || false;
        const ta = $(ids.exportText);
        if (ta) ta.value = buildExport(approvedOnly);
        openDialog(ids.exportDialog);
    }

    function refreshExport() {
        const approvedOnly = $(ids.exportApproved)?.checked || false;
        const ta = $(ids.exportText);
        if (ta) ta.value = buildExport(approvedOnly);
    }

    function copyExport() {
        const ta = $(ids.exportText);
        if (!ta) return;
        const ok = copyToClipboard(ta.value);
        const btn = $(ids.exportCopy);
        if (btn) {
            const span = btn.querySelector('span:last-child');
            if (span) {
                const prev = span.textContent;
                span.textContent = ok ? 'Copied!' : 'Copy failed';
                setTimeout(() => {
                    span.textContent = prev;
                }, 1500);
            }
        }
    }

    async function confirmClear() {
        closeDialog(ids.clearDialog);
        await api('/cards/clear', {method: 'POST'});
        // Clear removes prompt cards only; approved/declined tags are kept.
        state.cards = [];
        state.activeId = null;
        clearHistory();
        renderAll();
    }

    async function confirmRemoveCard() {
        closeDialog(ids.removeDialog);
        const card = activeCard();
        if (!card) return;
        await api(`/cards/${card.id}`, {method: 'DELETE'});
        state.cards = state.cards.filter((c) => c.id !== card.id);
        clearHistory();
        // Reset the main pane to its initial (no card selected) state.
        state.activeId = null;
        renderAll();
    }

    // ---- manage approved / declined tags dialog -------------------------

    let manageStatus = 'approved';   // which list the dialog is showing

    function openTagsDialog(status) {
        manageStatus = status;
        const title = $(ids.tagsDialogTitle);
        if (title) title.textContent = status === 'approved' ? 'Approved tags' : 'Declined tags';
        const filter = $(ids.tagsFilter);
        if (filter) filter.value = '';
        renderTagsList();
        openDialog(ids.tagsDialog);
        filter?.focus();
    }

    function renderTagsList() {
        const list = $(ids.tagsList);
        if (!list) return;
        const needle = ($(ids.tagsFilter)?.value || '').trim().toLowerCase();
        const names = Object.keys(state.tags)
            .filter((k) => state.tags[k] === manageStatus)
            .filter((k) => !needle || k.includes(needle))
            .sort();
        if (names.length === 0) {
            list.innerHTML = `<div class="spl-tv-manage-empty">${
                needle ? 'No matching tags.' : `No ${manageStatus} tags.`}</div>`;
            return;
        }
        list.innerHTML = names.map((name) =>
            `<span class="spl-tv-manage-chip is-${manageStatus}">`
            + `<span class="spl-tv-manage-chip-text">${escapeHtml(name)}</span>`
            + `<button class="spl-tv-manage-remove" data-key="${escapeHtml(name)}" `
            + `title="Remove from ${manageStatus}" aria-label="Remove tag">`
            + '<span class="material-symbols-rounded" aria-hidden="true">close</span>'
            + '</button></span>').join('');
    }

    async function removeManagedTag(key) {
        await setTag(key, 'none');
        renderCounts();
        renderTagsList();
        if (activeCard()) {
            renderChips();
            renderIssues();
        }
    }

    // ---- events ----------------------------------------------------------

    function bindEvents() {
        if (state.eventsBound) return;
        state.eventsBound = true;

        $(ids.importBtn)?.addEventListener('click', openImport);
        $(ids.importCancel)?.addEventListener('click', () => closeDialog(ids.importDialog));
        $(ids.importAdd)?.addEventListener('click', () => submitImport().catch((e) => console.error(e)));
        $(ids.importDialog)?.addEventListener('click', (e) => {
            if (e.target.id === ids.importDialog) closeDialog(ids.importDialog);
        });

        $(ids.exportBtn)?.addEventListener('click', openExport);
        $(ids.exportClose)?.addEventListener('click', () => closeDialog(ids.exportDialog));
        $(ids.exportApproved)?.addEventListener('change', refreshExport);
        $(ids.exportCopy)?.addEventListener('click', copyExport);
        $(ids.exportDialog)?.addEventListener('click', (e) => {
            if (e.target.id === ids.exportDialog) closeDialog(ids.exportDialog);
        });

        $(ids.clearBtn)?.addEventListener('click', () => {
            if (state.cards.length === 0) return;
            openDialog(ids.clearDialog);
        });
        $(ids.clearCancel)?.addEventListener('click', () => closeDialog(ids.clearDialog));
        $(ids.clearConfirm)?.addEventListener('click', () => confirmClear().catch((e) => console.error(e)));
        $(ids.clearDialog)?.addEventListener('click', (e) => {
            if (e.target.id === ids.clearDialog) closeDialog(ids.clearDialog);
        });

        $(ids.modeTags)?.addEventListener('click', () => setMode('tags'));
        $(ids.modeText)?.addEventListener('click', () => setMode('text'));
        $(ids.undo)?.addEventListener('click', () => undo().catch((e) => console.error(e)));
        $(ids.redo)?.addEventListener('click', () => redo().catch((e) => console.error(e)));
        // The Clean-up button removes declined tags from the open card.
        $(ids.cleanup)?.addEventListener('click', () => refineActive().catch((e) => console.error(e)));
        $(ids.fix)?.addEventListener('click', () => fixActive().catch((e) => console.error(e)));
        $(ids.approve)?.addEventListener('click', () => toggleApprove().catch((e) => console.error(e)));

        $(ids.counterApproved)?.addEventListener('click', () => openTagsDialog('approved'));
        $(ids.counterDeclined)?.addEventListener('click', () => openTagsDialog('declined'));
        $(ids.tagsClose)?.addEventListener('click', () => closeDialog(ids.tagsDialog));
        $(ids.tagsFilter)?.addEventListener('input', renderTagsList);
        $(ids.tagsDialog)?.addEventListener('click', (e) => {
            if (e.target.id === ids.tagsDialog) closeDialog(ids.tagsDialog);
        });
        $(ids.tagsList)?.addEventListener('click', (e) => {
            const btn = e.target.closest('.spl-tv-manage-remove');
            if (btn) removeManagedTag(btn.dataset.key).catch((err) => console.error(err));
        });

        $(ids.removeCard)?.addEventListener('click', () => {
            if (activeCard()) openDialog(ids.removeDialog);
        });
        $(ids.removeCancel)?.addEventListener('click', () => closeDialog(ids.removeDialog));
        $(ids.removeConfirm)?.addEventListener('click', () => confirmRemoveCard().catch((e) => console.error(e)));
        $(ids.removeDialog)?.addEventListener('click', (e) => {
            if (e.target.id === ids.removeDialog) closeDialog(ids.removeDialog);
        });

        $(ids.cardsList)?.addEventListener('click', (e) => {
            const card = e.target.closest('.spl-tv-card');
            if (!card) return;
            selectCard(Number(card.dataset.id)).catch((err) => console.error(err));
        });

        $(ids.chips)?.addEventListener('click', (e) => {
            const approveBtn = e.target.closest('.spl-tv-chip-approve');
            if (approveBtn) {
                onChipApprove(Number(approveBtn.dataset.index)).catch((err) => console.error(err));
                return;
            }
            const removeBtn = e.target.closest('.spl-tv-chip-remove');
            if (removeBtn) {
                onChipRemove(Number(removeBtn.dataset.index)).catch((err) => console.error(err));
            }
        });

        document.addEventListener('keydown', onKeydown);
    }

    // System undo/redo shortcuts, active only while the Tag Validator tab is
    // visible, a card is open, and we're in Tag mode (Text mode leaves undo to
    // CodeMirror). Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Ctrl+Y = redo.
    function onKeydown(e) {
        const root = $(ids.root);
        if (!root || root.offsetParent === null) return;   // tab not visible
        if (state.mode !== 'tags' || !activeCard()) return;
        if (!(e.metaKey || e.ctrlKey)) return;
        const target = e.target;
        const tag = target && target.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT'
            || (target && target.closest && target.closest('.cm-editor'))) return;
        const key = (e.key || '').toLowerCase();
        if (key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo().catch((err) => console.error(err));
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
            e.preventDefault();
            redo().catch((err) => console.error(err));
        }
    }

    async function loadState() {
        const data = await api('/state');
        state.cards = data.cards || [];
        state.tags = {};
        for (const t of (data.tags || [])) state.tags[t.name] = t.status;
        if (!state.cards.some((c) => c.id === state.activeId)) state.activeId = null;
        clearHistory();
        renderAll();
    }

    async function init() {
        if (state.initialized || !$(ids.root)) return;
        state.initialized = true;
        ensureAssets();
        bindEvents();
        try {
            await loadState();
        } catch (e) {
            console.error('Tag Validator: failed to load state', e);
        }
    }

    // Lazy-init when the Tag Validator tab is first opened.
    function setupLazyInit() {
        const root = gradioApp()?.querySelector('#tab_sd_prompt_lab');
        if (!root) return;
        const tabNav = root.querySelector('.tab-nav');
        if (!tabNav) return;
        const btn = Array.from(tabNav.querySelectorAll('button')).find((b) =>
            b.textContent.trim().toLowerCase().startsWith('tag validator'));
        if (!btn) return;
        btn.addEventListener('click', () => init());
    }

    onUiLoaded(() => {
        setupLazyInit();
    });
})();
