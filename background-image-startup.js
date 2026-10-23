// Run before the body and module graph load to avoid a white wallpaper flash.
(() => {
    try {
        const image = localStorage.getItem('signpost.desktopBackgroundImage');
        if (!image) return;
        const style = document.documentElement.style;
        style.backgroundImage = `url(${image})`;
        style.backgroundSize = 'cover';
        style.backgroundPosition = 'center';
        style.backgroundRepeat = 'no-repeat';
    } catch (error) {
        console.warn('Could not read cached desktop background image.', error);
    }
})();
