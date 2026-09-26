/* Defines the access check before player.js starts its async boot sequence. */
async function checkAccess() {
    try {
        const response = await fetch(`/api/sessions/check/${encodeURIComponent(videoId)}`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) return false;
        const data = await response.json();
        return Boolean(data.has_access);
    } catch (error) {
        console.warn('Access check failed:', error);
        return false;
    }
}
