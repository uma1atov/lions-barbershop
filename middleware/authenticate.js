/**
 * authenticate.js — JWT verification middleware
 * Replaces old in-memory session-based auth
 */
const { verifyToken } = require("../lib/auth");
const { readJSON, FILES } = require("../lib/db");

/**
 * Required authentication middleware
 * Verifies JWT token and attaches user to req.user
 * Returns 401 if no token or invalid/expired
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Не авторизован" });
  }

  try {
    const token = header.replace("Bearer ", "");
    const decoded = verifyToken(token);

    // Verify user still exists and is active
    const users = readJSON(FILES.users);
    const user = users.find((u) => u.id === decoded.id);

    if (!user) {
      return res.status(401).json({ error: "Пользователь не найден" });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: "Аккаунт заблокирован" });
    }

    // Attach sanitized user to request
    req.user = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email || null,
      role: user.role,
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Токен истёк, войдите заново" });
    }
    return res.status(401).json({ error: "Недействительный токен" });
  }
}

/**
 * Optional authentication middleware
 * Sets req.user if valid token present, but doesn't block
 * Useful for endpoints that work differently for logged-in users (e.g., booking with discount)
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const token = header.replace("Bearer ", "");
    const decoded = verifyToken(token);
    const users = readJSON(FILES.users);
    const user = users.find((u) => u.id === decoded.id);

    if (user && user.is_active) {
      req.user = {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email || null,
        role: user.role,
      };
    } else {
      req.user = null;
    }
  } catch {
    req.user = null;
  }

  next();
}

module.exports = { authenticate, optionalAuth };
