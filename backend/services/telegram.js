require('dotenv').config();

/**
 * Fallback for environments without a real Telegram bot token or Postgres DB.
 * Uses a public sample MP4 so the player still works in local demos and previews.
 */
async function getTelegramFileUrl(fileId) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token || token === 'demo-token') {
        return 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const data = await res.json();

    if (!data.ok) {
        throw new Error(`Telegram getFile failed: ${data.description || res.status}`);
    }

    return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}

module.exports = { getTelegramFileUrl };
