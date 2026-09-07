const express = require('express');
const router  = express.Router();
const db      = require('../db/pool');

/**
 * GET /api/categories
 * Returns categories with video counts.
 * Filter by ?orientation=straight|gay|trans
 */
router.get('/', async (req, res) => {
    try {
        const orientation = req.query.orientation || null;
        const params = [];
        let where = '';

        if (orientation) {
            params.push(orientation);
            where = 'WHERE c.orientation = $1';
        }

        const result = await db.query(
            `SELECT c.*, COUNT(v.id) AS video_count
             FROM categories c
             LEFT JOIN videos v ON v.category_id = c.id AND v.is_published = TRUE
             ${where}
             GROUP BY c.id
             ORDER BY c.name`,
            params
        );
        res.json({ categories: result.rows });
    } catch (err) {
        console.error('Categories error:', err);
        res.status(500).json({ error: 'Failed to fetch categories.' });
    }
});

/**
 * GET /api/performers
 * Returns all performers with video counts.
 */
router.get('/performers', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT p.*, COUNT(vp.video_id) AS video_count
             FROM performers p
             LEFT JOIN video_performers vp ON vp.performer_id = p.id
             GROUP BY p.id
             ORDER BY p.name`
        );
        res.json({ performers: result.rows });
    } catch (err) {
        console.error('Performers error:', err);
        res.status(500).json({ error: 'Failed to fetch performers.' });
    }
});

/**
 * GET /api/performers/:slug
 * Single performer + their videos.
 */
router.get('/performers/:slug', async (req, res) => {
    try {
        const performer = await db.query(
            'SELECT * FROM performers WHERE slug = $1',
            [req.params.slug]
        );
        if (!performer.rows.length) return res.status(404).json({ error: 'Performer not found.' });

        const videos = await db.query(
            `SELECT v.id, v.title, v.thumbnail_url, v.duration_seconds,
                    v.price_euros, v.views_count, v.is_vr, v.is_amateur
             FROM videos v
             JOIN video_performers vp ON vp.video_id = v.id
             WHERE vp.performer_id = $1 AND v.is_published = TRUE
             ORDER BY v.created_at DESC`,
            [performer.rows[0].id]
        );

        res.json({ performer: performer.rows[0], videos: videos.rows });
    } catch (err) {
        console.error('Performer fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch performer.' });
    }
});

module.exports = router;

