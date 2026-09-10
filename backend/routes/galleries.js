const express = require('express');
const router  = express.Router();
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
                (SELECT COUNT(*) FROM gallery_images gi WHERE gi.gallery_id = g.id) AS image_count
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

        res.json({
            galleries:  result.rows,
            page,
            total,
            totalPages: Math.ceil(total / 15),
        });
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
            'SELECT id, image_url, sort_order FROM gallery_images WHERE gallery_id = $1 ORDER BY sort_order ASC',
            [req.params.id]
        );
        gallery.images = images.rows;

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

module.exports = router;