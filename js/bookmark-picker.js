import { bookmarksGetTree } from './bookmarks.js';
import { getFavicon } from './favicon.js';
import { closeModal } from './ui.js';

export function createBookmarkPicker({ addTileToGrid, showBubbleMessage }) {
    const modalAdd = document.getElementById('bookmark-picker');
    const bookmarkSearch = document.getElementById('bookmark-search');
    const bookmarkCount = document.getElementById('bookmark-count');
    const bookmarkEmpty = document.getElementById('bookmark-empty');
    bookmarkSearch.addEventListener('input', () => applyBookmarkFilter(bookmarkSearch.value));

    function loadBookmarks() {
        return bookmarksGetTree().then(([root]) => {
            const container = document.getElementById('bookmark-tree');
            const sourceNodes = root.children || [];
            const totals = countBookmarkNodes(sourceNodes);

            container.innerHTML = '';
            bookmarkCount.textContent = `${totals.bookmarks} bookmarks and ${totals.folders} folders available.`;
            bookmarkCount.dataset.defaultText = bookmarkCount.textContent;
            container.appendChild(createTree(sourceNodes));
            applyBookmarkFilter(bookmarkSearch?.value || '');
        }).catch(error => {
            console.warn('Could not load bookmarks.', error);
            showBubbleMessage('Could not load bookmarks');
        });
    }

    function countBookmarkNodes(nodes) {
        return nodes.reduce((totals, node) => {
            if (node.children) {
                totals.folders += 1;
                const childTotals = countBookmarkNodes(node.children);
                totals.bookmarks += childTotals.bookmarks;
                totals.folders += childTotals.folders;
            } else {
                totals.bookmarks += 1;
            }

            return totals;
        }, { bookmarks: 0, folders: 0 });
    }

    function createTree(nodes) {
        const ul = document.createElement('ul');
        ul.className = 'bookmark-tree-list';

        nodes.forEach(node => {
            const li = document.createElement('li');
            const isFolder = Boolean(node.children);
            const title = node.title || (isFolder ? 'Untitled folder' : 'Untitled bookmark');
            li.className = 'bookmark-tree-item';
            li.dataset.title = title.toLowerCase();
            li.dataset.url = (node.url || '').toLowerCase();
            li.dataset.kind = isFolder ? 'folder' : 'bookmark';

            const row = document.createElement('div');
            row.className = 'bookmark-row';

            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'bookmark-expand';
            expandBtn.disabled = true;

            if (isFolder) {
                const children = node.children || [];
                expandBtn.disabled = children.length === 0;
                expandBtn.title = `Expand ${title}`;
                expandBtn.setAttribute('aria-label', `Expand ${title}`);

                const folderIcon = document.createElement('span');
                folderIcon.className = 'bookmark-folder-icon';
                folderIcon.setAttribute('aria-hidden', 'true');
                folderIcon.textContent = '📁';

                const folderButton = document.createElement('button');
                folderButton.type = 'button';
                folderButton.className = 'bookmark-select folder-select';
                folderButton.title = `Add folder: ${title}`;

                const titleSpan = document.createElement('span');
                titleSpan.className = 'bookmark-label';
                titleSpan.textContent = title;

                const metaSpan = document.createElement('span');
                metaSpan.className = 'bookmark-meta';
                metaSpan.textContent = `${children.length} item${children.length === 1 ? '' : 's'}`;

                folderButton.appendChild(titleSpan);
                folderButton.appendChild(metaSpan);

                const childUl = createTree(children);
                childUl.classList.add('collapsed');

                expandBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isExpanded = !childUl.classList.contains('collapsed');
                    setBookmarkFolderExpanded(expandBtn, childUl, !isExpanded, title);
                });

                folderButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    addBookmarkFromPicker(node);
                });

                li.appendChild(expandBtn);
                row.appendChild(folderIcon);
                row.appendChild(folderButton);
                li.appendChild(row);
                li.appendChild(childUl);
            } else {
                const faviconURL = getFavicon(node.url, 16);

                const icon = document.createElement('img');
                icon.className = 'favicon-tree';
                icon.src = faviconURL;
                icon.alt = '';

                const bookmarkButton = document.createElement('button');
                bookmarkButton.type = 'button';
                bookmarkButton.className = 'bookmark-select bookmark-link-select';
                bookmarkButton.title = `Add bookmark: ${title}`;

                const titleSpan = document.createElement('span');
                titleSpan.className = 'bookmark-label';
                titleSpan.textContent = title;

                const urlSpan = document.createElement('span');
                urlSpan.className = 'bookmark-meta';
                urlSpan.textContent = node.url || '';

                bookmarkButton.appendChild(titleSpan);
                bookmarkButton.appendChild(urlSpan);

                bookmarkButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    addBookmarkFromPicker(node);
                });

                li.appendChild(expandBtn);
                row.appendChild(icon);
                row.appendChild(bookmarkButton);
                li.appendChild(row);
            }

            ul.appendChild(li);
        });

        return ul;
    }

    function setBookmarkFolderExpanded(expandBtn, childUl, expanded, title) {
        childUl.classList.toggle('collapsed', !expanded);
        const action = expanded ? 'Collapse' : 'Expand';
        expandBtn.classList.toggle('expanded', expanded);
        expandBtn.title = `${action} ${title}`;
        expandBtn.setAttribute('aria-label', `${action} ${title}`);
    }

    function addBookmarkFromPicker(node) {
        addTileToGrid(node);
        closeModal(modalAdd);
    }

    function applyBookmarkFilter(query) {
        const container = document.getElementById('bookmark-tree');
        if (!container) return;

        const normalizedQuery = query.trim().toLowerCase();
        const items = Array.from(container.querySelectorAll('.bookmark-tree-item'));

        items.forEach(item => {
            item.classList.remove('search-hidden', 'search-match');
        });

        if (!normalizedQuery) {
            bookmarkEmpty?.classList.add('hidden');
            if (bookmarkCount?.dataset.defaultText) {
                bookmarkCount.textContent = bookmarkCount.dataset.defaultText;
            }
            return;
        }

        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            const ownMatch = item.dataset.title.includes(normalizedQuery) ||
                item.dataset.url.includes(normalizedQuery);
            const childMatches = Array.from(
                item.querySelectorAll(':scope > .bookmark-tree-list > .bookmark-tree-item:not(.search-hidden)')
            );
            const hasMatch = ownMatch || childMatches.length > 0;

            item.classList.toggle('search-hidden', !hasMatch);
            item.classList.toggle('search-match', ownMatch);

            if (hasMatch && item.dataset.kind === 'folder') {
                const expandBtn = item.querySelector(':scope > .bookmark-expand');
                const childUl = item.querySelector(':scope > .bookmark-tree-list');
                const title = item.querySelector(':scope > .bookmark-row .bookmark-label')?.textContent || 'folder';
                if (expandBtn && childUl) {
                    setBookmarkFolderExpanded(expandBtn, childUl, true, title);
                }
            }
        }

        const matchCount = container.querySelectorAll('.bookmark-tree-item.search-match').length;
        bookmarkEmpty?.classList.toggle('hidden', matchCount > 0);
        if (bookmarkCount) {
            bookmarkCount.textContent = `${matchCount} matching item${matchCount === 1 ? '' : 's'}.`;
        }
    }

    return { loadBookmarks };
}
