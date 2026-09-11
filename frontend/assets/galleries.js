/* ── XXTube — galleries.js ───────────────────────────────────
   Gallery grid, orientation switcher, search, pagination
──────────────────────────────────────────────────────────── */

let currentPage        = 1;
let currentCategory    = '';
let currentSearch      = '';
let currentOrientation = 'straight';
let searchTimer        = null;

(async function init() {
    checkAgeGate();
    loadCategories();
    loadGalleries(1);
    bindEvents();
})();

function checkAgeGate() {
    document.getElementById('age-gate').style.display =
        localStorage.getItem('xx_terms_verified') ? 'none' : 'flex';
}

function bindEvents() {
    document.getElementById('ageConfirmBtn')?.addEventListener('click', () => {
        localStorage.setItem('xx_terms_verified', '1');
        document.getElementById('age-gate').style.display = 'none';
    });

    document.getElementById('menuBtn')?.addEventListener('click', openDrawer);
    document.getElementById('drawerClose')?.addEventListener('click', closeDrawer);
    document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);

    document.querySelectorAll('.orient-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.orient-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentOrientation = btn.dataset.orientation;
            currentCategory    = '';
            loadCategories();
            loadGalleries(1);
        });
    });

    document.querySelectorAll('[data-orientation]').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('[data-orientation]').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentOrientation = item.dataset.orientation;
            document.querySelectorAll('.orient-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.orientation === currentOrientation);
            });
            currentCategory = '';
            loadCategories();
            loadGalleries(1);
            closeDrawer();
        });
    });

    document.getElementById('filterStrip')?.addEventListener('click', e => {
        const pill = e.target.closest('.fpill');
        if (!pill) return;
        document.querySelectorAll('.fpill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentCategory = pill.dataset.cat || '';
        loadGalleries(1);
    });
}

async function loadGalleries(page) {
    currentPage = page;
    const grid  = document.getElementById('galleryGrid');
    const label = document.getElementById('gridLabel');
    grid.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:20px 0">Loading…</p>';

    const params = new URLSearchParams({ page, orientation: currentOrientation });
    if (currentCategory) params.set('category', currentCategory);

    try {
        const res  = await fetch(`/api/galleries?${params}`);
        const data = await res.json();
        label.innerHTML = `<strong>${data.total}</strong> galleries — Page ${data.page} of ${data.totalPages || 1}`;
        renderGrid(data.galleries);
        renderPagination(data.page, data.totalPages);
    } catch (e) {
        grid.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:20px 0">Failed to load galleries.</p>';
    }
}

function renderGrid(galleries) {
    const grid = document.getElementById('galleryGrid');
    if (!galleries || !galleries.length) {
        grid.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:20px 0">No galleries found.</p>';
        return;
    }

    grid.innerHTML = galleries.map((g, i) => `
        <div class="vcard" onclick="window.location='/gallery.html?id=${g.id}'">
          <div class="vthumb">
            ${g.cover_url ? `<img src="${g.cover_url}" alt="${escHtml(g.title)}" loading="${i < 6 ? 'eager' : 'lazy'}">` : ''}
            <div class="vthumb-overlay"></div>
            <div class="vbadges">
              <div></div>
              <div style="display:flex;gap:3px">
                <span class="vbadge vbadge-dur">${g.image_count} photos</span>
              </div>
            </div>
          </div>
          <div class="vcard-info">
            <p class="vtitle">${escHtml(g.title)}</p>
            <div class="vmeta">
              <span class="vcreator">${escHtml(g.category_name || '')}</span>
              <span class="vdivider"></span>
              <span class="vviews">${formatViews(g.views_count)} views</span>
            </div>
          </div>
        </div>`).join('');
}

function renderPagination(page, totalPages) {
    const pg = document.getElementById('pagination');
    if (!totalPages || totalPages <= 1) { pg.innerHTML = ''; return; }

    let html = `<button class="pgbtn" onclick="loadGalleries(${page-1})" ${page===1?'disabled':''}>‹</button>`;
    const range = pageRange(page, totalPages);
    let prev = null;
    for (const p of range) {
        if (prev !== null && p - prev > 1) html += `<span style="color:var(--subtle);padding:0 4px">…</span>`;
        html += `<button class="pgbtn ${p===page?'active':''}" onclick="loadGalleries(${p})">${p}</button>`;
        prev = p;
    }
    html += `<button class="pgbtn" onclick="loadGalleries(${page+1})" ${page===totalPages?'disabled':''}>›</button>`;
    pg.innerHTML = html;
}

function pageRange(current, total) {
    const delta = 2;
    const pages = new Set([1, total]);
    for (let i = Math.max(2, current-delta); i <= Math.min(total-1, current+delta); i++) pages.add(i);
    return Array.from(pages).sort((a,b) => a-b);
}

async function loadCategories() {
    try {
        const res  = await fetch(`/api/categories?orientation=${currentOrientation}`);
        const data = await res.json();

        const drawerCats = document.getElementById('drawerCategories');
        if (drawerCats) {
            drawerCats.innerHTML = data.categories.map(c => `
                <div class="d-item" onclick="filterByCategory('${c.slug}')">
                    ${escHtml(c.name)}
                </div>`).join('');
        }

        const strip = document.getElementById('filterStrip');
        if (strip) {
            strip.innerHTML = `<button class="fpill active" data-cat="">All</button>` +
                data.categories.map(c =>
                    `<button class="fpill" data-cat="${c.slug}">${escHtml(c.name)}</button>`
                ).join('');
        }
    } catch (e) { console.warn('Categories load failed:', e); }
}

function filterByCategory(slug) {
    currentCategory = slug;
    closeDrawer();
    loadGalleries(1);
}

function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawerOverlay').classList.add('open');
}
function closeDrawer() {
    document.getElementById('drawer')?.classList.remove('open');
    document.getElementById('drawerOverlay')?.classList.remove('open');
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