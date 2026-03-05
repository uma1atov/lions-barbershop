/**
 * authorize.js — Role-based authorization middleware factory
 *
 * Usage:
 *   router.get('/admin/users', authenticate, authorize('owner_admin', 'admin'), handler)
 *   router.patch('/barber/me', authenticate, authorize('barber'), handler)
 *   router.get('/admin/settings', authenticate, can('settings:manage'), handler)
 */
const { PERMISSIONS } = require("../lib/rbac");

/**
 * Authorize by explicit role list
 * @param {...string} allowedRoles - Roles that can access the route
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Не авторизован" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    next();
  };
}

/**
 * Authorize by permission name (from PERMISSIONS matrix)
 * @param {string} permission - Permission key (e.g., 'users:list', 'services:create')
 */
function can(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Не авторизован" });
    }
    const allowedRoles = PERMISSIONS[permission];
    if (!allowedRoles || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    next();
  };
}

module.exports = { authorize, can };
