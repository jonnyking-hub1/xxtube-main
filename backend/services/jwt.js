const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET = process.env.JWT_SECRET;
const EXPIRY = '30d'; // Cookie lives 30 days

function signJWT(payload) {
    return jwt.sign(payload, SECRET, { expiresIn: EXPIRY });
}

function verifyJWT(token) {
    try {
        return jwt.verify(token, SECRET);
    } catch (e) {
        return null;
    }
}

module.exports = { signJWT, verifyJWT };
