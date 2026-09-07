const { verifyJWT } = require('../services/jwt');

/**
 * Requires a valid xx_session cookie.
 * Attaches decoded payload to req.session.
 */
function requireSession(req, res, next) {
    const token = req.cookies.xx_session;
    if (!token) return res.status(401).json({ error: 'No session. Visit the site first.' });

    const payload = verifyJWT(token);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired session.' });

    req.session = payload;
    next();
}

/**
 * Requires the X-Admin-Secret header to match ADMIN_SECRET env var.
 */
function requireAdmin(req, res, next) {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
}

module.exports = { requireSession, requireAdmin };
