const crypto = require('crypto');
require('dotenv').config();

/**
 * Generates a time-limited signed Bunny Stream URL.
 * Token expires in 10 minutes — long enough to buffer, short enough to be useless if leaked.
 */
function generateBunnyStreamUrl(bunnyVideoId) {
    const tokenKey    = process.env.BUNNY_TOKEN_AUTH_KEY;
    const cdnHostname = process.env.BUNNY_CDN_HOSTNAME;
    const expiry      = Math.floor(Date.now() / 1000) + 600; // 10 min TTL
    // No library ID in the path — Bunny Stream pull-zone URLs are just /{video_id}/playlist.m3u8
    const path        = `/${bunnyVideoId}/playlist.m3u8`;

    // Bunny token signing formula
    const hashable = `${tokenKey}${path}${expiry}`;
    const token = crypto
        .createHash('sha256')
        .update(hashable)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

    return `https://${cdnHostname}${path}?token=${token}&expires=${expiry}`;
}

/**
 * Generates a time-limited signed URL for a video's auto-generated Bunny thumbnail.
 * Same token scheme as the stream URL — thumbnails sit behind the same CDN token
 * authentication, so every displayed thumbnail needs its own fresh signed token.
 * Longer TTL than the stream URL since a page (grid, watch page) may sit open a while.
 */
function generateBunnyThumbnailUrl(bunnyVideoId) {
    const tokenKey    = process.env.BUNNY_TOKEN_AUTH_KEY;
    const cdnHostname = process.env.BUNNY_CDN_HOSTNAME;
    const expiry      = Math.floor(Date.now() / 1000) + 3600; // 1 hour TTL
    const path        = `/${bunnyVideoId}/thumbnail.jpg`;

    const hashable = `${tokenKey}${path}${expiry}`;
    const token = crypto
        .createHash('sha256')
        .update(hashable)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

    return `https://${cdnHostname}${path}?token=${token}&expires=${expiry}`;
}

/**
 * Creates a new video record on Bunny Stream and returns the video GUID + TUS upload URL.
 * The admin frontend uses this to upload directly to Bunny — never through this server.
 */
/**
 * Creates a new video record on Bunny Stream and returns a presigned TUS upload credential.
 * The admin frontend uses this to upload directly to Bunny via the TUS protocol —
 * the raw API key never leaves the server, only a short-lived signed credential does.
 */
async function createBunnyVideo(title) {
    const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
    const apiKey    = process.env.BUNNY_STREAM_API_KEY;

    const response = await fetch(
        `https://video.bunnycdn.com/library/${libraryId}/videos`,
        {
            method: 'POST',
            headers: {
                'AccessKey':    apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title }),
        }
    );

    if (!response.ok) {
        throw new Error(`Bunny API error: ${response.status}`);
    }

    const data = await response.json();
    const videoId = data.guid;

    // Presigned TUS credential — expires in 1 hour, plenty for a large upload.
    const expirationTime = Math.floor(Date.now() / 1000) + 3600;
    const signature = crypto
        .createHash('sha256')
        .update(`${libraryId}${apiKey}${expirationTime}${videoId}`)
        .digest('hex');

    return {
        videoId,
        libraryId,
        expirationTime,
        signature,
        uploadUrl: `https://video.bunnycdn.com/tusupload`,
    };
}

/**
 * Uploads a single image buffer to Bunny Storage and returns its public CDN URL.
 * Images are stored under /galleries/{filename} in the storage zone.
 */
async function uploadImageToStorage(buffer, filename, contentType) {
    const zoneName    = process.env.BUNNY_STORAGE_ZONE_NAME;
    const apiKey      = process.env.BUNNY_STORAGE_API_KEY;
    const storageHost = process.env.BUNNY_STORAGE_HOSTNAME;
    const cdnHost      = process.env.BUNNY_STORAGE_CDN_HOSTNAME;

    // Sanitize filename and make it unique to avoid collisions
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const path     = `galleries/${safeName}`;

    const response = await fetch(
        `https://${storageHost}/${zoneName}/${path}`,
        {
            method:  'PUT',
            headers: {
                'AccessKey':    apiKey,
                'Content-Type': contentType || 'application/octet-stream',
            },
            body: buffer,
        }
    );

    if (!response.ok) {
        throw new Error(`Bunny Storage upload failed: ${response.status}`);
    }

    return `https://${cdnHost}/${path}`;
}

module.exports = { generateBunnyStreamUrl, generateBunnyThumbnailUrl, createBunnyVideo, uploadImageToStorage };