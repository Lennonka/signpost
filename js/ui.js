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
    const settingsTabs = [...document.querySelectorAll('.settings-tabs [role="tab"]')];
    function selectSettingsTab(selected) {
        for (const tab of settingsTabs) {
            const active = tab === selected;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
        }
    }
    settingsTabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectSettingsTab(tab));
        tab.addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % settingsTabs.length;
            else if (event.key === 'ArrowLeft') next = (index - 1 + settingsTabs.length) % settingsTabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = settingsTabs.length - 1;
            else return;
            event.preventDefault();
            selectSettingsTab(settingsTabs[next]);
            settingsTabs[next].focus();
        });
    });

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
