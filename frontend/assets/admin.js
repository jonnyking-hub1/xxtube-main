// Force the browser to fetch fresh video data instead of reusing stale cached API responses.
async function loadVideosTable() {
    try {
        const res = await fetch('/api/admin/videos', {
            method: 'GET',
            headers: { 'X-Admin-Secret': ADMIN_SECRET, 'Content-Type': 'application/json' },
            credentials: 'include',
            cache: 'no-store'
        });
        const data = await res.json();
        const tbody = document.getElementById('videosTbody');

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
            '<tr><td colspan="5" style="padding:20px;color:var(--muted)">Failed to load videos.</td></tr>';
    }
}
