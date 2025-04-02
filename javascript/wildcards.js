function setupWildcardsTab() {
    function tryInit() {
        const searchBlock = gradioApp().getElementById("sd-prompt-lab-wildcards-search-input");
        const treeContainer = gradioApp().getElementById("sd-prompt-lab-wildcards-tree");

        if (!searchBlock || !treeContainer) {
            setTimeout(tryInit, 200);
            return;
        }

        let wildcardsTree = [];

        async function loadTree() {
            try {
                const res = await fetch("/sd-prompt-lab/wildcards/tree");
                const data = await res.json();
                console.log(data);
                console.log("data loaded")
                wildcardsTree = data.tree || [];
                renderTree();
            } catch (e) {
                treeContainer.innerHTML = `<div style="color:red;">Failed to load wildcards</div>`;
            }
        }

        function renderTree() {
            const query = searchBlock.querySelector('textarea')?.value.toLowerCase() || "";
            const filteredTree = filterTree(wildcardsTree, query);

            treeContainer.innerHTML = createTreeHTML(filteredTree);
            bindTreeClicks();
        }

        function filterTree(tree, query) {
            if (!query) return tree;

            const filtered = [];
            for (const node of tree) {
                if (node.type === "file" && node.name.toLowerCase().includes(query)) {
                    filtered.push(node);
                } else if (node.type === "dir") {
                    const children = filterTree(node.children, query);
                    if (children.length > 0) {
                        filtered.push({ ...node, children });
                    }
                }
            }
            return filtered;
        }

        function createTreeHTML(tree) {
            let html = `<ul class="wildcards-tree">`;
            for (const node of tree) {
                if (node.type === "file") {
                    html += `<li class="file" data-path="${node.path}">📄 ${node.name}</li>`;
                } else if (node.type === "dir") {
                    html += `<li class="dir">${node.name}${createTreeHTML(node.children)}</li>`;
                }
            }
            html += `</ul>`;
            return html;
        }

        function bindTreeClicks() {
            treeContainer.querySelectorAll(".file").forEach(el => {
                el.addEventListener("click", () => {
                    const path = el.dataset.path;
                    const event = new CustomEvent("wildcardFileSelected", { detail: { path } });
                    window.dispatchEvent(event);
                });
            });
        }

        // Add CSS
        const style = document.createElement('style');
        style.innerHTML = `
        .wildcards-tree {
            list-style: none;
            padding-left: 12px;
            max-height: 500px;
            overflow-y: auto;
            color: #ccc;
            font-size: 14px;
        }
        .wildcards-tree li {
            margin: 4px 0;
            cursor: pointer;
        }
        .wildcards-tree li.dir {
            font-weight: bold;
            color: #eee;
        }
        .wildcards-tree li.file:hover {
            color: #5af;
        }
        `;
        document.head.appendChild(style);

        searchBlock.querySelector('textarea')?.addEventListener("input", () => renderTree());
        loadTree();
    }

    tryInit();
}


onUiLoaded(() => {
    setupWildcardsTab();
});