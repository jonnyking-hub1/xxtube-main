const express = require('express');
const router = express.Router();
const { getDemoVideos, getDemoVideoById, getDemoStreamUrl } = require('../services/demoData');
const { getTelegramFileUrl } = require('../services/telegram');
const { requireSession } = require('../middleware/auth');
const db = require('../db/pool');

function withSignedThumbnail(row) {
    if (row && row.telegram_thumb_id) {
        row.thumbnail_url = `/api/videos/${row.id}/thumb`;
    }
    return row;
}

function isDemoMode() {
    return !process.env.DATABASE_URL || process.env.DEMO_MODE === 'true';
}

router.get('/', async (req, res) => {
    try {
        if (isDemoMode()) {
            const videos = getDemoVideos();
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const search = (req.query.search || '').toLowerCase();
            const orientation = req.query.orientation || 'straight';
            const category = req.query.category || null;

            let filtered = videos.filter((video) => {
                const matchesOrientation = !orientation || video.orientation === orientation;
                const matchesCategory = !category || video.category_slug === category;
                const matchesSearch = !search || video.title.toLowerCase().includes(search) || video.tags.some((tag) => tag.toLowerCase().includes(search));
                return matchesOrientation && matchesCategory && matchesSearch;
            });

            const pageSize = 15;
            const start = (page - 1) * pageSize;
            const paged = filtered.slice(start, start + pageSize);

            return res.json({
                videos: paged.map(withSignedThumbnail),
                page,
                total: filtered.length,
                totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
            });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const search = req.query.search || null;
        const category = req.query.category || null;
        const orientation = req.query.orientation || null;
        const tag = req.query.tag || null;
        const performer = req.query.performer || null;
        const offset = (page - 1) * 15;

        const conditions = ['v.is_published = TRUE'];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            const i = params.length;
            conditions.push(`(
                v.title ILIKE $${i}
                OR EXISTS (SELECT 1 FROM video_tags vt2 WHERE vt2.video_id = v.id AND vt2.tag_name ILIKE $${i})
                OR c.name ILIKE $${i}
            )`);
        }

        if (orientation) {
            params.push(orientation);
            conditions.push(`v.orientation = $${params.length}`);
        }

        if (category) {
            params.push(category);
            conditions.push(`c.slug = $${params.length}`);
        }

        if (tag) {
            params.push(tag);
            conditions.push(`EXISTS (
                SELECT 1 FROM video_tags vt3
                WHERE vt3.video_id = v.id AND vt3.tag_name ILIKE $${params.length}
            )`);
        }

        if (performer) {
            params.push(performer);
            conditions.push(`EXISTS (
                SELECT 1 FROM video_performers vp
                JOIN performers p ON p.id = vp.performer_id
                WHERE vp.video_id = v.id AND p.slug = $${params.length}
            )`);
        }

        const where = 'WHERE ' + conditions.join(' AND ');

        const countResult = await db.query(
            `SELECT COUNT(DISTINCT v.id)
             FROM videos v
             LEFT JOIN categories c ON v.category_id = c.id
             LEFT JOIN video_tags vt ON vt.video_id = v.id
             ${where}`,
            params
        );

        const total = parseInt(countResult.rows[0].count);
        params.push(15, offset);

        const result = await db.query(
            `SELECT DISTINCT
                v.id, v.title, v.thumbnail_url, v.preview_animation_url,
                v.bunny_video_id, v.telegram_file_id, v.telegram_thumb_id,
                v.duration_seconds, v.price_euros, v.views_count,
                v.likes_count, v.dislikes_count, v.orientation,
                v.is_amateur, v.is_vr, v.created_at,
                c.name  AS category_name,
                c.slug  AS category_slug,
                COALESCE(
                    (SELECT jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug))
                     FROM video_performers vp JOIN performers p ON p.id = vp.performer_id
                     WHERE vp.video_id = v.id), '[]'
                ) AS performers,
                COALESCE(
                    (SELECT array_agg(DISTINCT vt4.tag_name)
                     FROM video_tags vt4 WHERE vt4.video_id = v.id), '{}'
                ) AS tags
             FROM videos v
             LEFT JOIN categories c   ON v.category_id = c.id
             LEFT JOIN video_tags vt  ON vt.video_id = v.id
             ${where}
             ORDER BY v.created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({
            videos: result.rows.map(withSignedThumbnail),
            page,
            total,
            totalPages: Math.ceil(total / 15),
        });
    } catch (err) {
        console.error('Videos list error:', err);

        const videos = getDemoVideos();
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const search = (req.query.search || '').toLowerCase();
        const category = req.query.category || null;
        const orientation = req.query.orientation || 'straight';

        let filtered = videos.filter((video) => {
            const matchesOrientation = !orientation || video.orientation === orientation;
            const matchesCategory = !category || video.category_slug === category;
            const matchesSearch = !search || video.title.toLowerCase().includes(search) || video.tags.some((tag) => tag.toLowerCase().includes(search));
            return matchesOrientation && matchesCategory && matchesSearch;
        });

        const pageSize = 15;
        const start = (page - 1) * pageSize;
        const paged = filtered.slice(start, start + pageSize);

        res.json({
            videos: paged.map(withSignedThumbnail),
            page,
            total: filtered.length,
            totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        if (isDemoMode()) {
            const video = getDemoVideoById(req.params.id);
            if (!video) return res.status(404).json({ error: 'Video not found.' });
            return res.json({ video: { ...video, thumbnail_url: video.thumbnail_url || getDemoStreamUrl() } });
        }

        const result = await db.query(
            `SELECT
                v.*, c.name AS category_name, c.slug AS category_slug,
                COALESCE(
                    (SELECT jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug))
                     FROM video_performers vp JOIN performers p ON p.id = vp.performer_id
                     WHERE vp.video_id = v.id), '[]'
                ) AS performers,
                COALESCE(
                    (SELECT array_agg(DISTINCT vt.tag_name)
                     FROM video_tags vt WHERE vt.video_id = v.id), '{}'
                ) AS tags
             FROM videos v
             LEFT JOIN categories c ON v.category_id = c.id
             WHERE v.id = $1 AND v.is_published = TRUE`,
            [req.params.id]
        );

        if (!result.rows.length) {
            const fallback = getDemoVideoById(req.params.id);
            if (!fallback) return res.status(404).json({ error: 'Video not found.' });
            return res.json({ video: fallback });
        }

        db.query('UPDATE videos SET views_count = views_count + 1 WHERE id = $1', [req.params.id]).catch(() => {});

        res.json({ video: withSignedThumbnail(result.rows[0]) });
    } catch (err) {
        console.error('Video fetch error:', err);
        const fallback = getDemoVideoById(req.params.id);
        if (!fallback) return res.status(404).json({ error: 'Video not found.' });
        res.json({ video: fallback });
    }
});

router.get('/:id/stream', requireSession, async (req, res) => {
    try {
        if (isDemoMode()) {
            return res.json({ stream_url: getDemoStreamUrl() });
        }

        const result = await db.query(
            'SELECT telegram_file_id FROM videos WHERE id = $1 AND is_published = TRUE',
            [req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Video not found.' });
        }

        if (!result.rows[0].telegram_file_id) {
            return res.json({ stream_url: getDemoStreamUrl() });
        }

        res.json({ stream_url: `/api/videos/${req.params.id}/raw` });
    } catch (err) {
        console.error('Stream URL error:', err);
        res.json({ stream_url: getDemoStreamUrl() });
    }
});

router.get('/:id/raw', requireSession, async (req, res) => {
    try {
        if (isDemoMode()) {
            const streamUrl = getDemoStreamUrl();
            const upstream = await fetch(streamUrl);
            if (!upstream.ok) return res.status(502).end();

            res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
            const reader = upstream.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
            return;
        }

        const result = await db.query(
            'SELECT telegram_file_id FROM videos WHERE id = $1 AND is_published = TRUE',
            [req.params.id]
        );
        if (!result.rows.length || !result.rows[0].telegram_file_id) {
            return res.status(404).end();
        }

        const fileUrl = await getTelegramFileUrl(result.rows[0].telegram_file_id);
        const range = req.headers.range;
        const upstreamHeaders = range ? { Range: range } : {};
        const upstream = await fetch(fileUrl, { headers: upstreamHeaders });

        if (!upstream.ok && upstream.status !== 206) {
            return res.status(502).end();
        }

        res.status(upstream.status === 206 ? 206 : 200);
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        if (upstream.headers.get('content-length')) {
            res.setHeader('Content-Length', upstream.headers.get('content-length'));
        }
        if (upstream.headers.get('content-range')) {
            res.setHeader('Content-Range', upstream.headers.get('content-range'));
        }

        const reader = upstream.body.getReader();
        req.on('close', () => reader.cancel().catch(() => {}));

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
        }
        res.end();
    } catch (err) {
        console.error('Video relay error:', err);
        if (!res.headersSent) res.status(500).end();
    }
});

router.get('/:id/thumb', async (req, res) => {
    try {
        if (isDemoMode()) {
            const fallback = 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80';
            const upstream = await fetch(fallback);
            if (!upstream.ok) return res.status(502).end();
            res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            const reader = upstream.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
            return;
        }

        const result = await db.query(
            'SELECT telegram_thumb_id FROM videos WHERE id = $1',
            [req.params.id]
        );
        if (!result.rows.length || !result.rows[0].telegram_thumb_id) {
            return res.status(404).end();
        }

        const fileUrl = await getTelegramFileUrl(result.rows[0].telegram_thumb_id);
        const upstream = await fetch(fileUrl);
        if (!upstream.ok) return res.status(502).end();

        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        const reader = upstream.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
        }
        res.end();
    } catch (err) {
        console.error('Thumbnail relay error:', err);
        if (!res.headersSent) res.status(500).end();
    }
});

module.exports = router;
