import { normalizeColorPickerValue } from './colors.js';

let closeActivePicker = () => {};

export function openColorPicker({ initialColor, onChange, onCommit = () => {}, trigger, getAnchorRect, placement = 'replace', alignRight = false, label = 'Choose color' }) {
    closeActivePicker();
    trigger.classList.add('color-picker-trigger');
    const popup = document.createElement('div');
    popup.className = 'color-picker';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', label);
    popup.innerHTML = `
        <div class="color-picker-header"><strong></strong></div>
        <div class="color-picker-preview"></div>
        <div class="color-picker-square" tabindex="0" role="group" aria-label="Saturation and brightness. Use left and right arrows for saturation, up and down for brightness."><span class="color-picker-cursor"></span></div>
        <label>Hue<input class="color-picker-hue" type="range" min="0" max="360" aria-label="Hue"></label>
        <label>HEX<input class="color-picker-hex" type="text" maxlength="7" spellcheck="false" aria-label="HEX color" pattern="#[0-9a-fA-F]{6}"></label>`;
    popup.querySelector('strong').textContent = label;
    const hex = popup.querySelector('.color-picker-hex');
    const square = popup.querySelector('.color-picker-square');
    const cursor = popup.querySelector('.color-picker-cursor');
    const hueInput = popup.querySelector('.color-picker-hue');
    let hue = 0;
    let saturation = 0;
    let brightness = 0;
    const preview = popup.querySelector('.color-picker-preview');
    let value = normalizeColorPickerValue(initialColor) || '#000000';
    function readColor() {
        const [r, g, b] = [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
        const max = Math.max(r, g, b);
        const delta = max - Math.min(r, g, b);
        brightness = max;
        saturation = max ? delta / max : 0;
        if (delta) {
            const sector = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
            hue = (sector * 60 + 360) % 360;
        }
    }
    readColor();
    function render() {
        hex.value = value;
        hex.setAttribute('aria-invalid', 'false');
        preview.style.backgroundColor = value;
        hueInput.value = hue;
        square.style.backgroundColor = `hsl(${hue} 100% 50%)`;
        cursor.style.left = `${saturation * 100}%`;
        cursor.style.top = `${(1 - brightness) * 100}%`;
        square.setAttribute('aria-description', `Saturation ${Math.round(saturation * 100)}%, brightness ${Math.round(brightness * 100)}%`);
    }
    function update(next) {
        value = next;
        readColor();
        render();
        onChange(value);
    }
    function updateFromGradient() {
        const chroma = brightness * saturation;
        const sector = (hue % 360) / 60;
        const x = chroma * (1 - Math.abs(sector % 2 - 1));
        const channels = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(sector)];
        value = '#' + channels.map(channel => Math.round((channel + brightness - chroma) * 255).toString(16).padStart(2, '0')).join('');
        render();
        onChange(value);
    }
    hueInput.addEventListener('input', () => {
        hue = Number(hueInput.value);
        updateFromGradient();
    });
    function pick(event) {
        const rect = square.getBoundingClientRect();
        saturation = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        brightness = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        updateFromGradient();
    }
    square.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        square.focus({ preventScroll: true });
        square.setPointerCapture(event.pointerId);
        pick(event);
    });
    square.addEventListener('pointermove', event => {
        if (square.hasPointerCapture(event.pointerId)) pick(event);
    });
    square.addEventListener('pointerup', event => {
        if (square.hasPointerCapture(event.pointerId)) {
            pick(event);
            square.releasePointerCapture(event.pointerId);
        }
    });
    square.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 0.1 : 0.01;
        if (event.key === 'ArrowLeft') saturation = Math.max(0, saturation - step);
        if (event.key === 'ArrowRight') saturation = Math.min(1, saturation + step);
        if (event.key === 'ArrowDown') brightness = Math.max(0, brightness - step);
        if (event.key === 'ArrowUp') brightness = Math.min(1, brightness + step);
        updateFromGradient();
    });
    hex.addEventListener('input', () => {
        const normalized = normalizeColorPickerValue(hex.value);
        if (/^#[0-9a-f]{6}$/i.test(hex.value)) update(normalized);
        else hex.setAttribute('aria-invalid', 'true');
    });
    hex.addEventListener('change', () => {
        const normalized = normalizeColorPickerValue(hex.value);
        if (normalized) update(normalized);
    });
    function position() {
        if (!trigger.isConnected || !trigger.getClientRects().length || trigger.closest('.hidden, [hidden]')) {
            close();
            return;
        }
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0;
        const top = viewport?.offsetTop || 0;
        const width = viewport?.width || window.innerWidth;
        const height = viewport?.height || window.innerHeight;
        popup.style.maxWidth = `${Math.max(0, width - 16)}px`;
        popup.style.maxHeight = `${Math.max(0, height - 16)}px`;
        const anchor = getAnchorRect();
        const bounds = popup.getBoundingClientRect();
        const x = placement === 'left' ? anchor.left - bounds.width - 8 : alignRight ? anchor.right - bounds.width : anchor.left;
        popup.style.left = `${Math.max(left + 8, Math.min(x, left + width - bounds.width - 8))}px`;
        popup.style.top = `${Math.max(top + 8, Math.min(anchor.top, top + height - bounds.height - 8))}px`;
    }
    function close() {
        popup.remove();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', keydown, true);
        document.removeEventListener('scroll', position, true);
        window.removeEventListener('resize', position);
        window.visualViewport?.removeEventListener('resize', position);
        window.visualViewport?.removeEventListener('scroll', position);
        observer.disconnect();
        closeActivePicker = () => {};
        onCommit();
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
        if (document.activeElement === trigger) {
            trigger.addEventListener('blur', () => trigger.classList.remove('color-picker-trigger'), { once: true });
        } else trigger.classList.remove('color-picker-trigger');
    }
    function outside(event) {
        if (!popup.contains(event.target)) close();
    }
    function keydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === 'Tab') {
            const controls = [...popup.querySelectorAll('button, input, [tabindex]')];
            const index = controls.indexOf(document.activeElement);
            event.preventDefault();
            controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
        } else if (event.key === 'Enter' && event.target === hex && normalizeColorPickerValue(hex.value)) close();
    }
    const observer = new MutationObserver(position);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
    render();
    document.body.appendChild(popup);
    position();
    closeActivePicker = close;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    hex.focus({ preventScroll: true });
    hex.select();
}
