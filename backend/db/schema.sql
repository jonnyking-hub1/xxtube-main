-- ══════════════════════════════════════════════════════════════
-- XXTube Adult Platform Database Schema
-- Run once: psql $DATABASE_URL -f backend/db/schema.sql
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Categories & Orientations ─────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    orientation VARCHAR(30) DEFAULT 'straight'
);

-- ── Performers / Models ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS performers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    gender      VARCHAR(30),
    is_verified BOOLEAN DEFAULT FALSE,
    avatar_url  TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Main Video Catalog ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS videos (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                 VARCHAR(255) NOT NULL,
    bunny_video_id        VARCHAR(255) NOT NULL,
    thumbnail_url         TEXT,
    preview_animation_url TEXT,
    duration_seconds      INT NOT NULL DEFAULT 0,
    price_euros           DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    views_count           BIGINT DEFAULT 0,
    likes_count           INT DEFAULT 0,
    dislikes_count        INT DEFAULT 0,
    orientation           VARCHAR(30) DEFAULT 'straight',
    category_id           UUID REFERENCES categories(id) ON DELETE SET NULL,
    is_published          BOOLEAN DEFAULT TRUE,
    is_amateur            BOOLEAN DEFAULT FALSE,
    is_vr                 BOOLEAN DEFAULT FALSE,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Junction Tables ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_performers (
    video_id     UUID REFERENCES videos(id) ON DELETE CASCADE,
    performer_id UUID REFERENCES performers(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, performer_id)
);

CREATE TABLE IF NOT EXISTS video_tags (
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    tag_name VARCHAR(50) NOT NULL
);

-- ── Guest Sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_sessions (
    guest_uuid UUID PRIMARY KEY,
    email      VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Per-video Entitlements ────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_entitlements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_uuid UUID REFERENCES guest_sessions(guest_uuid) ON DELETE CASCADE,
    video_id   UUID REFERENCES videos(id) ON DELETE CASCADE,
    paid_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guest_uuid, video_id)
);

-- ── Purchase History ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_uuid      UUID REFERENCES guest_sessions(guest_uuid),
    video_id        UUID REFERENCES videos(id) ON DELETE SET NULL,
    email           VARCHAR(255) NOT NULL,
    amount_cents    INT NOT NULL,
    currency        VARCHAR(3) DEFAULT 'EUR',
    transaction_ref VARCHAR(255) UNIQUE NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Ad Placements ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_placements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_key   VARCHAR(50) NOT NULL UNIQUE,
    html_code  TEXT NOT NULL DEFAULT '',
    is_active  BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_videos_created_at  ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_category    ON videos(category_id);
CREATE INDEX IF NOT EXISTS idx_videos_orientation ON videos(orientation);
CREATE INDEX IF NOT EXISTS idx_videos_published   ON videos(is_published);
CREATE INDEX IF NOT EXISTS idx_video_tags_video   ON video_tags(video_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_guest ON video_entitlements(guest_uuid);
CREATE INDEX IF NOT EXISTS idx_purchases_email    ON purchases(email);
CREATE INDEX IF NOT EXISTS idx_videos_fts         ON videos USING gin(to_tsvector('english', title));

-- ── Seeds: Ad Slots ───────────────────────────────────────────
INSERT INTO ad_placements (slot_key, html_code, is_active) VALUES
    ('header_728x90',   '', FALSE),
    ('sidebar_300x250', '', FALSE),
    ('below_player',    '', FALSE)
ON CONFLICT (slot_key) DO NOTHING;

-- ── Seeds: Adult Categories ───────────────────────────────────
INSERT INTO categories (name, slug, orientation) VALUES
    ('Amateur',          'amateur',         'straight'),
    ('Verified Models',  'verified-models', 'straight'),
    ('POV & VR',         'pov-vr',          'straight'),
    ('Parody & Cosplay', 'parody-cosplay',  'straight'),
    ('Solo & Couples',   'solo-couples',    'straight'),
    ('Fetish',           'fetish',          'straight'),
    ('Trans Content',    'trans-content',   'trans'),
    ('Gay Catalog',      'gay-catalog',     'gay')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, orientation = EXCLUDED.orientation;
