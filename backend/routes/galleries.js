const express = require('express');
const router  = express.Router();
const { getTelegramFileUrl } = require('../services/telegram');
const db      = require('../db/pool');

/**
 * GET /api/galleries
 * Public paginated gallery list — free to view, no session/entitlement required.
 */
router.get('/', async (req, res) => {
    try {
        const page       = Math.max(1, parseInt(req.query.page) || 1);
        const offset      = (page - 1) * 15;
        const orientation = req.query.orientation || 'straight';
        const categoryId  = req.query.category || null;

        const whereParts = ['g.is_published = TRUE', 'g.orientation = $1'];
        const params      = [orientation];
        if (categoryId) {
            params.push(categoryId);
            whereParts.push(`g.category_id = $${params.length}`);
        }
        const whereClause = whereParts.join(' AND ');

        const result = await db.query(
            `SELECT g.id, g.title, g.cover_url, g.views_count, g.created_at, c.name AS category_name,
                (SELECT COUNT(*) FROM gallery_images gi WHERE gi.gallery_id = g.id) AS image_count,
                (SELECT gi.id FROM gallery_images gi WHERE gi.gallery_id = g.id AND gi.telegram_file_id IS NOT NULL
                 ORDER BY gi.sort_order ASC LIMIT 1) AS cover_image_id
             FROM galleries g
             LEFT JOIN categories c ON g.category_id = c.id
             WHERE ${whereClause}
             ORDER BY g.created_at DESC
             LIMIT 15 OFFSET $${params.length + 1}`,
            [...params, offset]
        );

        const countResult = await db.query(
            `SELECT COUNT(*) FROM galleries g WHERE ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        const galleries = result.rows.map(g => {
            if (g.cover_image_id) g.cover_url = `/api/galleries/image/${g.cover_image_id}`;
            delete g.cover_image_id;
            return g;
        });

        res.json({ galleries, page, total, totalPages: Math.ceil(total / 15) });
    } catch (err) {
        console.error('Galleries list error:', err);
        res.status(500).json({ error: 'Failed to fetch galleries.' });
    }
});

/**
 * GET /api/galleries/:id
 * Full gallery detail with all images, performers and tags.
 */
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT g.*, c.name AS category_name
             FROM galleries g
             LEFT JOIN categories c ON g.category_id = c.id
             WHERE g.id = $1 AND g.is_published = TRUE`,
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Gallery not found.' });

        const gallery = result.rows[0];

        const images = await db.query(
            'SELECT id, image_url, telegram_file_id, sort_order FROM gallery_images WHERE gallery_id = $1 ORDER BY sort_order ASC',
            [req.params.id]
        );
        gallery.images = images.rows.map(img => ({
            id: img.id,
            sort_order: img.sort_order,
            image_url: img.telegram_file_id ? `/api/galleries/image/${img.id}` : img.image_url,
        }));

        if (gallery.images.length) gallery.cover_url = gallery.images[0].image_url;

        const performers = await db.query(
            `SELECT p.id, p.name, p.slug FROM gallery_performers gp
             JOIN performers p ON p.id = gp.performer_id
             WHERE gp.gallery_id = $1`,
            [req.params.id]
        );
        gallery.performers = performers.rows;

        // Fire-and-forget view increment
        db.query('UPDATE galleries SET views_count = views_count + 1 WHERE id = $1', [req.params.id])
            .catch(err => console.error('Gallery view increment failed:', err));

        res.json({ gallery });
    } catch (err) {
        console.error('Gallery detail error:', err);
        res.status(500).json({ error: 'Failed to fetch gallery.' });
    }
});

/**
 * GET /api/galleries/image/:imageId
 * Public image relay — fetches the live file from Telegram server-side and
 * streams it back, so the browser never sees a Telegram URL (bot token embedded).
 */
router.get('/image/:imageId', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT telegram_file_id, image_url FROM gallery_images WHERE id = $1',
            [req.params.imageId]
        );
        if (!result.rows.length) return res.status(404).end();

        const row = result.rows[0];

        // Legacy rows without a Telegram file just redirect to their stored URL.
        if (!row.telegram_file_id) {
            if (!row.image_url) return res.status(404).end();
            return res.redirect(row.image_url);
        }

        const fileUrl = await getTelegramFileUrl(row.telegram_file_id);
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
        console.error('Gallery image relay error:', err);
        if (!res.headersSent) res.status(500).end();
    }
});

module.exports = router;
