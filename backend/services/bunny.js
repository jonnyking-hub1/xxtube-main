const crypto = require('crypto');
require('dotenv').config();

/**
 * Generates a time-limited signed Bunny Stream URL.
 * Token expires in 10 minutes — long enough to buffer, short enough to be useless if leaked.
 */
function generateBunnyStreamUrl(bunnyVideoId) {
    const libraryId   = process.env.BUNNY_STREAM_LIBRARY_ID;
    const tokenKey    = process.env.BUNNY_TOKEN_AUTH_KEY;
    const cdnHostname = process.env.BUNNY_CDN_HOSTNAME;
    const expiry      = Math.floor(Date.now() / 1000) + 600; // 10 min TTL
    const path        = `/${libraryId}/${bunnyVideoId}/playlist.m3u8`;

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
 * Creates a new video record on Bunny Stream and returns the video GUID + TUS upload URL.
 * The admin frontend uses this to upload directly to Bunny — never through this server.
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
    return {
        videoId:   data.guid,
        uploadUrl: `https://video.bunnycdn.com/tusupload`,
        libraryId,
        apiKey,
    };
}

module.exports = { generateBunnyStreamUrl, createBunnyVideo };
