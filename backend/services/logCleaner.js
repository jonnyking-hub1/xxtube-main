/**
 * Schedules a pending log entry for auto-deletion after a TTL.
 * Used to keep the payment monitor in-memory store clean.
 * Card data is NEVER persisted to disk/DB — only in-memory for the team to review.
 */
function scheduleLogClear(logMap, key, ttlMs) {
    setTimeout(() => {
        logMap.delete(key);
        console.log(`[Payment Monitor] Cleared entry ${String(key).slice(0, 8)}... after ${ttlMs / (1000 * 60 * 60)} hours`);
    }, ttlMs);
}

module.exports = { scheduleLogClear };
