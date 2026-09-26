let ADMIN_SECRET = sessionStorage.getItem('xxtube-admin-secret') || '';

function showAdminPanel() {
    document.getElementById('adminGate')?.style.setProperty('display', 'none');
    document.getElementById('adminPanel')?.classList.remove('admin-panel-hidden');
    loadVideosTable();
}

function showAdminGate(message) {
    document.getElementById('adminGate')?.style.setProperty('display', 'flex');
    document.getElementById('adminPanel')?.classList.add('admin-panel-hidden');
    const error = document.getElementById('adminLoginErr');
    if (error && message) {
        error.textContent = message;
        error.style.display = 'block';
    }
}

async function adminRequest(path, options = {}) {
    const headers = { ...(options.headers || {}), 'X-Admin-Secret': ADMIN_SECRET };
    return fetch(path, { ...options, headers, credentials: 'include', cache: 'no-store' });
}

async function submitAdminLogin() {
    const input = document.getElementById('adminPassword');
    const error = document.getElementById('adminLoginErr');
    const secret = input?.value.trim();
    if (!secret) {
        showAdminGate('Enter your admin password.');
        return;
    }

    const button = document.getElementById('adminLoginBtn');
    if (button) button.disabled = true;
    try {
        const res = await fetch('/api/admin/stats', {
            headers: { 'X-Admin-Secret': secret },
            credentials: 'include',
            cache: 'no-store'
        });
        if (!res.ok) throw new Error(res.status === 403 ? 'Incorrect password.' : `Login failed (${res.status}).`);
        ADMIN_SECRET = secret;
        sessionStorage.setItem('xxtube-admin-secret', secret);
        if (error) error.style.display = 'none';
        showAdminPanel();
    } catch (err) {
        console.error('Admin login failed:', err);
        showAdminGate(err.message || 'Login failed.');
    } finally {
        if (button) button.disabled = false;
    }
}

async function loadVideosTable() {
    try {
        const res = await adminRequest('/api/admin/videos');
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        const tbody = document.getElementById('videosTbody');
        if (!tbody) return;
        tbody.innerHTML = (data.videos || []).map(v => `
            <tr><td class="vt-thumb-cell"><div class="vt-thumb-img"><img src="${v.thumbnail_url || ''}" alt="${esc(v.title)}" loading="lazy"></div></td>
            <td><div class="vt-title">${esc(v.title)}</div><div class="vt-cat">${esc(v.category_name || '—')}</div></td>
            <td class="vt-views">${formatViews(v.views_count)}</td>
            <td style="color:var(--muted)">${formatDuration(v.duration_seconds)}</td>
            <td><div class="vt-actions"><button class="vt-btn" onclick="togglePublish('${v.id}', ${v.is_published})">${v.is_published ? 'Unpublish' : 'Publish'}</button><button class="vt-btn del" onclick="deleteVideo('${v.id}')">Delete</button></div></td></tr>`).join('');
    } catch (e) {
        document.getElementById('videosTbody').innerHTML = '<tr><td colspan="5" style="padding:20px;color:var(--muted)">Failed to load videos.</td></tr>';
    }
}

function esc(value) { return String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c])); }
function formatViews(n) { if (!n) return '0'; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }
function formatDuration(s) { if (!s) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

document.getElementById('adminLoginBtn')?.addEventListener('click', submitAdminLogin);
document.getElementById('adminPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitAdminLogin(); });
if (ADMIN_SECRET) submitAdminLogin();
