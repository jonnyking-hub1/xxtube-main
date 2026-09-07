# XXTube

Premium video streaming platform with Tender payment integration.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Fill in all values in `.env` before starting.

### 3. Set up the database
```bash
psql $DATABASE_URL -f backend/db/schema.sql
```

### 4. Start the server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3000`

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Random 64-char string for signing session cookies |
| `BUNNY_STREAM_LIBRARY_ID` | Your Bunny Stream library ID |
| `BUNNY_STREAM_API_KEY` | Bunny Stream API key |
| `BUNNY_TOKEN_AUTH_KEY` | Bunny token authentication key (enable in library security settings) |
| `BUNNY_CDN_HOSTNAME` | e.g. `yourlib.b-cdn.net` |
| `ADMIN_SECRET` | Password to access the admin panel |
| `PORT` | Server port (default: 3000) |

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Project Structure

```
xxtube/
├── backend/
│   ├── server.js              # Express entry point
│   ├── db/
│   │   ├── schema.sql         # Run this first
│   │   └── pool.js            # PostgreSQL connection
│   ├── middleware/
│   │   ├── auth.js            # JWT & admin auth
│   │   └── rateLimiter.js     # Rate limiting
│   ├── routes/
│   │   ├── sessions.js        # Guest session management
│   │   ├── videos.js          # Video catalog & streaming
│   │   ├── payments.js        # Tender payment flow
│   │   ├── categories.js      # Categories & creators
│   │   └── admin.js           # Admin API
│   └── services/
│       ├── bunny.js           # Bunny CDN integration
│       ├── jwt.js             # Token signing
│       └── logCleaner.js      # Auto-clear payment logs
│
└── frontend/
    ├── index.html             # Home grid
    ├── watch.html             # Video player
    ├── admin.html             # Admin panel
    └── assets/
        ├── style.css          # All styles
        ├── app.js             # Home page logic
        ├── player.js          # Player & paywall
        └── admin.js           # Admin panel logic
```

---

## API Endpoints

### Public
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/sessions/init` | Create guest session |
| `GET` | `/api/sessions/check/:videoId` | Check video access |
| `GET` | `/api/sessions/entitlements` | List purchased videos |
| `GET` | `/api/videos` | Paginated catalog |
| `GET` | `/api/videos/:id` | Single video |
| `GET` | `/api/videos/:id/stream` | Signed HLS URL |
| `GET` | `/api/videos/:id/related` | Related videos |
| `GET` | `/api/categories` | All categories |
| `GET` | `/api/categories/creators` | All creators |
| `POST` | `/api/payments/submit` | Card submission |
| `POST` | `/api/payments/unlock` | Unlock after timer |
| `POST` | `/api/payments/recover` | Recover lost access |

### Admin (requires `X-Admin-Secret` header)
| Method | Route | Description |
|---|---|---|
| `GET` | `/api/admin/stats` | Dashboard stats |
| `GET` | `/api/admin/payments/pending` | Live payment log |
| `GET` | `/api/admin/payments/history` | Purchase history |
| `POST` | `/api/admin/videos/upload-url` | Get Bunny upload URL |
| `POST` | `/api/admin/videos` | Create video record |
| `PUT` | `/api/admin/videos/:id` | Update video |
| `DELETE` | `/api/admin/videos/:id` | Delete video |
| `GET/POST/DELETE` | `/api/admin/categories` | Category CRUD |
| `GET/POST` | `/api/admin/creators` | Creator CRUD |
| `GET` | `/api/admin/ads` | Get ad slots |
| `PUT` | `/api/admin/ads/:slotKey` | Update ad slot |

---

## Deployment

### Railway / Render
1. Connect your GitHub repo
2. Set all environment variables in the dashboard
3. Deploy — the server serves both API and static frontend

### VPS
```bash
npm install --production
NODE_ENV=production npm start
```

Use PM2 for process management:
```bash
npm install -g pm2
pm2 start backend/server.js --name xxtube
pm2 save
```

---

## Admin Panel

Visit `/admin.html` and enter your `ADMIN_SECRET` password.

**Payment Monitor:** Polls `/api/admin/payments/pending` every 5 seconds. Entries auto-clear from memory after 20 seconds — card data is never written to disk or database.

**Video Upload:** Select a file → the browser uploads directly to Bunny CDN (TUS protocol). Your server is never touched by the video file.
