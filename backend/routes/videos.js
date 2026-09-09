const express  = require('express');
const router   = express.Router();
const { requireSession } = require('../middleware/auth');
const { generateBunnyStreamUrl, generateBunnyThumbnailUrl } = require('../services/bunny');
const db       = require('../db/pool');

/**
 * Overwrites thumbnail_url with a freshly signed Bunny thumbnail link,
 * since thumbnails sit behind the same CDN token authentication as the
 * video stream itself and can't be cached as a static DB value.
 */
function withSignedThumbnail(row) {
    if (row.bunny_video_id) {
        row.thumbnail_url = generateBunnyThumbnailUrl(row.bunny_video_id);
    }
    return row;
}

/**
 * GET /api/videos
 * Paginated video catalog.
 * Filters: ?category=slug, ?orientation=straight|gay|trans,
 *          ?tag=tag_name, ?performer=slug, ?search=term
 */
router.get('/', async (req, res) => {
    try {
        const page        = Math.max(1, parseInt(req.query.page) || 1);
        const search      = req.query.search      || null;
        const category    = req.query.category    || null;
        const orientation = req.query.orientation || null;
        const tag         = req.query.tag         || null;
        const performer   = req.query.performer   || null;
        const offset      = (page - 1) * 15;

        const conditions = ['v.is_published = TRUE'];
        const params     = [];

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

        // Count
        const countResult = await db.query(
            `SELECT COUNT(DISTINCT v.id)
             FROM videos v
             LEFT JOIN categories c ON v.category_id = c.id
             LEFT JOIN video_tags vt ON vt.video_id = v.id
             ${where}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        // Fetch
        params.push(15, offset);
        const result = await db.query(
            `SELECT DISTINCT
                v.id, v.title, v.thumbnail_url, v.preview_animation_url, v.bunny_video_id,
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
            videos:     result.rows.map(withSignedThumbnail),
            page,
            total,
            totalPages: Math.ceil(total / 15),
        });
    } catch (err) {
        console.error('Videos list error:', err);
        res.status(500).json({ error: 'Failed to fetch videos.' });
    }
});

/**
 * GET /api/videos/:id
 */
router.get('/:id', async (req, res) => {
    try {
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

        if (!result.rows.length) return res.status(404).json({ error: 'Video not found.' });

        db.query('UPDATE videos SET views_count = views_count + 1 WHERE id = $1', [req.params.id])
          .catch(() => {});

        res.json({ video: withSignedThumbnail(result.rows[0]) });
    } catch (err) {
        console.error('Video fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch video.' });
    }
});

/**
 * GET /api/videos/:id/stream
 */
router.get('/:id/stream', requireSession, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT bunny_video_id FROM videos WHERE id = $1 AND is_published = TRUE',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Video not found.' });

        const streamUrl = generateBunnyStreamUrl(result.rows[0].bunny_video_id);
        res.json({ stream_url: streamUrl });
    } catch (err) {
        console.error('Stream URL error:', err);
        res.status(500).json({ error: 'Failed to generate stream URL.' });
    }
});

/**
 * GET /api/videos/:id/related
 */
router.get('/:id/related', async (req, res) => {
    try {
        const video = await db.query(
            'SELECT category_id, orientation FROM videos WHERE id = $1',
            [req.params.id]
        );
        if (!video.rows.length) return res.json({ videos: [] });

        const { category_id, orientation } = video.rows[0];
        const result = await db.query(
            `SELECT id, title, thumbnail_url, bunny_video_id, duration_seconds, price_euros, views_count, is_vr, is_amateur
             FROM videos
             WHERE (category_id = $1 OR orientation = $2) AND id != $3 AND is_published = TRUE
             ORDER BY views_count DESC LIMIT 6`,
            [category_id, orientation, req.params.id]
        );
        res.json({ videos: result.rows.map(withSignedThumbnail) });
    } catch (err) {
        console.error('Related error:', err);
        res.status(500).json({ error: 'Failed to fetch related.' });
    }
});

module.exports = router;

