const express  = require('express');
const router   = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { createBunnyVideo } = require('../services/bunny');
const db       = require('../db/pool');

// ── TEMP DEBUG — remove after confirming ADMIN_SECRET is set correctly ──
router.get('/_debug-secret', (req, res) => {
    const val = process.env.ADMIN_SECRET;
    res.json({
        is_set: val !== undefined,
        length: val ? val.length : 0,
        first_char: val ? val[0] : null,
        last_char: val ? val[val.length - 1] : null,
        matches_expected: val === 'Lockedin01',
    });
});

// ── TEMP DEBUG 2 — test a password directly from the URL, no devtools needed ──
router.get('/_debug-login', (req, res) => {
    const stored = process.env.ADMIN_SECRET || '';
    const tried  = req.query.pw || '';
    res.json({
        stored_length: stored.length,
        tried_length: tried.length,
        stored_codes: [...stored].map(c => c.charCodeAt(0)),
        tried_codes: [...tried].map(c => c.charCodeAt(0)),
        match: stored === tried,
    });
});

router.use(requireAdmin);

// ── Payment Monitor ───────────────────────────────────────────

router.get('/payments/pending', (req, res) => {
    const { pendingLogs } = require('./payments');
    const entries = Array.from(pendingLogs.entries()).map(([ref, data]) => ({
        transaction_ref: ref, ...data,
    }));
    res.json({ pending: entries, count: entries.length });
});

router.get('/payments/history', async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page) || 1);
        const offset = (page - 1) * 50;
        const result = await db.query(
            `SELECT p.*, v.title AS video_title
             FROM purchases p
             LEFT JOIN videos v ON p.video_id = v.id
             ORDER BY p.created_at DESC
             LIMIT 50 OFFSET $1`,
            [offset]
        );
        const count = await db.query('SELECT COUNT(*) FROM purchases');
        res.json({ purchases: result.rows, total: parseInt(count.rows[0].count), page });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch history.' });
    }
});

// ── Video Upload ──────────────────────────────────────────────

router.post('/videos/upload-url', async (req, res) => {
    try {
        const { title } = req.body;
        if (!title) return res.status(400).json({ error: 'Title required.' });
        const bunny = await createBunnyVideo(title);
        res.json(bunny);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create upload URL.' });
    }
});

router.post('/videos', async (req, res) => {
    try {
        const {
            title, bunny_video_id, thumbnail_url, duration_seconds,
            price_euros, category_id, orientation,
            performer_ids, tags, is_amateur, is_vr
        } = req.body;

        if (!title || !bunny_video_id || price_euros === undefined) {
            return res.status(400).json({ error: 'title, bunny_video_id, and price_euros required.' });
        }

        const result = await db.query(
            `INSERT INTO videos
                (title, bunny_video_id, thumbnail_url, duration_seconds,
                 price_euros, category_id, orientation, is_amateur, is_vr)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [
                title, bunny_video_id, thumbnail_url || null,
                duration_seconds || 0, price_euros,
                category_id || null,
                orientation || 'straight',
                is_amateur || false,
                is_vr || false,
            ]
        );

        const videoId = result.rows[0].id;

        if (performer_ids && performer_ids.length) {
            for (const pid of performer_ids) {
                await db.query(
                    'INSERT INTO video_performers (video_id, performer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                    [videoId, pid]
                );
            }
        }

        if (tags && tags.length) {
            for (const tag of tags) {
                await db.query(
                    'INSERT INTO video_tags (video_id, tag_name) VALUES ($1,$2)',
                    [videoId, tag.trim().toLowerCase()]
                );
            }
        }

        res.status(201).json({ id: videoId, message: 'Video created.' });
    } catch (err) {
        console.error('Video create error:', err);
        res.status(500).json({ error: 'Failed to create video.' });
    }
});

router.put('/videos/:id', async (req, res) => {
    try {
        const { title, thumbnail_url, price_euros, duration_seconds, category_id, orientation, is_published, is_amateur, is_vr } = req.body;
        await db.query(
            `UPDATE videos SET
                title            = COALESCE($1, title),
                thumbnail_url    = COALESCE($2, thumbnail_url),
                price_euros      = COALESCE($3, price_euros),
                duration_seconds = COALESCE($4, duration_seconds),
                category_id      = COALESCE($5, category_id),
                orientation      = COALESCE($6, orientation),
                is_published     = COALESCE($7, is_published),
                is_amateur       = COALESCE($8, is_amateur),
                is_vr            = COALESCE($9, is_vr)
             WHERE id = $10`,
            [title, thumbnail_url, price_euros, duration_seconds, category_id, orientation, is_published, is_amateur, is_vr, req.params.id]
        );
        res.json({ message: 'Video updated.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update video.' });
    }
});

router.delete('/videos/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
        res.json({ message: 'Video deleted.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete video.' });
    }
});

router.get('/videos', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT v.*, c.name AS category_name
             FROM videos v
             LEFT JOIN categories c ON v.category_id = c.id
             ORDER BY v.created_at DESC LIMIT 200`
        );
        res.json({ videos: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch videos.' });
    }
});

// ── Categories ────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
    const result = await db.query('SELECT * FROM categories ORDER BY name');
    res.json({ categories: result.rows });
});

router.post('/categories', async (req, res) => {
    try {
        const { name, slug, orientation } = req.body;
        if (!name || !slug) return res.status(400).json({ error: 'name and slug required.' });
        const result = await db.query(
            'INSERT INTO categories (name, slug, orientation) VALUES ($1,$2,$3) RETURNING *',
            [name, slug.toLowerCase().replace(/\s+/g, '-'), orientation || 'straight']
        );
        res.status(201).json({ category: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists.' });
        res.status(500).json({ error: 'Failed to create category.' });
    }
});

router.delete('/categories/:id', async (req, res) => {
    await db.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ message: 'Category deleted.' });
});

// ── Performers ────────────────────────────────────────────────

router.get('/performers', async (req, res) => {
    const result = await db.query('SELECT * FROM performers ORDER BY name');
    res.json({ performers: result.rows });
});

router.post('/performers', async (req, res) => {
    try {
        const { name, slug, gender, avatar_url, is_verified } = req.body;
        if (!name || !slug) return res.status(400).json({ error: 'name and slug required.' });
        const result = await db.query(
            'INSERT INTO performers (name, slug, gender, avatar_url, is_verified) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [name, slug.toLowerCase().replace(/\s+/g, '-'), gender || null, avatar_url || null, is_verified || false]
        );
        res.status(201).json({ performer: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists.' });
        res.status(500).json({ error: 'Failed to create performer.' });
    }
});

router.put('/performers/:id', async (req, res) => {
    try {
        const { name, gender, avatar_url, is_verified } = req.body;
        await db.query(
            `UPDATE performers SET
                name        = COALESCE($1, name),
                gender      = COALESCE($2, gender),
                avatar_url  = COALESCE($3, avatar_url),
                is_verified = COALESCE($4, is_verified)
             WHERE id = $5`,
            [name, gender, avatar_url, is_verified, req.params.id]
        );
        res.json({ message: 'Performer updated.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update performer.' });
    }
});

router.delete('/performers/:id', async (req, res) => {
    await db.query('DELETE FROM performers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Performer deleted.' });
});

// ── Ad Placements ─────────────────────────────────────────────

router.get('/ads', async (req, res) => {
    const result = await db.query('SELECT * FROM ad_placements ORDER BY slot_key');
    res.json({ ads: result.rows });
});

router.put('/ads/:slotKey', async (req, res) => {
    try {
        const { html_code, is_active } = req.body;
        await db.query(
            `UPDATE ad_placements SET html_code=$1, is_active=$2, updated_at=NOW() WHERE slot_key=$3`,
            [html_code || '', is_active !== undefined ? is_active : true, req.params.slotKey]
        );
        res.json({ message: 'Ad updated.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update ad.' });
    }
});

// ── Stats ─────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
    try {
        const { pendingLogs } = require('./payments');
        const [videos, revenue, views] = await Promise.all([
            db.query('SELECT COUNT(*) FROM videos WHERE is_published = TRUE'),
            db.query(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM purchases WHERE created_at > NOW() - INTERVAL '24 hours'`),
            db.query('SELECT COALESCE(SUM(views_count),0) AS total FROM videos'),
        ]);
        res.json({
            total_videos:     parseInt(videos.rows[0].count),
            revenue_today:    (parseInt(revenue.rows[0].total) / 100).toFixed(2),
            pending_payments: pendingLogs.size,
            total_views:      parseInt(views.rows[0].total),
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

module.exports = router;


// ── Payment Monitor ───────────────────────────────────────────

/**
 * GET /api/admin/payments/pending
 * Returns current in-memory payment log for the team monitor.
 * Polled every 5 seconds by the admin dashboard.
 */
router.get('/payments/pending', (req, res) => {
    const { pendingLogs } = require('./payments');
    const entries = Array.from(pendingLogs.entries()).map(([ref, data]) => ({
        transaction_ref: ref,
        ...data,
    }));
    res.json({ pending: entries, count: entries.length });
});

/**
 * GET /api/admin/payments/history
 * Paginated purchase history from the database.
 */
router.get('/payments/history', async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page) || 1);
        const offset = (page - 1) * 50;

        const result = await db.query(
            `SELECT p.*, v.title AS video_title
             FROM purchases p
             LEFT JOIN videos v ON p.video_id = v.id
             ORDER BY p.created_at DESC
             LIMIT 50 OFFSET $1`,
            [offset]
        );

        const count = await db.query('SELECT COUNT(*) FROM purchases');
        res.json({ purchases: result.rows, total: parseInt(count.rows[0].count), page });
    } catch (err) {
        console.error('Payment history error:', err);
        res.status(500).json({ error: 'Failed to fetch history.' });
    }
});

// ── Video Upload ──────────────────────────────────────────────

/**
 * POST /api/admin/videos/upload-url
 * Creates a video record on Bunny Stream and returns the TUS upload credentials.
 * Admin browser uploads directly to Bunny — this server is never touched by the file.
 */
router.post('/videos/upload-url', async (req, res) => {
    try {
        const { title } = req.body;
        if (!title) return res.status(400).json({ error: 'Title is required.' });

        const bunny = await createBunnyVideo(title);
        res.json(bunny);
    } catch (err) {
        console.error('Upload URL error:', err);
        res.status(500).json({ error: 'Failed to create Bunny upload URL.' });
    }
});

/**
 * POST /api/admin/videos
 * Saves video metadata to the database after Bunny upload is complete.
 */
router.post('/videos', async (req, res) => {
    try {
        const { title, bunny_video_id, thumbnail_url, duration_seconds, price_euros, category_id, creator_ids, tags } = req.body;

        if (!title || !bunny_video_id || !price_euros) {
            return res.status(400).json({ error: 'title, bunny_video_id, and price_euros are required.' });
        }

        const result = await db.query(
            `INSERT INTO videos (title, bunny_video_id, thumbnail_url, duration_seconds, price_euros, category_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [title, bunny_video_id, thumbnail_url || null, duration_seconds || 0, price_euros, category_id || null]
        );

        const videoId = result.rows[0].id;

        // Link creators
        if (creator_ids && creator_ids.length) {
            for (const cid of creator_ids) {
                await db.query(
                    'INSERT INTO video_creators (video_id, creator_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [videoId, cid]
                );
            }
        }

        // Add tags
        if (tags && tags.length) {
            for (const tag of tags) {
                await db.query(
                    'INSERT INTO video_tags (video_id, tag_name) VALUES ($1, $2)',
                    [videoId, tag.trim()]
                );
            }
        }

        res.status(201).json({ id: videoId, message: 'Video created.' });
    } catch (err) {
        console.error('Video create error:', err);
        res.status(500).json({ error: 'Failed to create video.' });
    }
});

/**
 * PUT /api/admin/videos/:id
 * Update video metadata.
 */
router.put('/videos/:id', async (req, res) => {
    try {
        const { title, thumbnail_url, price_euros, duration_seconds, category_id, is_published } = req.body;

        await db.query(
            `UPDATE videos SET
                title            = COALESCE($1, title),
                thumbnail_url    = COALESCE($2, thumbnail_url),
                price_euros      = COALESCE($3, price_euros),
                duration_seconds = COALESCE($4, duration_seconds),
                category_id      = COALESCE($5, category_id),
                is_published     = COALESCE($6, is_published)
             WHERE id = $7`,
            [title, thumbnail_url, price_euros, duration_seconds, category_id, is_published, req.params.id]
        );

        res.json({ message: 'Video updated.' });
    } catch (err) {
        console.error('Video update error:', err);
        res.status(500).json({ error: 'Failed to update video.' });
    }
});

/**
 * DELETE /api/admin/videos/:id
 */
router.delete('/videos/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
        res.json({ message: 'Video deleted.' });
    } catch (err) {
        console.error('Video delete error:', err);
        res.status(500).json({ error: 'Failed to delete video.' });
    }
});

// ── Categories ────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
    const result = await db.query('SELECT * FROM categories ORDER BY name');
    res.json({ categories: result.rows });
});

router.post('/categories', async (req, res) => {
    try {
        const { name, slug } = req.body;
        if (!name || !slug) return res.status(400).json({ error: 'name and slug required.' });
        const result = await db.query(
            'INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING *',
            [name, slug.toLowerCase().replace(/\s+/g, '-')]
        );
        res.status(201).json({ category: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists.' });
        res.status(500).json({ error: 'Failed to create category.' });
    }
});

router.delete('/categories/:id', async (req, res) => {
    await db.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ message: 'Category deleted.' });
});

// ── Creators ──────────────────────────────────────────────────

router.get('/creators', async (req, res) => {
    const result = await db.query('SELECT * FROM creators ORDER BY name');
    res.json({ creators: result.rows });
});

router.post('/creators', async (req, res) => {
    try {
        const { name, avatar_url } = req.body;
        if (!name) return res.status(400).json({ error: 'name required.' });
        const result = await db.query(
            'INSERT INTO creators (name, avatar_url) VALUES ($1, $2) RETURNING *',
            [name, avatar_url || null]
        );
        res.status(201).json({ creator: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create creator.' });
    }
});

// ── Ad Placements ─────────────────────────────────────────────

router.get('/ads', async (req, res) => {
    const result = await db.query('SELECT * FROM ad_placements ORDER BY slot_key');
    res.json({ ads: result.rows });
});

router.put('/ads/:slotKey', async (req, res) => {
    try {
        const { html_code, is_active } = req.body;
        await db.query(
            `UPDATE ad_placements SET html_code = $1, is_active = $2, updated_at = NOW()
             WHERE slot_key = $3`,
            [html_code || '', is_active !== undefined ? is_active : true, req.params.slotKey]
        );
        res.json({ message: 'Ad placement updated.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update ad placement.' });
    }
});

// ── Stats ─────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
    try {
        const [videos, revenue, pending, views] = await Promise.all([
            db.query('SELECT COUNT(*) FROM videos WHERE is_published = TRUE'),
            db.query(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM purchases WHERE created_at > NOW() - INTERVAL '24 hours'`),
            db.query('SELECT COUNT(*) FROM purchases WHERE created_at > NOW() - INTERVAL \'1 hour\''),
            db.query(`SELECT COALESCE(SUM(views_count), 0) AS total FROM videos`),
        ]);

        const { pendingLogs } = require('./payments');

        res.json({
            total_videos:    parseInt(videos.rows[0].count),
            revenue_today:   (parseInt(revenue.rows[0].total) / 100).toFixed(2),
            pending_payments: pendingLogs.size,
            total_views:     parseInt(views.rows[0].total),
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

// ── All Videos (admin, unpaginated up to 200) ─────────────────

router.get('/videos', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT v.*, c.name AS category_name
             FROM videos v
             LEFT JOIN categories c ON v.category_id = c.id
             ORDER BY v.created_at DESC LIMIT 200`
        );
        res.json({ videos: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch videos.' });
    }
});

module.exports = router;
