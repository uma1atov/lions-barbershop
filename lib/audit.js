/**
 * audit.js — Append-only audit log writer
 * Records who did what, when, from which IP
 */
const { readJSON, writeJSON, FILES, genId } = require("./db");

const MAX_AUDIT_ENTRIES = 10000;

/**
 * Write an audit log entry
 * @param {Object} params
 * @param {string} params.actorUserId - ID of the user performing the action
 * @param {string} params.action - Action name (e.g., 'user.login', 'booking.create')
 * @param {string} [params.entityType] - Entity type ('user', 'booking', 'barber', etc.)
 * @param {string} [params.entityId] - Entity ID
 * @param {Object} [params.meta] - Additional metadata
 * @param {string} [params.ip] - Request IP address
 */
function logAudit({ actorUserId, action, entityType, entityId, meta, ip }) {
  try {
    const logs = readJSON(FILES.audit_logs);

    logs.push({
      id: genId(),
      actor_user_id: actorUserId || null,
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      meta_json: meta || {},
      ip: ip || null,
      created_at: new Date().toISOString(),
    });

    // Trim old entries to prevent file growth
    if (logs.length > MAX_AUDIT_ENTRIES) {
      logs.splice(0, logs.length - MAX_AUDIT_ENTRIES);
    }

    writeJSON(FILES.audit_logs, logs);
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
}

/**
 * Get audit logs with optional filters
 * @param {Object} [filters]
 * @param {string} [filters.actorUserId]
 * @param {string} [filters.action]
 * @param {string} [filters.entityType]
 * @param {string} [filters.from] - ISO date
 * @param {string} [filters.to] - ISO date
 * @param {number} [filters.limit=100]
 * @param {number} [filters.offset=0]
 */
function getAuditLogs(filters = {}) {
  let logs = readJSON(FILES.audit_logs);

  if (filters.actorUserId) {
    logs = logs.filter((l) => l.actor_user_id === filters.actorUserId);
  }
  if (filters.action) {
    logs = logs.filter((l) => l.action.includes(filters.action));
  }
  if (filters.entityType) {
    logs = logs.filter((l) => l.entity_type === filters.entityType);
  }
  if (filters.from) {
    logs = logs.filter((l) => l.created_at >= filters.from);
  }
  if (filters.to) {
    logs = logs.filter((l) => l.created_at <= filters.to);
  }

  // Sort newest first
  logs.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const total = logs.length;
  const offset = filters.offset || 0;
  const limit = filters.limit || 100;
  const items = logs.slice(offset, offset + limit);

  return { items, total, offset, limit };
}

module.exports = { logAudit, getAuditLogs };
