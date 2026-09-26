const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { signJWT, verifyJWT } = require('../services/jwt');
const { requireSession } = require('../middleware/auth');
const db       = require('../db/pool');

/**
 * POST /api/sessions/init
 * Issues a guest_uuid and signed JWT cookie on first visit.
 * Idempotent — returns existing session if cookie is already valid.
 */
router.post('/init', async (req, res) => {
    try {
        // Check if they already have a valid session
        const existing = req.cookies.xx_session;
        if (existing) {
            const payload = verifyJWT(existing);
            if (payload) return res.json({ guest_uuid: payload.guest_uuid, existing: true });
        }

        const guest_uuid = uuidv4();

        await db.query(
            'INSERT INTO guest_sessions (guest_uuid) VALUES ($1) ON CONFLICT DO NOTHING',
            [guest_uuid]
        );

        const token = signJWT({ guest_uuid });

        res.cookie('xx_session', token, {
            httpOnly:  true,
            sameSite:  'Strict',
            maxAge:    30 * 24 * 60 * 60 * 1000, // 30 days
            secure:    process.env.NODE_ENV === 'production',
        });

        res.json({ guest_uuid });
    } catch (err) {
        console.error('Session init error:', err);
        res.status(500).json({ error: 'Failed to initialise session.' });
    }
});

/**
 * GET /api/sessions/entitlements
 * Returns list of video IDs this guest has paid for.
 */
router.get('/entitlements', requireSession, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT video_id FROM video_entitlements WHERE guest_uuid = $1',
            [req.session.guest_uuid]
        );
        const videoIds = result.rows.map(r => r.video_id);
        res.json({ entitlements: videoIds });
    } catch (err) {
        console.error('Entitlements error:', err);
        res.status(500).json({ error: 'Failed to fetch entitlements.' });
    }
});

/**
 * GET /api/sessions/check/:videoId
 * Quick check — does this guest have access to a specific video?
 */
router.get('/check/:videoId', requireSession, async (req, res) => {
    try {
        const entitlement = await db.query(
            'SELECT 1 FROM video_entitlements WHERE guest_uuid = $1 AND video_id = $2',
            [req.session.guest_uuid, req.params.videoId]
        );

        const session = await db.query(
            'SELECT trial_expires_at FROM guest_sessions WHERE guest_uuid = $1',
            [req.session.guest_uuid]
        );

        const trialActive = session.rows[0] && session.rows[0].trial_expires_at && new Date(session.rows[0].trial_expires_at) > new Date();

        res.json({
            has_access: entitlement.rows.length > 0 || trialActive,
            trial_active: trialActive,
            trial_expires_at: session.rows[0]?.trial_expires_at || null,
        });
    } catch (err) {
        console.error('Access check error:', err);
        res.status(500).json({ error: 'Failed to check access.' });
    }
});

router.post('/trial', requireSession, async (req, res) => {
    try {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        await db.query(
            `UPDATE guest_sessions
             SET trial_expires_at = $1
             WHERE guest_uuid = $2`,
            [expiresAt, req.session.guest_uuid]
        );

        res.json({
            granted: true,
            trial_expires_at: expiresAt,
            message: '24-hour trial access active.',
        });
    } catch (err) {
        console.error('Trial activation error:', err);
        res.status(500).json({ error: 'Failed to activate trial access.' });
    }
});

module.exports = router;
