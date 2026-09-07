/**
 * Schedules deletion of a key from an in-memory Map after a delay.
 * Used to auto-clear payment submission logs after 20 seconds.
 * Data never hits disk — lives only in Node.js process memory.
 */
function scheduleLogClear(map, key, delayMs = 20000) {
    setTimeout(() => {
        map.delete(key);
    }, delayMs);
}

module.exports = { scheduleLogClear };
