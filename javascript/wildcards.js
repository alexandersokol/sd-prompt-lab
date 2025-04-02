let wildcardsTreeData = [];

function getWildcardsSearchText() {
    const searchInput = gradioApp().getElementById("sd-prompt-lab-wildcards-search-input");
    return searchInput?.querySelector('textarea')?.value.trim().toLowerCase() || '';
}

function createTreeItem(item) {
    if (item.type === 'folder') {
        return `
            <li>
                <details>
                    <summary style="cursor: pointer; color: #aaa; margin: 4px 0; font-size: 15px;">📂 ${item.name}</summary>
                    <ul style="list-style: none; padding-left: 12px;">
                        ${(item.children || []).map(createTreeItem).join('')}
                    </ul>
                </details>
            </li>
        `;
    } else if (item.type === 'file') {
        return `
            <li>
                <div class="wildcard-file" data-path="${item.path}" style="cursor: pointer; color: #ddd; margin: 4px 0; font-size: 15px;">📄 ${item.name}</div>
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
                            return {...item, children};
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

    const createButton = gradioApp().getElementById("sd-prompt-lab-wildcards-create-button");
    const newFileInput = gradioApp().getElementById("sd-prompt-lab-wildcards-newfile-input");
    const outputHtml = gradioApp().getElementById("sd-prompt-lab-wildcards-output-html");

    createButton?.addEventListener("click", () => {
        const fileName = newFileInput.querySelector('textarea')?.value.trim();
        if (!fileName) {
            outputHtml.innerHTML = `<span style="color: red;">❌ Please enter a file name</span>`;
            return;
        }

        fetch(`/sd-prompt-lab/wildcards/create?path=${encodeURIComponent(fileName)}`, {
            method: "POST"
        })
            .then(res => res.json())
            .then(data => {
                if (data.status === "ok") {
                    outputHtml.innerHTML = `<span style="color: green;">✅ Wildcard file created</span>`;
                    loadWildcardTree(); // Reload the tree view
                } else {
                    outputHtml.innerHTML = `<span style="color: red;">❌ ${data.detail || "Failed to create file"}</span>`;
                }
            })
            .catch(err => {
                outputHtml.innerHTML = `<span style="color: red;">❌ ${err.message}</span>`;
            });
    });


}

function setupSaveWildcard() {
    const saveButton = gradioApp().getElementById("sd-prompt-lab-wildcards-save-button");
    const nameInput = gradioApp().getElementById("sd-prompt-lab-wildcards-selected-name");
    const contentArea = gradioApp().getElementById("sd-prompt-lab-wildcards-content");
    const outputHtml = gradioApp().getElementById("sd-prompt-lab-wildcards-output-html");

    saveButton?.addEventListener("click", () => {
        const wildcardName = nameInput.querySelector('textarea')?.value.trim();
        const content = contentArea.querySelector('textarea')?.value || '';

        if (!wildcardName) {
            outputHtml.innerHTML = `<span style="color: red;">❌ No wildcard selected</span>`;
            return;
        }

        // Convert __folder/file__ => folder/file.txt
        const relativePath = wildcardName
            .replace(/^__|__$/g, '') // remove leading/trailing __
            .replace(/__/g, '/') + '.txt';

        fetch('/sd-prompt-lab/wildcards/save', {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                path: relativePath,
                content: content
            })
        })
            .then(res => res.json())
            .then(data => {
                if (data.status === "ok") {
                    outputHtml.innerHTML = `<span style="color: green;">✅ Wildcard file saved</span>`;
                } else {
                    outputHtml.innerHTML = `<span style="color: red;">❌ ${data.detail || "Failed to save file"}</span>`;
                }
            })
            .catch(err => {
                outputHtml.innerHTML = `<span style="color: red;">❌ ${err.message}</span>`;
            });
    });
}

onUiLoaded(() => {
    setupWildcardsTab();
    setupSaveWildcard();
});
