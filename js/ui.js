export function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
}

export function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    if (document.querySelectorAll('.modal:not(.hidden)').length === 0) {
        document.body.classList.remove('modal-open');
    }
}

export function showBubbleMessage(text, duration = 2000) {
    const bubble = document.getElementById('bubble-message');
    bubble.textContent = text;
    bubble.classList.remove('hidden');
    setTimeout(() => {
        bubble.classList.add('hidden');
    }, duration);
}

export function bindToolbar({ loadBookmarks }) {
    // Set up buttons and modals
    const btnAdd = document.getElementById('btn-add');
    const btnSettings = document.getElementById('btn-settings');
    const modalAdd = document.getElementById('bookmark-picker');
    const modalSet = document.getElementById('settings-panel');
    const bookmarkSearch = document.getElementById('bookmark-search');

    btnAdd.addEventListener('click', () => {
        if (!modalAdd) return;
        const isVisible = !modalAdd.classList.contains('hidden');
        if (isVisible) {
            closeModal(modalAdd);
        } else {
            closeModal(modalSet);
            openModal(modalAdd);
            if (bookmarkSearch) bookmarkSearch.value = '';
            loadBookmarks();
            requestAnimationFrame(() => bookmarkSearch?.focus());
        }
    });

    btnSettings.addEventListener('click', () => {
        if (!modalSet) return;
        const isVisible = !modalSet.classList.contains('hidden');
        if (isVisible) {
            closeModal(modalSet);
        } else {
            closeModal(modalAdd);
            openModal(modalSet);
        }
    });

    document.querySelectorAll('.modal .btn-close').forEach(btn =>
        btn.addEventListener('click', () => closeModal(btn.closest('.modal')))
    );

}
