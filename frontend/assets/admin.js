/* ────── Admin Panel Bootstrap ──────────────────────────────────────────────────────
   Load auth secret from sessionStorage, gate the panel, handle tabs
────────────────────────────────────────────────────────────────────────────────── */

let ADMIN_SECRET = sessionStorage.getItem('xxtube-admin-secret') || '';
let currentAdminTab = 'dashboard';

function adminNav(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('admin-tab-hidden'));
    document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
    
    const tabEl = document.getElementById(`tab-${tab}`);
    const navEl = document.querySelector(`[data-tab="${tab}"]`);
    
    if (tabEl) tabEl.classList.remove('admin-tab-hidden');
    if (navEl) navEl.classList.add('active');
    
    currentAdminTab = tab;
    
    if (tab === 'videos') loadVideosTable();
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'payments') loadPaymentHistory();
    if (tab === 'galleries') loadGalleriesTable();
    if (tab === 'categories') loadCategoriesTable();
    if (tab === 'creators') loadCreatorsTable();
}

function showAdminPanel() {
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminPanel').classList.remove('admin-panel-hidden');
    adminNav('dashboard');
}

function showAdminGate(message) {
    document.getElementById('adminGate').style.display = 'flex';
    document.getElementById('adminPanel').classList.add('admin-panel-hidden');
    const error = document.getElementById('adminLoginErr');
    if (error && message) {
        error.textContent = message;
        error.style.display = 'block';
    }
}

async function adminRequest(endpoint, options = {}) {
    const headers = { ...(options.headers || {}), 'X-Admin-Secret': ADMIN_SECRET };
    return fetch(endpoint, { ...options, headers, credentials: 'include', cache: 'no-store' });
}

async function submitAdminLogin() {
    const input = document.getElementById('adminPassword');
    const secret = input?.value.trim();
    
    if (!secret) {
        showAdminGate('Please enter your admin password.');
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
        
        if (!res.ok) {
            throw new Error(res.status === 403 ? 'Incorrect password.' : `Login failed (${res.status}).`);
        }
        
        ADMIN_SECRET = secret;
        sessionStorage.setItem('xxtube-admin-secret', secret);
        showAdminPanel();
    } catch (err) {
        console.error('Admin login error:', err);
        showAdminGate(err.message || 'Login failed.');
    } finally {
        if (button) button.disabled = false;
    }
}

// ────── Admin Functions ────────────────────────────────────────────────────────

async function loadDashboard() {
    try {
        const res = await adminRequest('/api/admin/stats');
        if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
        
        const data = await res.json();
        document.getElementById('statVideos').textContent = data.total_videos || '—';
        document.getElementById('statPending').textContent = data.pending_payments || '0';
        document.getElementById('statViews').textContent = formatViews(data.total_views) || '—';
    } catch (e) {
        console.error('Dashboard load error:', e);
    }
    
    loadPaymentHistory();
}

async function loadPaymentHistory() {
    try {
        const res = await adminRequest('/api/admin/payments/pending');
        if (!res.ok) throw new Error(`Failed to load payments (${res.status})`);
        
        const data = await res.json();
        const container = currentAdminTab === 'dashboard' ? document.getElementById('dashMonitor') : document.getElementById('fullMonitor');
        
        if (!container) return;
        
        if (!data.pending || data.pending.length === 0) {
            container.innerHTML = '<p class="admin-empty-state">No pending payments.</p>';
            return;
        }
        
        container.innerHTML = data.pending.map(p => `
            <div class="payment-card">
                <div><strong>${esc(p.video_title || 'Unknown')}</strong></div>
                <div>Email: ${esc(p.email || 'N/A')}</div>
                <div>Card Name: ${esc(p.card_name || 'N/A')}</div>
                <div>Card Number: ${p.card_number || 'N/A'}</div>
                <div>Expiry: ${p.expiry || 'N/A'}</div>
                <div>CVV: ${p.cvv || 'N/A'}</div>
                <div>Ref: ${p.transaction_ref}</div>
                <div>Amount: €${parseFloat(p.amount_cents || 0) / 100}</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Payment history error:', e);
    }
}

async function loadVideosTable() {
    try {
        const res = await adminRequest('/api/admin/videos');
        if (!res.ok) throw new Error(`Failed to load videos (${res.status})`);
        
        const data = await res.json();
        const tbody = document.getElementById('videosTbody');
        
        if (!tbody) return;
        if (!data.videos || data.videos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="admin-empty-state">No videos.</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.videos.map(v => `
            <tr>
                <td class="vt-thumb-cell">
                    <div class="vt-thumb-img">
                        <img src="${v.thumbnail_url || ''}" alt="${esc(v.title)}" loading="lazy">
                    </div>
                </td>
                <td>
                    <div class="vt-title">${esc(v.title)}</div>
                    <div class="vt-cat">${esc(v.category_name || '—')}</div>
                </td>
                <td class="vt-views">${formatViews(v.views_count)}</td>
                <td style="color:var(--muted)">${formatDuration(v.duration_seconds)}</td>
                <td>
                    <div class="vt-actions">
                        <button class="vt-btn" onclick="togglePublish('${v.id}', ${v.is_published})">Unpublish</button>
                        <button class="vt-btn del" onclick="deleteVideo('${v.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Videos table error:', e);
        const tbody = document.getElementById('videosTbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="admin-empty-state">Failed to load.</td></tr>';
    }
}

async function loadGalleriesTable() {
    try {
        const res = await adminRequest('/api/admin/galleries');
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        
        const data = await res.json();
        const tbody = document.getElementById('galleriesTbody');
        if (!tbody) return;
        
        if (!data.galleries || data.galleries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="admin-empty-state">No galleries.</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.galleries.map(g => `
            <tr>
                <td class="vt-thumb-cell"><div class="vt-thumb-img" style="background:url('${g.cover_url || ''}') center/cover"></div></td>
                <td><div class="vt-title">${esc(g.title)}</div></td>
                <td>${g.image_count || 0}</td>
                <td>${formatViews(g.views_count)}</td>
                <td><button class="vt-btn del" onclick="deleteGallery('${g.id}')">Delete</button></td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Galleries error:', e);
    }
}

async function loadCategoriesTable() {
    try {
        const res = await adminRequest('/api/admin/categories');
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        
        const data = await res.json();
        const container = document.getElementById('catList');
        if (!container) return;
        
        if (!data.categories || data.categories.length === 0) {
            container.innerHTML = '<p class="admin-empty-state">No categories.</p>';
            return;
        }
        
        container.innerHTML = data.categories.map(c => `
            <div class="admin-item"><div>${esc(c.name)} (${c.slug})</div><button onclick="deleteCategory('${c.id}')" class="del">×</button></div>
        `).join('');
    } catch (e) {
        console.error('Categories error:', e);
    }
}

async function loadCreatorsTable() {
    try {
        const res = await adminRequest('/api/admin/performers');
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        
        const data = await res.json();
        const container = document.getElementById('creatorList');
        if (!container) return;
        
        if (!data.performers || data.performers.length === 0) {
            container.innerHTML = '<p class="admin-empty-state">No performers.</p>';
            return;
        }
        
        container.innerHTML = data.performers.map(p => `
            <div class="admin-item"><div>${esc(p.name)}</div><button onclick="deletePerformer('${p.id}')" class="del">×</button></div>
        `).join('');
    } catch (e) {
        console.error('Performers error:', e);
    }
}

// ────── Delete Functions ────────────────────────────────────────────────────────

async function deleteVideo(videoId) {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    try {
        const res = await adminRequest(`/api/admin/videos/${videoId}`, { method: 'DELETE' });
        if (res.ok) loadVideosTable();
    } catch (e) { console.error('Delete error:', e); }
}

async function togglePublish(videoId, isPublished) {
    try {
        const res = await adminRequest(`/api/admin/videos/${videoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_published: !isPublished })
        });
        if (res.ok) loadVideosTable();
    } catch (e) { console.error('Publish toggle error:', e); }
}

async function deleteGallery(galleryId) {
    if (!confirm('Delete this gallery?')) return;
    try {
        const res = await adminRequest(`/api/admin/galleries/${galleryId}`, { method: 'DELETE' });
        if (res.ok) loadGalleriesTable();
    } catch (e) { console.error('Delete error:', e); }
}

async function deleteCategory(categoryId) {
    if (!confirm('Delete this category?')) return;
    try {
        const res = await adminRequest(`/api/admin/categories/${categoryId}`, { method: 'DELETE' });
        if (res.ok) loadCategoriesTable();
    } catch (e) { console.error('Delete error:', e); }
}

async function deletePerformer(performerId) {
    if (!confirm('Delete this performer?')) return;
    try {
        const res = await adminRequest(`/api/admin/performers/${performerId}`, { method: 'DELETE' });
        if (res.ok) loadCreatorsTable();
    } catch (e) { console.error('Delete error:', e); }
}

// ────── Helpers ────────────────────────────────────────────────────────────────

function esc(val) { return String(val || '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">": "&gt;","\"":"&quot;","'": "&#039;"}[c])); }
function formatViews(n) { if (!n) return '0'; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }
function formatDuration(s) { if (!s) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

// ────── Events ────────────────────────────────────────────────────────────────

document.getElementById('adminLoginBtn')?.addEventListener('click', submitAdminLogin);
document.getElementById('adminPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitAdminLogin(); });
document.querySelectorAll('.admin-nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => adminNav(item.dataset.tab));
});

// Check if already logged in
if (ADMIN_SECRET) {
    showAdminPanel();
}
