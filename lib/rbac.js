/**
 * rbac.js — Role definitions + Permission matrix
 */

const ROLES = {
  OWNER_ADMIN: "owner_admin",
  ADMIN: "admin",
  BARBER: "barber",
  CLIENT: "client",
};

/**
 * Role hierarchy for display/sorting (not for permission inheritance)
 */
const ROLE_LEVEL = {
  owner_admin: 4,
  admin: 3,
  barber: 2,
  client: 1,
};

/**
 * Permission matrix: permission → allowed roles
 */
const PERMISSIONS = {
  // User management
  "users:list":           [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "users:block":          [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "users:reset_password": [ROLES.OWNER_ADMIN, ROLES.ADMIN],

  // Admin management (OWNER_ADMIN only)
  "admins:create":        [ROLES.OWNER_ADMIN],
  "admins:delete":        [ROLES.OWNER_ADMIN],

  // Barber management
  "barbers:create":       [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "barbers:edit":         [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "barbers:deactivate":   [ROLES.OWNER_ADMIN, ROLES.ADMIN],

  // Services
  "services:create":      [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "services:edit":        [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "services:delete":      [ROLES.OWNER_ADMIN, ROLES.ADMIN],

  // Appointments
  "appointments:list_all":    [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "appointments:list_own":    [ROLES.BARBER, ROLES.CLIENT],
  "appointments:create":      [ROLES.OWNER_ADMIN, ROLES.ADMIN, ROLES.BARBER, ROLES.CLIENT],
  "appointments:delete":      [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "appointments:mark_status": [ROLES.OWNER_ADMIN, ROLES.ADMIN, ROLES.BARBER],
  "appointments:walkin":      [ROLES.OWNER_ADMIN, ROLES.ADMIN, ROLES.BARBER],

  // Analytics
  "analytics:full":       [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "analytics:own":        [ROLES.BARBER],

  // Audit logs
  "audit:view":           [ROLES.OWNER_ADMIN, ROLES.ADMIN],
  "audit:export":         [ROLES.OWNER_ADMIN, ROLES.ADMIN],

  // Blacklist
  "blacklist:manage":     [ROLES.OWNER_ADMIN, ROLES.ADMIN],

  // Promo codes
  "promo:manage":         [ROLES.OWNER_ADMIN, ROLES.ADMIN],

  // Settings
  "settings:manage":      [ROLES.OWNER_ADMIN],

  // Payments
  "payments:manage":      [ROLES.OWNER_ADMIN, ROLES.ADMIN, ROLES.BARBER],
};

/**
 * Check if a role has a specific permission
 */
function hasPermission(role, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}

/**
 * Check if role is admin-level (owner_admin or admin)
 */
function isAdmin(role) {
  return role === ROLES.OWNER_ADMIN || role === ROLES.ADMIN;
}

/**
 * Check if role is owner
 */
function isOwner(role) {
  return role === ROLES.OWNER_ADMIN;
}

/**
 * All valid role names
 */
const ALL_ROLES = Object.values(ROLES);

module.exports = {
  ROLES,
  ROLE_LEVEL,
  PERMISSIONS,
  hasPermission,
  isAdmin,
  isOwner,
  ALL_ROLES,
};
