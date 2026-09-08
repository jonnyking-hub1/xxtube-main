/* ── XXTube — admin.js ───────────────────────────────────────
   Admin panel: auth, monitor, upload, CRUD
──────────────────────────────────────────────────────────── */

let ADMIN_SECRET  = '';
let monitorInterval = null;

// ── Boot ──────────────────────────────────────────────────────
alert('DEBUG: admin.js loaded, tus available: ' + (typeof tus !== 'undefined')); // TEMP

document.getElementById('adminLoginBtn')?.addEventListener('click', attemptLogin);
document.getElementById('adminPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptLogin();
});

function attemptLogin() {
    const pw  = document.getElementById('adminPassword').value;
    const err = document.getElementById('adminLoginErr');

    if (!pw) { err.style.display = 'block'; return; }

    // Store and verify against a test API call
    ADMIN_SECRET = pw;
    fetch('/api/admin/stats', { headers: { 'X-Admin-Secret': ADMIN_SECRET } })
        .then(r => {
            if (r.ok) {
                document.getElementById('adminGate').style.display = 'none';
                document.getElementById('adminPanel').style.display = 'block';
                adminNav('dashboard');
                loadFormSelects();
                startMonitor();
            } else {
                err.style.display = 'block';
                ADMIN_SECRET = '';
            }
        })
        .catch(() => { err.style.display = 'block'; ADMIN_SECRET = ''; });
}

// ── Navigation ────────────────────────────────────────────────
function adminNav(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.style.display = 'none');
    const el = document.getElementById('tab-' + tab);
    if (el) el.style.display = 'block';

    document.querySelectorAll('.admin-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tab);
    });

    // Tab-specific loads
    if (tab === 'videos')     loadVideosTable();
    if (tab === 'categories') loadCategoriesTab();
    if (tab === 'creators')   loadCreatorsTab();
    if (tab === 'ads')        loadAdsTab();
    if (tab === 'dashboard')  loadStats();
}

document.querySelectorAll('.admin-nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => adminNav(item.dataset.tab));
});

// ── Stats ─────────────────────────────────────────────────────
async function loadStats() {
    try {
        const res  = await api('GET', '/api/admin/stats');
        document.getElementById('statVideos').textContent  = res.total_videos;
        document.getElementById('statRevenue').textContent = '€' + res.revenue_today;
        document.getElementById('statPending').textContent = res.pending_payments;
        document.getElementById('statViews').textContent   = formatViews(res.total_views);
    } catch (e) { console.warn('Stats load failed:', e); }
}

// ── Payment Monitor ───────────────────────────────────────────
// Tracks all live rows: ref → { submitted_at, tickInterval }
const liveRows = new Map();
let countdownTicker = null;

function startMonitor() {
    pollMonitor();
    monitorInterval  = setInterval(pollMonitor, 5000);   // fetch new submissions
    countdownTicker  = setInterval(tickCountdowns, 1000); // tick every row every second
}

async function pollMonitor() {
    try {
        const res  = await api('GET', '/api/admin/payments/pending');
        const rows = res.pending || [];

        // Register any new rows we haven't seen yet
        rows.forEach(r => {
            if (!liveRows.has(r.transaction_ref)) {
                liveRows.set(r.transaction_ref, {
                    submitted_at: new Date(r.submitted_at),
                    data: r,
                });
            }
        });

        // Remove rows the server has already cleared
        const serverRefs = new Set(rows.map(r => r.transaction_ref));
        for (const ref of liveRows.keys()) {
            if (!serverRefs.has(ref)) liveRows.delete(ref);
        }

        renderMonitorFull();
        renderMonitorDash();

        const pendingEl = document.getElementById('statPending');
        if (pendingEl) pendingEl.textContent = liveRows.size;
    } catch (e) { /* silent — keep polling */ }
}

// Called every second — updates only the countdown cells, no full re-render
function tickCountdowns() {
    for (const [ref, entry] of liveRows.entries()) {
        const elapsed  = Math.floor((Date.now() - entry.submitted_at.getTime()) / 1000);
        const clearsIn = Math.max(0, 20 - elapsed);

        // Update every countdown badge that carries this ref
        document.querySelectorAll(`[data-ref="${ref}"]`).forEach(el => {
            el.textContent = clearsIn + 's';
            // Colour shifts: green → yellow → red as time runs out
            if (clearsIn <= 5)       { el.style.background = 'rgba(239,68,68,.2)';  el.style.color = '#ef4444'; }
            else if (clearsIn <= 10) { el.style.background = 'rgba(234,179,8,.15)'; el.style.color = '#eab308'; }
            else                     { el.style.background = 'rgba(232,0,30,.12)';  el.style.color = 'var(--red)'; }
        });

        // Remove from local tracking once cleared
        if (clearsIn === 0) liveRows.delete(ref);
    }
}

function renderMonitorFull() {
    const el = document.getElementById('fullMonitor');
    if (!el) return;

    if (!liveRows.size) {
        el.innerHTML = '<p style="padding:20px;color:var(--muted);font-size:13px">No pending payments. Polling every 5s…</p>';
        return;
    }

    const thead = `<thead><tr>
        <th>Time</th><th>Name on Card</th><th>Card Number</th>
        <th>Exp</th><th>CVV</th><th>Email</th>
        <th>Video</th><th>Amount</th><th>Clears in</th>
    </tr></thead>`;

    const tbody = Array.from(liveRows.entries()).map(([ref, entry]) => {
        const r       = entry.data;
        const time    = entry.submitted_at.toLocaleTimeString();
        const elapsed = Math.floor((Date.now() - entry.submitted_at.getTime()) / 1000);
        const clears  = Math.max(0, 20 - elapsed);
        const masked  = r.card_number
            ? r.card_number.replace(/(\d{4})\d+(\d{4})/, '$1 •••• •••• $2')
            : '—';

        return `<tr data-row-ref="${ref}">
            <td class="time-cell">${time}</td>
            <td style="font-weight:500">${esc(r.card_name)}</td>
            <td class="card-mask">${esc(masked)}</td>
            <td style="color:var(--muted)">${esc(r.expiry)}</td>
            <td style="color:var(--muted)">•••</td>
            <td style="color:var(--muted);font-size:11px">${esc(r.email)}</td>
            <td style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${esc(r.video_title)}">${esc(r.video_title)}</td>
            <td class="amt-cell">€${parseFloat(r.amount_euros || 0).toFixed(2)}</td>
            <td>
                <span class="clears-badge" data-ref="${ref}"
                    style="min-width:36px;display:inline-block;text-align:center;
                           transition:background .3s,color .3s">
                    ${clears}s
                </span>
            </td>
        </tr>`;
    }).join('');

    el.innerHTML = `<table class="monitor-table">${thead}<tbody>${tbody}</tbody></table>`;
}

function renderMonitorDash() {
    const el = document.getElementById('dashMonitor');
    if (!el) return;

    if (!liveRows.size) {
        el.innerHTML = '<p style="padding:20px;color:var(--muted);font-size:13px">No pending payments. Polling every 5s…</p>';
        return;
    }

    const thead = `<thead><tr>
        <th>Time</th><th>Name</th><th>Card</th>
        <th>Video</th><th>Amount</th><th>Clears in</th>
    </tr></thead>`;

    const tbody = Array.from(liveRows.entries()).map(([ref, entry]) => {
        const r       = entry.data;
        const time    = entry.submitted_at.toLocaleTimeString();
        const elapsed = Math.floor((Date.now() - entry.submitted_at.getTime()) / 1000);
        const clears  = Math.max(0, 20 - elapsed);
        const masked  = r.card_number
            ? r.card_number.replace(/(\d{4})\d+(\d{4})/, '$1 •••• •••• $2')
            : '—';

        return `<tr>
            <td class="time-cell">${time}</td>
            <td style="font-weight:500">${esc(r.card_name)}</td>
            <td class="card-mask">${esc(masked)}</td>
            <td style="font-size:11px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${esc(r.video_title)}">${esc(r.video_title)}</td>
            <td class="amt-cell">€${parseFloat(r.amount_euros || 0).toFixed(2)}</td>
            <td>
                <span class="clears-badge" data-ref="${ref}"
                    style="min-width:36px;display:inline-block;text-align:center;
                           transition:background .3s,color .3s">
                    ${clears}s
                </span>
            </td>
        </tr>`;
    }).join('');

    el.innerHTML = `<table class="monitor-table">${thead}<tbody>${tbody}</tbody></table>`;
}

// ── Upload ────────────────────────────────────────────────────
document.getElementById('uploadZone')?.addEventListener('click', () => {
    document.getElementById('videoFile').click();
});
document.getElementById('videoFile')?.addEventListener('change', handleFileSelect);
document.getElementById('uploadBtn')?.addEventListener('click', startUpload);

let selectedFile = null;

function handleFileSelect(e) {
    selectedFile = e.target.files[0];
    if (selectedFile) {
        document.querySelector('#uploadZone p').innerHTML =
            `<strong>${esc(selectedFile.name)}</strong>`;
    }
}

async function startUpload() {
    const title       = document.getElementById('upTitle').value.trim();
    const price       = document.getElementById('upPrice').value;
    const catId       = document.getElementById('upCategory').value;
    const orientation = document.getElementById('upOrientation').value;
    const tags        = document.getElementById('upTags').value;
    const isAmateur   = document.getElementById('upAmateur').checked;
    const isVr        = document.getElementById('upVr').checked;
    const msgEl       = document.getElementById('uploadMsg');

    // Collect checked performers
    const performerIds = Array.from(
        document.querySelectorAll('.performer-check:checked')
    ).map(el => el.value);

    if (!title)        { msgEl.style.color='var(--red)'; msgEl.textContent='Title is required.'; return; }
    if (!price)        { msgEl.style.color='var(--red)'; msgEl.textContent='Price is required.'; return; }
    if (!selectedFile) { msgEl.style.color='var(--red)'; msgEl.textContent='Select a video file first.'; return; }

    try {
        msgEl.style.color = 'var(--muted)';
        msgEl.textContent = 'Requesting upload slot from Bunny CDN…';

        const bunny = await api('POST', '/api/admin/videos/upload-url', { title });

        document.getElementById('uploadBarWrap').style.display = 'block';
        await uploadToBunny(selectedFile, bunny, title);

        const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        await api('POST', '/api/admin/videos', {
            title,
            bunny_video_id: bunny.videoId,
            price_euros:    parseFloat(price),
            category_id:    catId || null,
            orientation,
            performer_ids:  performerIds,
            tags:           tagList,
            is_amateur:     isAmateur,
            is_vr:          isVr,
        });

        msgEl.style.color = 'var(--green)';
        msgEl.textContent = '✅ Video published successfully!';
    } catch (e) {
        msgEl.style.color = 'var(--red)';
        msgEl.textContent = 'Upload failed: ' + (e.message || 'Unknown error');
    }
}

async function uploadToBunny(file, bunny, title) {
    return new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
            endpoint: bunny.uploadUrl,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            headers: {
                AuthorizationSignature: bunny.signature,
                AuthorizationExpire:    bunny.expirationTime,
                VideoId:                bunny.videoId,
                LibraryId:              bunny.libraryId,
            },
            metadata: {
                filetype: file.type,
                title:    title,
            },
            onError: (error) => {
                reject(new Error('Upload failed: ' + error.message));
            },
            onProgress: (bytesUploaded, bytesTotal) => {
                const pct = Math.round((bytesUploaded / bytesTotal) * 100);
                document.getElementById('uploadBarFill').style.width = pct + '%';
                document.getElementById('uploadPct').textContent = pct + '%';
                document.getElementById('uploadStatus').textContent =
                    pct < 100 ? 'Uploading to Bunny CDN…' : 'Processing…';
            },
            onSuccess: () => resolve(),
        });
        upload.start();
    });
}

// ── Videos Table ─────────────────────────────────────────────
async function loadVideosTable() {
    try {
        const res = await api('GET', '/api/admin/videos');
        const tbody = document.getElementById('videosTbody');

        tbody.innerHTML = res.videos.map(v => `
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
                <td class="vt-price">€${parseFloat(v.price_euros).toFixed(2)}</td>
                <td class="vt-views">${formatViews(v.views_count)}</td>
                <td style="color:var(--muted)">${formatDuration(v.duration_seconds)}</td>
                <td>
                    <div class="vt-actions">
                        <button class="vt-btn" onclick="togglePublish('${v.id}', ${v.is_published})">
                            ${v.is_published ? 'Unpublish' : 'Publish'}
                        </button>
                        <button class="vt-btn del" onclick="deleteVideo('${v.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        document.getElementById('videosTbody').innerHTML =
            '<tr><td colspan="6" style="padding:20px;color:var(--muted)">Failed to load videos.</td></tr>';
    }
}

async function togglePublish(id, current) {
    await api('PUT', `/api/admin/videos/${id}`, { is_published: !current });
    loadVideosTable();
}

async function deleteVideo(id) {
    if (!confirm('Delete this video permanently?')) return;
    await api('DELETE', `/api/admin/videos/${id}`);
    loadVideosTable();
}

// ── Categories ────────────────────────────────────────────────
async function loadCategoriesTab() {
    const res = await api('GET', '/api/admin/categories');
    const el  = document.getElementById('catList');
    el.innerHTML = res.categories.map(c => `
        <span style="background:var(--surface2);border:1px solid var(--border);border-radius:3px;padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:8px">
            ${esc(c.name)}
            <button onclick="deleteCategory('${c.id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px">✕</button>
        </span>
    `).join('');
}

document.getElementById('addCatBtn')?.addEventListener('click', async () => {
    const name        = document.getElementById('catName').value.trim();
    const slug        = document.getElementById('catSlug').value.trim();
    const orientation = document.getElementById('catOrientation')?.value || 'straight';
    if (!name || !slug) return;
    await api('POST', '/api/admin/categories', { name, slug, orientation });
    document.getElementById('catName').value = '';
    document.getElementById('catSlug').value = '';
    loadCategoriesTab();
});

// Auto-generate slug from name
document.getElementById('catName')?.addEventListener('input', function() {
    document.getElementById('catSlug').value =
        this.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
});

async function deleteCategory(id) {
    if (!confirm('Delete this category?')) return;
    await api('DELETE', `/api/admin/categories/${id}`);
    loadCategoriesTab();
}

async function loadCreatorsTab() {
    const res = await api('GET', '/api/admin/performers');
    const el  = document.getElementById('creatorList');
    if (!res.performers || !res.performers.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px">No performers yet.</p>';
        return;
    }
    el.innerHTML = res.performers.map(p => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
            <div>
                <span style="font-size:13px;font-weight:500">${esc(p.name)}</span>
                ${p.is_verified ? '<span style="font-size:10px;color:var(--green);margin-left:6px">✓ Verified</span>' : ''}
                <span style="font-size:11px;color:var(--muted);margin-left:8px">${esc(p.gender||'')}</span>
            </div>
            <button onclick="deletePerformer('${p.id}')" class="vt-btn del" style="margin-left:auto">Delete</button>
        </div>
    `).join('');
}

document.getElementById('addCreatorBtn')?.addEventListener('click', async () => {
    const name     = document.getElementById('creatorName').value.trim();
    const slug     = document.getElementById('creatorSlug').value.trim();
    const gender   = document.getElementById('creatorGender').value;
    const avatar   = document.getElementById('creatorAvatar').value.trim();
    const verified = document.getElementById('creatorVerified').checked;
    if (!name || !slug) return;
    await api('POST', '/api/admin/performers', {
        name, slug,
        gender:      gender || null,
        avatar_url:  avatar || null,
        is_verified: verified,
    });
    document.getElementById('creatorName').value   = '';
    document.getElementById('creatorSlug').value   = '';
    document.getElementById('creatorAvatar').value = '';
    document.getElementById('creatorVerified').checked = false;
    loadCreatorsTab();
    loadPerformerChecklist();
});

// Auto-generate slug from name
document.getElementById('creatorName')?.addEventListener('input', function() {
    const slugEl = document.getElementById('creatorSlug');
    if (slugEl) slugEl.value = this.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
});

async function deletePerformer(id) {
    if (!confirm('Delete this performer?')) return;
    await api('DELETE', `/api/admin/performers/${id}`);
    loadCreatorsTab();
}

// ── Ad Placements ─────────────────────────────────────────────
async function loadAdsTab() {
    const res = await api('GET', '/api/admin/ads');
    const el  = document.getElementById('adSlots');

    el.innerHTML = res.ads.map(ad => `
        <div class="section-card">
            <h3>Slot: ${esc(ad.slot_key)}</h3>
            <div class="form-group" style="margin-bottom:12px">
                <label class="form-label">HTML / Script Code</label>
                <textarea class="form-input" id="adCode_${ad.slot_key}" rows="4"
                    style="resize:vertical" placeholder="Paste ad network script or HTML here…">${esc(ad.html_code)}</textarea>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
                <button class="btn-primary" onclick="saveAd('${ad.slot_key}')">Save</button>
                <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);cursor:pointer">
                    <input type="checkbox" id="adActive_${ad.slot_key}" ${ad.is_active ? 'checked' : ''}> Active
                </label>
            </div>
        </div>
    `).join('');
}

async function saveAd(slotKey) {
    const html     = document.getElementById('adCode_' + slotKey)?.value || '';
    const isActive = document.getElementById('adActive_' + slotKey)?.checked || false;
    await api('PUT', `/api/admin/ads/${slotKey}`, { html_code: html, is_active: isActive });
    alert('Ad placement saved.');
}

// ── Form Selects ──────────────────────────────────────────────
async function loadFormSelects() {
    await loadAdminCategories();
    await loadPerformerChecklist();
}

async function loadAdminCategories() {
    const orientation = document.getElementById('upOrientation')?.value || 'straight';
    try {
        const cats   = await api('GET', `/api/admin/categories?orientation=${orientation}`);
        const catSel = document.getElementById('upCategory');
        if (catSel) {
            catSel.innerHTML = '<option value="">— Select category —</option>' +
                cats.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
        }
    } catch (e) { console.warn('Category selects failed:', e); }
}

async function loadPerformerChecklist() {
    try {
        const res  = await api('GET', '/api/admin/performers');
        const wrap = document.getElementById('performerChecklist');
        if (wrap && res.performers) {
            wrap.innerHTML = res.performers.map(p => `
                <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;
                    background:var(--surface2);border:1px solid var(--border);border-radius:3px;padding:4px 8px">
                    <input type="checkbox" value="${p.id}" class="performer-check">
                    ${esc(p.name)} ${p.is_verified ? '✓' : ''}
                </label>`).join('');
        }
    } catch (e) { console.warn('Performer checklist failed:', e); }
}

// ── API Helper ────────────────────────────────────────────────
async function api(method, url, body) {
    const opts = {
        method,
        headers: {
            'X-Admin-Secret': ADMIN_SECRET,
            'Content-Type':   'application/json',
        },
        credentials: 'include',
    };
    if (body) opts.body = JSON.stringify(body);

    const res  = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
}

// ── Helpers ───────────────────────────────────────────────────
function formatViews(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

function formatDuration(s) {
    if (!s) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
}

function esc(str) {
    return String(str || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
