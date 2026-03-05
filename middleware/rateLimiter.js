/**
 * rateLimiter.js — Simple in-memory rate limiter
 * Protects login, OTP, and registration endpoints from brute force
 */

const attempts = new Map();

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts) {
    if (now >= record.resetAt) {
      attempts.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Create a rate limiter middleware
 * @param {Object} options
 * @param {Function|string} options.keyFn - Function(req) → string key, or 'ip' for IP-based
 * @param {number} options.maxAttempts - Max attempts before blocking
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {string} [options.message] - Custom error message
 */
function rateLimiter({ keyFn = "ip", maxAttempts = 10, windowMs = 15 * 60 * 1000, message } = {}) {
  return (req, res, next) => {
    const key = typeof keyFn === "function" ? keyFn(req) : req.ip;
    if (!key) return next();

    const prefixedKey = `rl:${key}`;
    const now = Date.now();
    const record = attempts.get(prefixedKey);

    // Check if blocked
    if (record && record.count >= maxAttempts && now < record.resetAt) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.set("Retry-After", retryAfter.toString());
      return res.status(429).json({
        error: message || "Слишком много попыток. Попробуйте позже.",
        retry_after_seconds: retryAfter,
      });
    }

    // Create or increment record
    if (!record || now >= record.resetAt) {
      attempts.set(prefixedKey, { count: 1, resetAt: now + windowMs });
    } else {
      record.count++;
    }

    next();
  };
}

/**
 * Pre-configured limiters for common use cases
 */

// Login: 10 attempts per 15 minutes per IP
const loginLimiter = rateLimiter({
  keyFn: "ip",
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  message: "Слишком много попыток входа. Подождите 15 минут.",
});

// Registration: 5 per hour per IP
const registerLimiter = rateLimiter({
  keyFn: "ip",
  maxAttempts: 5,
  windowMs: 60 * 60 * 1000,
  message: "Слишком много регистраций. Попробуйте позже.",
});

// Password reset request: 3 per 10 minutes per IP
const passwordResetLimiter = rateLimiter({
  keyFn: "ip",
  maxAttempts: 3,
  windowMs: 10 * 60 * 1000,
  message: "Слишком много запросов на сброс пароля. Подождите 10 минут.",
});

// OTP verification: 5 per 30 minutes per IP
const otpVerifyLimiter = rateLimiter({
  keyFn: "ip",
  maxAttempts: 5,
  windowMs: 30 * 60 * 1000,
  message: "Слишком много попыток. Подождите 30 минут.",
});

module.exports = {
  rateLimiter,
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  otpVerifyLimiter,
};
