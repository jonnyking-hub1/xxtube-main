require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();

// ── Security & Parsing ────────────────────────────────────────
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? ['https://xxtube.com', 'https://www.xxtube.com']
        : 'http://localhost:3000',
    credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// ── Rate Limiting ─────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ── API Routes ────────────────────────────────────────────────
app.use('/api/sessions',   require('./routes/sessions'));
app.use('/api/videos',     require('./routes/videos'));
app.use('/api/payments',   require('./routes/payments'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/performers', require('./routes/categories')); // performers served from same router
app.use('/api/admin',      require('./routes/admin'));

// ── Static Frontend ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// All non-API routes serve the frontend (SPA fallback)
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Route not found.' });
    }
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────
// Vercel runs this as a serverless function — no app.listen() needed there.
// For local dev (npm run dev), we still listen normally.
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\n🚀 XXTube running on http://localhost:${PORT}`);
        console.log(`   Admin panel: http://localhost:${PORT}/admin.html`);
        console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
}

// Required for Vercel serverless
module.exports = app;
