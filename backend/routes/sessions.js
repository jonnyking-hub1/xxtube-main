const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { signJWT, verifyJWT } = require('../services/jwt');
const { requireSession } = require('../middleware/auth');
const db = require('../db/pool');

function isDemoMode() {
    return !process.env.DATABASE_URL || process.env.DEMO_MODE === 'true';
}

router.post('/init', async (req, res) => {
    try {
        const existing = req.cookies.xx_session;
        if (existing) {
            const payload = verifyJWT(existing);
            if (payload?.guest_uuid) return res.json({ guest_uuid: payload.guest_uuid, existing: true });
        }

        const guest_uuid = uuidv4();
        if (!isDemoMode()) {
            await db.query(
                'INSERT INTO guest_sessions (guest_uuid) VALUES ($1) ON CONFLICT DO NOTHING',
                [guest_uuid]
            );
            await db.query('ALTER TABLE guest_sessions ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMP');
        }

        const token = signJWT({ guest_uuid });
        res.cookie('xx_session', token, {
            httpOnly: true,
            sameSite: 'Strict',
            maxAge: 30 * 24 * 60 * 60 * 1000,
            secure: process.env.NODE_ENV === 'production',
        });
        res.json({ guest_uuid });
    } catch (err) {
        console.error('Session init error:', err);
        res.status(500).json({ error: 'Failed to initialise session.' });
    }
});

router.get('/entitlements', requireSession, async (req, res) => {
    if (isDemoMode()) return res.json({ entitlements: [] });
    try {
        const result = await db.query(
            'SELECT video_id FROM video_entitlements WHERE guest_uuid = $1',
            [req.session.guest_uuid]
        );
        res.json({ entitlements: result.rows.map((row) => row.video_id) });
    } catch (err) {
        console.error('Entitlements error:', err);
        res.status(500).json({ error: 'Failed to fetch entitlements.' });
    }
});

router.get('/check/:videoId', requireSession, async (req, res) => {
    if (isDemoMode()) return res.json({ has_access: false, trial_active: false, trial_expires_at: null });
    try {
        const entitlement = await db.query(
            'SELECT 1 FROM video_entitlements WHERE guest_uuid = $1 AND video_id = $2',
            [req.session.guest_uuid, req.params.videoId]
        );
        const session = await db.query(
            'SELECT trial_expires_at FROM guest_sessions WHERE guest_uuid = $1',
            [req.session.guest_uuid]
        );
        const expiry = session.rows[0]?.trial_expires_at || null;
        const trialActive = Boolean(expiry && new Date(expiry) > new Date());
        res.json({ has_access: entitlement.rows.length > 0 || trialActive, trial_active: trialActive, trial_expires_at: expiry });
    } catch (err) {
        console.error('Access check error:', err);
        res.status(500).json({ error: 'Failed to check access.' });
    }
});

router.post('/trial', requireSession, async (req, res) => {
    if (isDemoMode()) {
        return res.json({ granted: true, trial_expires_at: new Date(Date.now() + 86400000).toISOString() });
    }
    try {
        const existing = await db.query(
            'SELECT trial_expires_at FROM guest_sessions WHERE guest_uuid = $1',
            [req.session.guest_uuid]
        );
        const current = existing.rows[0]?.trial_expires_at;
        if (current && new Date(current) > new Date()) {
            return res.status(409).json({ error: 'Trial access is already active.', trial_expires_at: current });
        }
        const expiresAt = new Date(Date.now() + 86400000).toISOString();
        await db.query('UPDATE guest_sessions SET trial_expires_at = $1 WHERE guest_uuid = $2', [expiresAt, req.session.guest_uuid]);
        res.json({ granted: true, trial_expires_at: expiresAt, message: '24-hour trial access active.' });
    } catch (err) {
        console.error('Trial activation error:', err);
        res.status(500).json({ error: 'Failed to activate trial access.' });
    }
});

module.exports = router;
