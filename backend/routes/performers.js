const express = require('express');
const router  = express.Router();
const db      = require('../db/pool');

/**
 * GET /api/performers
 * Public performer list, used to populate performer pickers on upload/gallery forms
 * and the homepage performers rail.
 */
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM performers ORDER BY name');
        res.json({ performers: result.rows });
    } catch (err) {
        console.error('Performers list error:', err);
        res.status(500).json({ error: 'Failed to fetch performers.' });
    }
});

module.exports = router;