let wildcardsTreeData = [];

function getWildcardsSearchText() {
    const searchInput = gradioApp().getElementById("sd-prompt-lab-wildcards-search-input");
    return searchInput?.querySelector('textarea')?.value.trim().toLowerCase() || '';
}

function createTreeItem(item) {
    if (item.type === 'folder') {
        return `
            <li>
                <details open>
                    <summary style="cursor: pointer; color: #aaa; margin: 4px 0;">📂 ${item.name}</summary>
                    <ul style="list-style: none; padding-left: 12px;">
                        ${(item.children || []).map(createTreeItem).join('')}
                    </ul>
                </details>
            </li>
        `;
    } else if (item.type === 'file') {
        return `
            <li>
                <div class="wildcard-file" data-path="${item.path}" style="cursor: pointer; color: #ddd; margin: 4px 0; ">📄 ${item.name}</div>
            </li>
        `;
    }
    return '';
}

function renderTree() {
    const search = getWildcardsSearchText();
    const container = gradioApp().getElementById("sd-prompt-lab-wildcards-tree");

    if (!container) return;

    let filteredTree = JSON.parse(JSON.stringify(wildcardsTreeData));

    if (search) {
        const filterItems = (items) => {
            return items
                .map(item => {
                    if (item.type === 'folder') {
                        const children = filterItems(item.children || []);
                        if (children.length > 0) {
                            return { ...item, children };
                        }
                    } else if (item.type === 'file') {
                        if (item.name.toLowerCase().includes(search)) {
                            return item;
                        }
                    }
                    return null;
                })
                .filter(Boolean);
        };
        filteredTree = filterItems(filteredTree);
    }

    container.innerHTML = `<ul style="list-style: none; padding-left: 0;">${filteredTree.map(createTreeItem).join('')}</ul>`;

    container.querySelectorAll('.wildcard-file').forEach(el => {
        el.addEventListener('click', () => {
            const path = el.dataset.path;
            loadWildcardFile(path);
        });
    });
}

async function loadWildcardTree() {
    try {
        const response = await fetch('/sd-prompt-lab/wildcards/tree');
        if (!response.ok) throw new Error('Failed to load wildcards tree');
        const data = await response.json();
        wildcardsTreeData = data.tree;
        renderTree();
    } catch (err) {
        console.error(err);
    }
}

async function loadWildcardFile(path) {
    try {
        const nameInput = gradioApp().getElementById("sd-prompt-lab-wildcards-selected-name");
        const contentInput = gradioApp().getElementById("sd-prompt-lab-wildcards-content");

        const response = await fetch(`/sd-prompt-lab/wildcards/content?path=${encodeURIComponent(path)}`);
        if (!response.ok) throw new Error('Failed to load wildcard file');
        const data = await response.json();

        if (nameInput) {
            nameInput.querySelector('textarea').value = `__${path.replace(/\.txt$/, '')}__`;
        }
        if (contentInput) {
            contentInput.querySelector('textarea').value = data.content;
        }

    } catch (err) {
        console.error(err);
    }
}

function setupWildcardsTab() {
    const searchInput = gradioApp().getElementById("sd-prompt-lab-wildcards-search-input");
    if (searchInput) {
        const textarea = searchInput.querySelector('textarea');
        textarea?.addEventListener('input', () => {
            renderTree();
        });
    }

    loadWildcardTree();
}

onUiLoaded(() => {
    setupWildcardsTab();
});
