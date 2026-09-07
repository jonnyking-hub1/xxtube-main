/* ── XXTube — app.js ─────────────────────────────────────────
   Home grid, orientation switcher, search, pagination, drawer
──────────────────────────────────────────────────────────── */

let currentPage        = 1;
let currentCategory    = '';
let currentSearch      = '';
let currentOrientation = 'straight';
let searchTimer        = null;

// ── Boot ──────────────────────────────────────────────────────
(async function init() {
    checkAgeGate();
    await initSession();
    loadCategories();
    loadPerformers();
    loadVideos(1);
    bindEvents();
})();

// ── Age Gate ──────────────────────────────────────────────────
function checkAgeGate() {
    if (!localStorage.getItem('xx_terms_verified')) {
        document.getElementById('age-gate').style.display = 'flex';
    } else {
        document.getElementById('age-gate').style.display = 'none';
    }
}

function bindEvents() {
    document.getElementById('ageConfirmBtn')?.addEventListener('click', () => {
        localStorage.setItem('xx_terms_verified', '1');
        document.cookie = 'xx_terms=1; max-age=' + (30*24*60*60) + '; path=/; SameSite=Strict';
        document.getElementById('age-gate').style.display = 'none';
    });

    // Drawer
    document.getElementById('menuBtn')?.addEventListener('click', openDrawer);
    document.getElementById('drawerClose')?.addEventListener('click', closeDrawer);
    document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);

    // Orientation — top bar
    document.querySelectorAll('.orient-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.orient-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentOrientation = btn.dataset.orientation;
            currentCategory    = '';
            loadCategories();
            loadVideos(1);
        });
    });

    // Orientation — drawer
    document.querySelectorAll('[data-orientation]').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('[data-orientation]').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentOrientation = item.dataset.orientation;
            // sync top bar
            document.querySelectorAll('.orient-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.orientation === currentOrientation);
            });
            currentCategory = '';
            loadCategories();
            loadVideos(1);
            closeDrawer();
        });
    });

    // Search
    document.getElementById('searchInput')?.addEventListener('input', e => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            currentSearch = e.target.value.trim();
            loadVideos(1);
        }, 400);
    });

    // Filter pills
    document.getElementById('filterStrip')?.addEventListener('click', e => {
        const pill = e.target.closest('.fpill');
        if (!pill) return;
        document.querySelectorAll('.fpill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentCategory = pill.dataset.cat || '';
        loadVideos(1);
    });

    // Recover modal
    document.getElementById('recoverBtn')?.addEventListener('click', () => {
        document.getElementById('recoverModal').classList.add('open');
    });
    document.getElementById('recoverCancel')?.addEventListener('click', () => {
        document.getElementById('recoverModal').classList.remove('open');
    });
    document.getElementById('recoverSubmit')?.addEventListener('click', submitRecover);
}

// ── Session ───────────────────────────────────────────────────
async function initSession() {
    try {
        await fetch('/api/sessions/init', { method: 'POST', credentials: 'include' });
    } catch (e) { console.warn('Session init failed:', e); }
}

// ── Load Videos ───────────────────────────────────────────────
async function loadVideos(page) {
    currentPage = page;
    const grid  = document.getElementById('videoGrid');
    const label = document.getElementById('gridLabel');
    grid.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:20px 0">Loading…</p>';

    const params = new URLSearchParams({ page, orientation: currentOrientation });
    if (currentSearch)   params.set('search',   currentSearch);
    if (currentCategory) params.set('category', currentCategory);

    try {
        const res  = await fetch(`/api/videos?${params}`);
        const data = await res.json();
        label.innerHTML = `<strong>${data.total}</strong> videos — Page ${data.page} of ${data.totalPages}`;
        renderGrid(data.videos);
        renderPagination(data.page, data.totalPages);
    } catch (e) {
        grid.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:20px 0">Failed to load videos.</p>';
    }
}

// ── Render Grid ───────────────────────────────────────────────
function renderGrid(videos) {
    const grid = document.getElementById('videoGrid');
    if (!videos || !videos.length) {
        grid.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:20px 0">No videos found.</p>';
        return;
    }

    grid.innerHTML = videos.map((v, i) => {
        const performers = v.performers && v.performers.length
            ? v.performers.map(p => `<span class="performer-badge">${escHtml(p.name)}</span>`).join('')
            : '';
        const price = parseFloat(v.price_euros) === 0
            ? `<span class="vbadge vbadge-free">FREE</span>`
            : `<span class="vbadge vbadge-price">€${parseFloat(v.price_euros).toFixed(2)}</span>`;
        const vrBadge      = v.is_vr     ? `<span class="vbadge vbadge-vr">VR</span>`         : '';
        const amateurBadge = v.is_amateur ? `<span class="vbadge vbadge-amateur">Amateur</span>` : '';
        const thumb        = v.thumbnail_url || '';

        return `
        <div class="vcard" onclick="window.location='/watch.html?id=${v.id}'">
          <div class="vthumb">
            ${thumb ? `<img src="${thumb}" alt="${escHtml(v.title)}" loading="${i < 6 ? 'eager' : 'lazy'}">` : ''}
            <div class="vthumb-overlay"></div>
            <div class="vplay">
              <div class="vplay-circle">
                <svg viewBox="0 0 10 10"><polygon points="2,1 9,5 2,9"/></svg>
              </div>
            </div>
            <div class="vbadges">
              <div style="display:flex;gap:3px">${vrBadge}${amateurBadge}</div>
              <div style="display:flex;gap:3px">
                <span class="vbadge vbadge-dur">${formatDuration(v.duration_seconds)}</span>
                ${price}
              </div>
            </div>
          </div>
          <div class="vcard-info">
            <p class="vtitle">${escHtml(v.title)}</p>
            ${performers ? `<div class="performer-badges">${performers}</div>` : ''}
            <div class="vmeta">
              <span class="vcreator">${escHtml(v.category_name || '')}</span>
              <span class="vdivider"></span>
              <span class="vviews">${formatViews(v.views_count)} views</span>
            </div>
          </div>
        </div>`;
    }).join('');
}

// ── Pagination ────────────────────────────────────────────────
function renderPagination(page, totalPages) {
    const pg = document.getElementById('pagination');
    if (totalPages <= 1) { pg.innerHTML = ''; return; }

    let html = `<button class="pgbtn" onclick="loadVideos(${page-1})" ${page===1?'disabled':''}>‹</button>`;
    const range = pageRange(page, totalPages);
    let prev = null;
    for (const p of range) {
        if (prev !== null && p - prev > 1) html += `<span style="color:var(--subtle);padding:0 4px">…</span>`;
        html += `<button class="pgbtn ${p===page?'active':''}" onclick="loadVideos(${p})">${p}</button>`;
        prev = p;
    }
    html += `<button class="pgbtn" onclick="loadVideos(${page+1})" ${page===totalPages?'disabled':''}>›</button>`;
    pg.innerHTML = html;
}

function pageRange(current, total) {
    const delta = 2;
    const pages = new Set([1, total]);
    for (let i = Math.max(2, current-delta); i <= Math.min(total-1, current+delta); i++) pages.add(i);
    return Array.from(pages).sort((a,b) => a-b);
}

// ── Categories ────────────────────────────────────────────────
async function loadCategories() {
    try {
        const res  = await fetch(`/api/categories?orientation=${currentOrientation}`);
        const data = await res.json();

        // Drawer
        const drawerCats = document.getElementById('drawerCategories');
        if (drawerCats) {
            drawerCats.innerHTML = data.categories.map(c => `
                <div class="d-item" onclick="filterByCategory('${c.slug}')">
                    ${escHtml(c.name)} <span class="d-ct">${c.video_count}</span>
                </div>`).join('');
        }

        // Filter pills — reset then add
        const strip = document.getElementById('filterStrip');
        if (strip) {
            strip.innerHTML = `<button class="fpill active" data-cat="">All</button>` +
                data.categories.map(c =>
                    `<button class="fpill" data-cat="${c.slug}">${escHtml(c.name)}</button>`
                ).join('');
        }
    } catch (e) { console.warn('Categories load failed:', e); }
}

async function loadPerformers() {
    try {
        const res  = await fetch('/api/performers');
        const data = await res.json();
        const el   = document.getElementById('drawerPerformers');
        if (el && data.performers) {
            el.innerHTML = data.performers.slice(0, 20).map(p => `
                <div class="d-item" onclick="filterByPerformer('${p.slug}')">
                    ${escHtml(p.name)}
                    ${p.is_verified ? '✓' : ''}
                    <span class="d-ct">${p.video_count}</span>
                </div>`).join('');
        }
    } catch (e) { console.warn('Performers load failed:', e); }
}

function filterByCategory(slug) {
    currentCategory = slug;
    closeDrawer();
    loadVideos(1);
}

function filterByPerformer(slug) {
    closeDrawer();
    const params = new URLSearchParams({ performer: slug, orientation: currentOrientation });
    fetch(`/api/videos?${params}`).then(r => r.json()).then(data => {
        document.getElementById('gridLabel').innerHTML =
            `<strong>${data.total}</strong> videos featuring this performer`;
        renderGrid(data.videos);
        renderPagination(data.page, data.totalPages);
    });
}

// ── Drawer ────────────────────────────────────────────────────
function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawerOverlay').classList.add('open');
}
function closeDrawer() {
    document.getElementById('drawer')?.classList.remove('open');
    document.getElementById('drawerOverlay')?.classList.remove('open');
}

// ── Recovery ──────────────────────────────────────────────────
async function submitRecover() {
    const email = document.getElementById('recoverEmail')?.value.trim();
    const ref   = document.getElementById('recoverRef')?.value.trim();
    const msg   = document.getElementById('recoverMsg');
    if (!email && !ref) { msg.textContent = 'Enter your email or transaction reference.'; return; }
    msg.style.color = 'var(--muted)';
    msg.textContent = 'Searching…';
    try {
        const res  = await fetch('/api/payments/recover', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email||null, transaction_ref: ref||null }),
        });
        const data = await res.json();
        if (res.ok) {
            msg.style.color = 'var(--green)';
            msg.textContent = `✅ Access restored for ${data.videos_restored} video(s).`;
        } else {
            msg.style.color = 'var(--red)';
            msg.textContent = data.error || 'No active session found.';
        }
    } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Request failed. Please try again.';
    }
}

// ── Helpers ───────────────────────────────────────────────────
function formatDuration(s) {
    if (!s) return '—';
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
}
function formatViews(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M';
    if (n >= 1_000)     return (n/1_000).toFixed(1)+'K';
    return String(n);
}
function escHtml(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
