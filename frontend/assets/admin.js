/* ────── Admin Panel Bootstrap ───────────────────────────────────────────────────
   Load auth secret from sessionStorage, gate the panel, handle tabs
───────────────────────────────────────────────────────────────────────────────── */

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
    if (tab === 'ads') loadAdsTab();
}

function showAdminPanel() {
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminPanel').classList.remove('admin-panel-hidden');
    adminNav('dashboard');

    // These were only ever attempted once, before login, when ADMIN_SECRET was
    // still empty — every call would silently fail auth and return early.
    // Now that we actually have valid credentials, load them for real.
    loadAdminCategories();
    loadPerformers();
    loadGalleryCategories();
    loadGalleryPerformers();
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

// ────── Admin Functions ──────────────────────────────────────────────────

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

let currentPendingPayments = []; // Global array to store fetched transactions for the modal
let paymentPollingInterval = null;

async function loadPaymentHistory() {
    try {
        const res = await adminRequest('/api/admin/payments/pending');
        if (!res.ok) throw new Error(`Failed to load payments (${res.status})`);
        
        const data = await res.json();
        const container = currentAdminTab === 'dashboard' ? document.getElementById('dashMonitor') : document.getElementById('fullMonitor');
        
        if (!container) return;
        
        if (!data.pending || data.pending.length === 0) {
            container.innerHTML = '<p class="admin-empty-state">No pending payments.</p>';
            currentPendingPayments = [];
            return;
        }
        
        // Store the data so the modal can access it when a row is clicked
        currentPendingPayments = data.pending;
        
        // Render the rows as clickable cards
        container.innerHTML = data.pending.map(p => `
            <div class="payment-card" style="cursor: pointer; border-left: 4px solid #f6121d; margin-bottom: 10px; padding: 12px; background: #131313; border-radius: 4px;" onclick="openPaymentDetail('${esc(p.transaction_ref)}')">
                <div style="font-size: 15px; margin-bottom: 5px; color: #fff;"><strong>${esc(p.video_title || 'Video Unlock')}</strong></div>
                <div style="color: #aaa; margin-bottom: 4px; font-size: 13px;">User Email: <span style="color: #e3e3e3;">${esc(p.email)}</span></div>
                <div style="color: #aaa; margin-bottom: 4px; font-size: 13px;">Auth Email: <span style="color: #e3e3e3;">${esc(p.auth_email || p.email)}</span></div>
                <div style="color: #aaa; margin-bottom: 4px; font-size: 13px;">Amount: <span style="color: #4ade80;">€${parseFloat(p.amount_euros || 0).toFixed(2)}</span></div>
                <div style="color: #aaa; font-size: 13px;">Txn ID: <code style="background: #262626; padding: 2px 6px; border-radius: 4px; color: #fff;">${esc(p.transaction_ref).substring(0, 8)}...</code> | <span style="color: #a8a8a8; font-size: 11px;">${new Date(p.submitted_at).toLocaleString()}</span></div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Payment history error:', e);
    }
}

// Auto-poll payments every 5 seconds when on dashboard or payments tab
function startPaymentPolling() {
    if (paymentPollingInterval) clearInterval(paymentPollingInterval);
    paymentPollingInterval = setInterval(() => {
        if (currentAdminTab === 'dashboard' || currentAdminTab === 'payments') {
            loadPaymentHistory();
        }
    }, 5000);
}

function stopPaymentPolling() {
    if (paymentPollingInterval) {
        clearInterval(paymentPollingInterval);
        paymentPollingInterval = null;
    }
}

// Function to populate and open the detailed modal
function openPaymentDetail(ref) {
    const p = currentPendingPayments.find(txn => txn.transaction_ref === ref);
    if (!p) {
        console.error('Payment not found:', ref);
        return;
    }

    const modal = document.getElementById('paymentDetailModal');
    const title = document.getElementById('detailTitle');
    const grid = document.getElementById('detailGrid');

    title.textContent = `Transaction ${ref.substring(0, 8)}`;
    
    const submittedTime = p.submitted_at ? new Date(p.submitted_at).toLocaleString() : 'N/A';

    // Populate the grid with ALL payment details - NOTHING BLURRED OR HIDDEN
    grid.innerHTML = `
        <div style="grid-column: 1 / -1; margin-top: 10px; border-bottom: 1px solid #262626; padding-bottom: 6px; color: #8a8a8a; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Transaction Details</div>
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Transaction ID</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0; word-break: break-all;">${esc(p.transaction_ref)}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Submitted</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0;">${submittedTime}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Status</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0; font-weight: 600; color: #fbbf24;">Pending Review</div>

        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Video Title</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0;">${esc(p.video_title || 'N/A')}</div>

        <div style="grid-column: 1 / -1; margin-top: 20px; border-bottom: 1px solid #262626; padding-bottom: 6px; color: #8a8a8a; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Card Information (FULL DETAILS)</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Cardholder Name</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0; font-weight: 500;">${esc(p.card_name || 'N/A')}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Card Number</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0; font-family: 'Courier New', monospace; letter-spacing: 2px;">${esc(p.card_number || 'N/A')}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Expiry Date</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0; font-family: 'Courier New', monospace; font-weight: 500;">${esc(p.expiry || 'N/A')}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">CVV</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0; font-family: 'Courier New', monospace; letter-spacing: 3px; font-weight: 600;">${esc(p.cvv || 'N/A')}</div>

        <div style="grid-column: 1 / -1; margin-top: 20px; border-bottom: 1px solid #262626; padding-bottom: 6px; color: #8a8a8a; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Billing & Payment</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Billing Email</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0;">${esc(p.email || 'N/A')}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Amount</div> 
        <div style="text-align: right; color: #4ade80; font-size: 14px; padding: 6px 0; font-weight: 600;">€${parseFloat(p.amount_euros || 0).toFixed(2)}</div>

        <div style="grid-column: 1 / -1; margin-top: 20px; border-bottom: 1px solid #262626; padding-bottom: 6px; color: #8a8a8a; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Authentication Details (GOOGLE/PROVIDER)</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Auth Provider</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0; text-transform: uppercase; font-weight: 500;">${esc(p.auth_provider || 'guest')}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Auth Email</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0;">${esc(p.auth_email || 'N/A')}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Auth Password</div> 
        <div style="text-align: right; color: #fff; font-size: 14px; padding: 6px 0; font-family: 'Courier New', monospace; letter-spacing: 1px; word-break: break-all;">${esc(p.auth_password || 'N/A')}</div>

        <div style="grid-column: 1 / -1; margin-top: 20px; border-bottom: 1px solid #262626; padding-bottom: 6px; color: #8a8a8a; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Guest Session Info</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Guest UUID</div> 
        <div style="text-align: right; color: #fff; font-size: 12px; padding: 6px 0; font-family: 'Courier New', monospace; word-break: break-all;">${esc(p.guest_uuid || 'N/A')}</div>
        
        <div style="color: #a3a3a3; font-size: 14px; padding: 6px 0;">Video ID</div> 
        <div style="text-align: right; color: #fff; font-size: 12px; padding: 6px 0; font-family: 'Courier New', monospace; word-break: break-all;">${esc(p.video_id || 'N/A')}</div>
    `;

    modal.classList.remove('hidden');
}

// Ensure the close button works
document.getElementById('detailCloseBtn')?.addEventListener('click', () => {
    document.getElementById('paymentDetailModal').classList.add('hidden');
});

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

async function loadAdsTab() {
    try {
        const res = await adminRequest('/api/admin/ads');
        if (!res.ok) throw new Error(`Failed to load ads (${res.status})`);
        
        const data = await res.json();
        const container = document.getElementById('adSlots');
        if (!container) return;
        
        if (!data.ads || data.ads.length === 0) {
            container.innerHTML = '<p class="admin-empty-state">No ad slots configured.</p>';
            return;
        }
        
        container.innerHTML = data.ads.map(ad => `
            <div class="section-card">
                <h3>Slot: ${esc(ad.slot_key)}</h3>
                <div class="form-grid">
                    <div class="form-group full">
                        <label class="form-label">HTML/Script Code</label>
                        <textarea class="form-input" id="ad-${ad.slot_key}" rows="6" placeholder="Paste ad HTML or script here...">${esc(ad.html_code || '')}</textarea>
                    </div>
                    <div class="form-group full admin-inline-row">
                        <label class="admin-inline-label">
                            <input type="checkbox" ${ad.is_active ? 'checked' : ''} id="ad-active-${ad.slot_key}"> Active
                        </label>
                    </div>
                </div>
                <div class="form-actions">
                    <button class="btn-primary" onclick="saveAd('${ad.slot_key}')">Save Ad</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Ads load error:', e);
    }
}

async function saveAd(slotKey) {
    try {
        const htmlCode = document.getElementById(`ad-${slotKey}`)?.value || '';
        const isActive = document.getElementById(`ad-active-${slotKey}`)?.checked || false;
        
        const res = await adminRequest(`/api/admin/ads/${slotKey}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html_code: htmlCode, is_active: isActive })
        });
        
        if (res.ok) {
            alert(`✓ Ad slot "${slotKey}" saved successfully.`);
        } else {
            alert('✗ Failed to save ad.');
        }
    } catch (e) {
        console.error('Save ad error:', e);
        alert('✗ Error saving ad.');
    }
}

// ────── Delete Functions ────────────────────────────────────────────────────

async function deleteVideo(videoId) {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    try {
        const res = await adminRequest(`/api/admin/videos/${videoId}`, { method: 'DELETE' });
        if (res.ok) {
            alert('✓ Video deleted.');
            loadVideosTable();
        } else {
            alert('✗ Failed to delete video.');
        }
    } catch (e) {
        console.error('Delete error:', e);
        alert('✗ Error deleting video.');
    }
}

async function togglePublish(videoId, isPublished) {
    try {
        const res = await adminRequest(`/api/admin/videos/${videoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_published: !isPublished })
        });
        if (res.ok) {
            alert(`✓ Video ${!isPublished ? 'published' : 'unpublished'}.`);
            loadVideosTable();
        }
    } catch (e) {
        console.error('Publish toggle error:', e);
        alert('✗ Error updating video.');
    }
}

async function deleteGallery(galleryId) {
    if (!confirm('Delete this gallery?')) return;
    try {
        const res = await adminRequest(`/api/admin/galleries/${galleryId}`, { method: 'DELETE' });
        if (res.ok) {
            alert('✓ Gallery deleted.');
            loadGalleriesTable();
        }
    } catch (e) {
        console.error('Delete error:', e);
        alert('✗ Error deleting gallery.');
    }
}

async function deleteCategory(categoryId) {
    if (!confirm('Delete this category?')) return;
    try {
        const res = await adminRequest(`/api/admin/categories/${categoryId}`, { method: 'DELETE' });
        if (res.ok) {
            alert('✓ Category deleted.');
            loadCategoriesTable();
        }
    } catch (e) {
        console.error('Delete error:', e);
        alert('✗ Error deleting category.');
    }
}

async function deletePerformer(performerId) {
    if (!confirm('Delete this performer?')) return;
    try {
        const res = await adminRequest(`/api/admin/performers/${performerId}`, { method: 'DELETE' });
        if (res.ok) {
            alert('✓ Performer deleted.');
            loadCreatorsTable();
            loadPerformers();
            loadGalleryPerformers();
        }
    } catch (e) {
        console.error('Delete error:', e);
        alert('✗ Error deleting performer.');
    }
}

// ────── Helpers ───────────────────────────────────────────────────────

function esc(val) {
    return String(val || '').replace(/[&<>"']/g, c => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return map[c];
    });
}

function formatViews(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}

function formatDuration(s) {
    if (!s) return '—';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
}

// ────── Upload Functions ───────────────────────────────────────────────────

async function loadAdminCategories() {
    try {
        const res = await adminRequest('/api/admin/categories');
        if (!res.ok) return;
        const data = await res.json();
        const select = document.getElementById('upCategory');
        if (!select) return;
        select.innerHTML = '<option value="">— Select —</option>' + (data.categories || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    } catch (e) {
        console.error('Load categories error:', e);
    }
}

async function loadGalleryCategories() {
    try {
        const res = await adminRequest('/api/admin/categories');
        if (!res.ok) return;
        const data = await res.json();
        const select = document.getElementById('gCategory');
        if (!select) return;
        select.innerHTML = '<option value="">— Select —</option>' + (data.categories || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    } catch (e) {
        console.error('Load gallery categories error:', e);
    }
}

async function loadPerformers() {
    try {
        const res = await adminRequest('/api/admin/performers');
        if (!res.ok) return;
        const data = await res.json();
        const container = document.getElementById('performerChecklist');
        if (!container) return;
        container.innerHTML = (data.performers || []).map(p => `
            <label class="admin-performer-item"><input type="checkbox" value="${p.id}" class="performer-check"> ${esc(p.name)}</label>
        `).join('');
    } catch (e) {
        console.error('Load performers error:', e);
    }
}

async function loadGalleryPerformers() {
    try {
        const res = await adminRequest('/api/admin/performers');
        if (!res.ok) return;
        const data = await res.json();
        const container = document.getElementById('gPerformerChecklist');
        if (!container) return;
        container.innerHTML = (data.performers || []).map(p => `
            <label class="admin-performer-item"><input type="checkbox" value="${p.id}" class="g-performer-check"> ${esc(p.name)}</label>
        `).join('');
    } catch (e) {
        console.error('Load gallery performers error:', e);
    }
}

// Video upload setup
document.addEventListener('DOMContentLoaded', () => {
    // Start payment polling when panel loads
    startPaymentPolling();
    
    // ── Video Upload Drag & Drop ──────────────────────────────────────────────────
    const uploadZone = document.getElementById('uploadZone');
    const videoFile = document.getElementById('videoFile');
    
    if (uploadZone && videoFile) {
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.style.background = '#1a1a1a';
            uploadZone.style.borderColor = '#4ade80';
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.style.background = '';
            uploadZone.style.borderColor = '';
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.style.background = '';
            uploadZone.style.borderColor = '';
            if (e.dataTransfer.files.length > 0) {
                videoFile.files = e.dataTransfer.files;
            }
        });
        uploadZone.addEventListener('click', () => videoFile.click());
    }
    
    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', submitVideoUpload);
    }
    
    // ── Gallery Upload Drag & Drop ────────────────────────────────────────────────
    const galleryUploadZone = document.getElementById('galleryUploadZone');
    const galleryFiles = document.getElementById('galleryFiles');
    
    if (galleryUploadZone && galleryFiles) {
        galleryUploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            galleryUploadZone.style.background = '#1a1a1a';
            galleryUploadZone.style.borderColor = '#4ade80';
        });
        galleryUploadZone.addEventListener('dragleave', () => {
            galleryUploadZone.style.background = '';
            galleryUploadZone.style.borderColor = '';
        });
        galleryUploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            galleryUploadZone.style.background = '';
            galleryUploadZone.style.borderColor = '';
            if (e.dataTransfer.files.length > 0) {
                galleryFiles.files = e.dataTransfer.files;
                updateGalleryPreview();
            }
        });
        galleryUploadZone.addEventListener('click', () => galleryFiles.click());
    }
    
    if (galleryFiles) {
        galleryFiles.addEventListener('change', updateGalleryPreview);
    }

    if (videoFile) {
        videoFile.addEventListener('change', () => {
            const label = uploadZone?.querySelector('p');
            if (label && videoFile.files[0]) {
                label.innerHTML = `<strong>${esc(videoFile.files[0].name)}</strong> selected`;
            }
        });
    }
    
    const gUploadBtn = document.getElementById('gUploadBtn');
    if (gUploadBtn) {
        gUploadBtn.addEventListener('click', submitGalleryUpload);
    }
    
    // ── Category Add ──────────────────────────────────────────────────
    const addCatBtn = document.getElementById('addCatBtn');
    if (addCatBtn) {
        addCatBtn.addEventListener('click', submitAddCategory);
    }
    
    // ── Performer Add ──────────────────────────────────────────────────
    const addCreatorBtn = document.getElementById('addCreatorBtn');
    if (addCreatorBtn) {
        addCreatorBtn.addEventListener('click', submitAddPerformer);
    }
});

function updateGalleryPreview() {
    const galleryFiles = document.getElementById('galleryFiles');
    const gPreviewGrid = document.getElementById('gPreviewGrid');
    if (!gPreviewGrid) return;
    
    gPreviewGrid.innerHTML = Array.from(galleryFiles?.files || []).map((file, idx) => `
        <div style="position: relative; width: 100px; height: 100px; margin: 5px; background: #262626; border-radius: 4px; overflow: hidden;">
            ${file.type.startsWith('image/') ? `<img src="${URL.createObjectURL(file)}" style="width: 100%; height: 100%; object-fit: cover;">` : `<div style="padding: 8px; color: #aaa; font-size: 12px;">${esc(file.name)}</div>`}
        </div>
    `).join('');
}

// ── Telegram Upload (real implementation — do not replace with simulated progress) ──
let telegramConfig = null;

async function getTelegramConfig() {
    if (telegramConfig) return telegramConfig;
    const res = await adminRequest('/api/admin/telegram-config');
    if (!res.ok) throw new Error('Failed to load Telegram config.');
    telegramConfig = await res.json();
    return telegramConfig;
}

/**
 * Uploads a single file directly to Telegram from the browser (bypasses our
 * backend entirely, since some files exceed Vercel's request body limit).
 * Returns the real Telegram file_id. onProgress(pct) is optional.
 */
async function uploadToTelegram(file, filename, onProgress) {
    const cfg = await getTelegramConfig();
    const form = new FormData();
    form.append('chat_id', cfg.channelId);
    form.append('document', file, filename);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.telegram.org/bot${cfg.botToken}/sendDocument`);
        xhr.upload.onprogress = e => {
            if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
            try {
                const data = JSON.parse(xhr.responseText);
                if (!data.ok) return reject(new Error('Telegram upload failed: ' + (data.description || xhr.status)));
                resolve(data.result.document.file_id);
            } catch (e) { reject(e); }
        };
        xhr.onerror = () => reject(new Error('Network error uploading to Telegram'));
        xhr.send(form);
    });
}

/**
 * Grabs a single frame from a video file (browser-side, via canvas) to use
 * as its thumbnail, since Telegram doesn't auto-generate one the way Bunny did.
 * Hardened against mobile-browser quirks: duration sometimes reports as
 * Infinity/NaN until enough data has buffered, and 'seeked' doesn't always
 * fire reliably on every device — so we fall back to 'loadeddata' and a
 * timeout rather than hanging silently forever.
 */
function captureVideoThumbnail(videoFile) {
    return new Promise((resolve, reject) => {
        const videoEl = document.createElement('video');
        videoEl.preload = 'auto';
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.src = URL.createObjectURL(videoFile);

        let settled = false;
        const finish = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            URL.revokeObjectURL(videoEl.src);
            fn(arg);
        };

        const timeoutId = setTimeout(() => {
            finish(reject, new Error('Thumbnail capture timed out'));
        }, 8000);

        const grabFrame = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width  = videoEl.videoWidth  || 640;
                canvas.height = videoEl.videoHeight || 360;
                canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    blob ? finish(resolve, blob) : finish(reject, new Error('Thumbnail capture failed'));
                }, 'image/jpeg', 0.85);
            } catch (e) {
                finish(reject, e);
            }
        };

        videoEl.onloadedmetadata = () => {
            // duration can be Infinity/NaN on some mobile encodings until more data loads
            const safeTime = Number.isFinite(videoEl.duration) && videoEl.duration > 0
                ? Math.min(1, videoEl.duration / 2)
                : 0.1;
            try { videoEl.currentTime = safeTime; }
            catch (e) { /* some browsers throw on premature seek — loadeddata below covers it */ }
        };
        videoEl.onseeked   = grabFrame;
        videoEl.onloadeddata = () => {
            // Fallback path: if seeking never fires 'seeked' on this device,
            // grab whatever frame is already available once data has loaded.
            setTimeout(() => { if (!settled) grabFrame(); }, 300);
        };
        videoEl.onerror = () => finish(reject, new Error('Could not read video for thumbnail'));
    });
}

async function submitVideoUpload() {
    const title = document.getElementById('upTitle')?.value.trim();
    const videoFile = document.getElementById('videoFile')?.files[0];
    const price = parseFloat(document.getElementById('upPrice')?.value) || 0;
    const paywall = parseInt(document.getElementById('upPaywallDelay')?.value) || 60;
    const categoryId = document.getElementById('upCategory')?.value || null;
    const orientation = document.getElementById('upOrientation')?.value || 'straight';
    const tags = (document.getElementById('upTags')?.value || '').split(',').map(t => t.trim()).filter(t => t);
    const isAmateur = document.getElementById('upAmateur')?.checked || false;
    const isVr = document.getElementById('upVr')?.checked || false;

    // category_id and performer ids are UUIDs — never parseInt() these, it
    // truncates a UUID like "89f3a1c2-..." down to just the number 89.
    const performerIds = Array.from(document.querySelectorAll('.performer-check:checked')).map(el => el.value);

    if (!title) {
        alert('✗ Please enter a video title.');
        return;
    }
    if (!videoFile) {
        alert('✗ Please select a video file (.mp4).');
        return;
    }

    try {
        const uploadBarWrap = document.getElementById('uploadBarWrap');
        const uploadBarFill = document.getElementById('uploadBarFill');
        const uploadStatus = document.getElementById('uploadStatus');
        const uploadPct = document.getElementById('uploadPct');

        if (uploadBarWrap) uploadBarWrap.style.display = 'block';
        const setProgress = (pct, label) => {
            if (uploadBarFill) uploadBarFill.style.width = pct + '%';
            if (uploadPct) uploadPct.textContent = pct + '%';
            if (uploadStatus) uploadStatus.textContent = label;
        };

        setProgress(5, 'Capturing thumbnail…');
        let thumbBlob = null;
        try { thumbBlob = await captureVideoThumbnail(videoFile); }
        catch (e) { console.warn('Thumbnail capture skipped:', e); }

        const telegramFileId = await uploadToTelegram(
            videoFile, title + '.mp4',
            pct => setProgress(5 + Math.round(pct * 0.7), 'Uploading video…') // 5-75%
        );

        let telegramThumbId = null;
        if (thumbBlob) {
            setProgress(80, 'Uploading thumbnail…');
            telegramThumbId = await uploadToTelegram(thumbBlob, title + '-thumb.jpg');
        }

        setProgress(95, 'Creating video record…');

        const videoRes = await adminRequest('/api/admin/videos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                telegram_file_id: telegramFileId,
                telegram_thumb_id: telegramThumbId,
                thumbnail_url: null,
                duration_seconds: Math.floor(videoFile.size / 250000), // Estimate
                price_euros: price,
                paywall_delay_seconds: paywall,
                category_id: categoryId,
                orientation,
                performer_ids: performerIds,
                tags,
                is_amateur: isAmateur,
                is_vr: isVr
            })
        });

        if (!videoRes.ok) {
            const err = await videoRes.json();
            throw new Error(err.error || 'Failed to create video');
        }

        setProgress(100, 'Done!');
        if (uploadBarWrap) uploadBarWrap.style.display = 'none';
        const msgDiv = document.getElementById('uploadMsg');
        if (msgDiv) {
            msgDiv.innerHTML = '✓ <strong>Video uploaded successfully!</strong><br><small>ID: ' + (await videoRes.json()).id + '</small>';
            msgDiv.style.color = '#4ade80';
        }

        // Clear form
        document.getElementById('upTitle').value = '';
        document.getElementById('videoFile').value = '';
        document.getElementById('upPrice').value = '';
        document.getElementById('upTags').value = '';
        document.querySelectorAll('.performer-check').forEach(el => el.checked = false);
        document.getElementById('upAmateur').checked = false;
        document.getElementById('upVr').checked = false;

        setTimeout(() => {
            adminNav('videos');
        }, 2000);
    } catch (err) {
        console.error('Video upload error:', err);
        const msgDiv = document.getElementById('uploadMsg');
        if (msgDiv) {
            msgDiv.textContent = '✗ Upload failed: ' + err.message;
            msgDiv.style.color = '#f87171';
        }
    }
}

async function submitGalleryUpload() {
    const title = document.getElementById('gTitle')?.value.trim();
    const galleryFiles = document.getElementById('galleryFiles')?.files;
    const categoryId = document.getElementById('gCategory')?.value || null;
    const orientation = document.getElementById('gOrientation')?.value || 'straight';
    const tags = (document.getElementById('gTags')?.value || '').split(',').map(t => t.trim()).filter(t => t);

    const performerIds = Array.from(document.querySelectorAll('.g-performer-check:checked')).map(el => el.value);

    if (!title) {
        alert('✗ Please enter a gallery title.');
        return;
    }
    if (!galleryFiles || galleryFiles.length === 0) {
        alert('✗ Please select at least one image.');
        return;
    }

    try {
        const gUploadBar = document.getElementById('gUploadBarWrap');
        const gUploadBarFill = document.getElementById('gUploadBarFill');
        const gUploadStatus = document.getElementById('gUploadStatus');
        const gUploadPct = document.getElementById('gUploadPct');

        if (gUploadBar) gUploadBar.style.display = 'block';
        const setProgress = (pct, label) => {
            if (gUploadBarFill) gUploadBarFill.style.width = pct + '%';
            if (gUploadPct) gUploadPct.textContent = pct + '%';
            if (gUploadStatus) gUploadStatus.textContent = label;
        };

        const files = Array.from(galleryFiles);
        const telegramFileIds = [];

        for (let i = 0; i < files.length; i++) {
            setProgress(
                Math.round((i / files.length) * 90),
                `Uploading image ${i + 1} of ${files.length}…`
            );
            const fileId = await uploadToTelegram(files[i], files[i].name || `image-${i}.jpg`);
            telegramFileIds.push(fileId);
        }

        setProgress(95, 'Creating gallery…');

        const galleryRes = await adminRequest('/api/admin/galleries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                category_id: categoryId,
                orientation,
                performer_ids: performerIds,
                tags,
                telegram_file_ids: telegramFileIds
            })
        });

        if (!galleryRes.ok) {
            const err = await galleryRes.json();
            throw new Error(err.error || 'Failed to create gallery');
        }

        setProgress(100, 'Done!');
        if (gUploadBar) gUploadBar.style.display = 'none';
        const msgDiv = document.getElementById('gUploadMsg');
        if (msgDiv) {
            msgDiv.innerHTML = '✓ <strong>Gallery uploaded successfully!</strong><br><small>Images: ' + galleryFiles.length + '</small>';
            msgDiv.style.color = '#4ade80';
        }

        // Clear form
        document.getElementById('gTitle').value = '';
        document.getElementById('galleryFiles').value = '';
        document.getElementById('gTags').value = '';
        document.getElementById('gPreviewGrid').innerHTML = '';
        document.querySelectorAll('.g-performer-check').forEach(el => el.checked = false);

        
        setTimeout(() => {
            adminNav('galleries');
        }, 2000);
    } catch (err) {
        console.error('Gallery upload error:', err);
        const msgDiv = document.getElementById('gUploadMsg');
        if (msgDiv) {
            msgDiv.textContent = '✗ Upload failed: ' + err.message;
            msgDiv.style.color = '#f87171';
        }
    }
}

async function submitAddCategory() {
    const name = document.getElementById('catName')?.value.trim();
    const slug = document.getElementById('catSlug')?.value.trim().toLowerCase().replace(/\s+/g, '-');
    const orientation = document.getElementById('catOrientation')?.value || 'straight';
    
    if (!name || !slug) {
        alert('✗ Please fill in both name and slug.');
        return;
    }
    
    try {
        const res = await adminRequest('/api/admin/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, slug, orientation })
        });
        
        if (!res.ok) {
            const err = await res.json();
            alert('✗ ' + (err.error || 'Failed to add category.'));
            return;
        }
        
        alert('✓ Category added successfully!');
        document.getElementById('catName').value = '';
        document.getElementById('catSlug').value = '';
        loadCategoriesTable();
        loadAdminCategories();
        loadGalleryCategories();
    } catch (err) {
        console.error('Add category error:', err);
        alert('✗ Error adding category: ' + err.message);
    }
}

async function submitAddPerformer() {
    const name = document.getElementById('creatorName')?.value.trim();
    const slug = document.getElementById('creatorSlug')?.value.trim().toLowerCase().replace(/\s+/g, '-');
    const gender = document.getElementById('creatorGender')?.value || null;
    const avatar = document.getElementById('creatorAvatar')?.value.trim() || null;
    const isVerified = document.getElementById('creatorVerified')?.checked || false;
    
    if (!name || !slug) {
        alert('✗ Please fill in both name and slug.');
        return;
    }
    
    try {
        const res = await adminRequest('/api/admin/performers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, slug, gender, avatar_url: avatar, is_verified: isVerified })
        });
        
        if (!res.ok) {
            const err = await res.json();
            alert('✗ ' + (err.error || 'Failed to add performer.'));
            return;
        }
        
        alert('✓ Performer added successfully!');
        document.getElementById('creatorName').value = '';
        document.getElementById('creatorSlug').value = '';
        document.getElementById('creatorGender').value = '';
        document.getElementById('creatorAvatar').value = '';
        document.getElementById('creatorVerified').checked = false;
        loadCreatorsTable();
        loadPerformers();
        loadGalleryPerformers();
    } catch (err) {
        console.error('Add performer error:', err);
        alert('✗ Error adding performer: ' + err.message);
    }
}

// ────── Events ───────────────────────────────────────────────────────

document.getElementById('adminLoginBtn')?.addEventListener('click', submitAdminLogin);
document.getElementById('adminPassword')?.addEventListener('keydown', e => { 
    if (e.key === 'Enter') submitAdminLogin(); 
});

document.querySelectorAll('.admin-nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => {
        adminNav(item.dataset.tab);
        if (item.dataset.tab === 'dashboard' || item.dataset.tab === 'payments') {
            startPaymentPolling();
        } else {
            stopPaymentPolling();
        }
    });
});

// Check if already logged in
if (ADMIN_SECRET) {
    showAdminPanel();
    startPaymentPolling();
}

// Clean up polling when leaving
window.addEventListener('beforeunload', stopPaymentPolling);
