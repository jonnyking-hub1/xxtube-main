require('dotenv').config();

/**
 * Given a Telegram file_id, asks Telegram for the file's current download path
 * and returns the full download URL. This URL embeds the bot token and expires/
 * changes over time, so it must only ever be used server-side to fetch bytes —
 * never sent directly to a browser.
 */
async function getTelegramFileUrl(fileId) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const data = await res.json();

    if (!data.ok) {
        throw new Error(`Telegram getFile failed: ${data.description || res.status}`);
    }

    return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}

module.exports = { getTelegramFileUrl };
