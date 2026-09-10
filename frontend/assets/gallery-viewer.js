/* ── XXTube — gallery-viewer.js ──────────────────────────────
   Single gallery detail page + lightbox image viewer
──────────────────────────────────────────────────────────── */

const galleryId = new URLSearchParams(window.location.search).get('id');
let galleryImages = [];
let lightboxIndex  = 0;

(async function init() {
    if (!galleryId) {
        document.getElementById('galleryTitle').textContent = 'Gallery not found.';
        return;
    }
    await loadGallery();
    bindLightbox();
})();

async function loadGallery() {
    try {
        const res  = await fetch(`/api/galleries/${galleryId}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        const g    = data.gallery;

        document.title = `${g.title} — XXTube`;
        document.getElementById('galleryTitle').textContent = g.title;
        document.getElementById('galleryMeta').textContent =
            `${g.images.length} photos · ${formatViews(g.views_count)} views · ${g.category_name || ''}`;

        if (g.performers && g.performers.length) {
            document.getElementById('galleryPerformers').innerHTML = g.performers.map(p =>
                `<span class="performer-badge">${escHtml(p.name)}</span>`
            ).join(' ');
        }

        galleryImages = g.images;
        renderImageGrid();
    } catch (e) {
        document.getElementById('galleryTitle').textContent = 'Gallery not found.';
    }
}

function renderImageGrid() {
    const grid = document.getElementById('imageGrid');
    grid.innerHTML = galleryImages.map((img, i) => `
        <div class="gallery-thumb" onclick="openLightbox(${i})">
            <img src="${img.image_url}" alt="Photo ${i+1}" loading="${i < 4 ? 'eager' : 'lazy'}">
        </div>`).join('');
}

function openLightbox(index) {
    lightboxIndex = index;
    updateLightbox();
    document.getElementById('lightbox').classList.add('open');
}

function updateLightbox() {
    document.getElementById('lightboxImg').src = galleryImages[lightboxIndex].image_url;
    document.getElementById('lightboxCounter').textContent =
        `${lightboxIndex + 1} / ${galleryImages.length}`;
}

function bindLightbox() {
    document.getElementById('lightboxClose')?.addEventListener('click', closeLightbox);
    document.getElementById('lightboxPrev')?.addEventListener('click', () => navLightbox(-1));
    document.getElementById('lightboxNext')?.addEventListener('click', () => navLightbox(1));
    document.getElementById('lightbox')?.addEventListener('click', e => {
        if (e.target.id === 'lightbox') closeLightbox();
    });
    document.addEventListener('keydown', e => {
        if (!document.getElementById('lightbox').classList.contains('open')) return;
        if (e.key === 'Escape')     closeLightbox();
        if (e.key === 'ArrowLeft')  navLightbox(-1);
        if (e.key === 'ArrowRight') navLightbox(1);
    });
}

function navLightbox(dir) {
    lightboxIndex = (lightboxIndex + dir + galleryImages.length) % galleryImages.length;
    updateLightbox();
}

function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
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