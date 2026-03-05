/**
 * auth.js — Password hashing (bcrypt) + JWT token management
 * Supports opportunistic migration from plaintext to bcrypt
 */
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || "12", 10);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION_" + Date.now();
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "24h";

if (!process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET not set in .env — using auto-generated (sessions won't survive restart)");
}

/**
 * Hash a plaintext password with bcrypt
 */
async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 * Supports legacy plaintext: if hash doesn't start with $2 (bcrypt prefix),
 * it's treated as a plaintext password for migration purposes
 */
async function verifyPassword(plaintext, storedHash) {
  if (!storedHash) return false;
  // Legacy plaintext support (pre-migration)
  if (!storedHash.startsWith("$2")) {
    return plaintext === storedHash;
  }
  return bcrypt.compare(plaintext, storedHash);
}

/**
 * Check if a password is already hashed (bcrypt)
 */
function isHashed(password) {
  return password && password.startsWith("$2");
}

/**
 * Sign a JWT with user payload
 * @param {Object} payload - { id, role } minimum
 * @returns {string} JWT token
 */
function signToken(payload) {
  return jwt.sign(
    { id: payload.id, role: payload.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/**
 * Verify and decode a JWT
 * @param {string} token
 * @returns {Object} decoded payload
 * @throws {Error} if token is invalid or expired
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Generate a 6-digit OTP code for password recovery
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
  hashPassword,
  verifyPassword,
  isHashed,
  signToken,
  verifyToken,
  generateOTP,
};
