/**
 * admin.routes.js — User management, Admin CRUD, Audit, Settings, Blacklist
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId, getSettings, readSettings } = require("../lib/db");
const { hashPassword, generateOTP } = require("../lib/auth");
const { logAudit, getAuditLogs } = require("../lib/audit");
const { ROLES, isAdmin, isOwner } = require("../lib/rbac");
const { authenticate } = require("../middleware/authenticate");
const { authorize, can } = require("../middleware/authorize");

// ═══ USER MANAGEMENT ═══════════════════════════════

// ─── GET /api/admin/users ──────────────────────────
// Admin: list all users (without passwords)
router.get("/users", authenticate, can("users:list"), (req, res) => {
  const users = readJSON(FILES.users).map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email || null,
    role: u.role,
    is_active: u.is_active,
    is_blacklisted: u.is_blacklisted || false,
    points: u.points || 0,
    last_login_at: u.last_login_at,
    created_at: u.created_at || u.createdAt,
  }));
  res.json(users);
});

// ─── PATCH /api/admin/users/:id/block ──────────────
// Admin: block/unblock user
router.patch("/users/:id/block", authenticate, can("users:block"), (req, res, next) => {
  try {
    const { is_active } = req.body;
    const users = readJSON(FILES.users);
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Пользователь не найден" });

    // Prevent blocking owner_admin
    if (users[idx].role === ROLES.OWNER_ADMIN && req.user.role !== ROLES.OWNER_ADMIN) {
      return res.status(403).json({ error: "Нельзя заблокировать владельца" });
    }
    // Prevent self-block
    if (users[idx].id === req.user.id) {
      return res.status(400).json({ error: "Нельзя заблокировать свой аккаунт" });
    }

    users[idx].is_active = is_active !== undefined ? !!is_active : !users[idx].is_active;
    users[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.users, users);

    logAudit({
      actorUserId: req.user.id,
      action: users[idx].is_active ? "user.unblock" : "user.block",
      entityType: "user",
      entityId: req.params.id,
      ip: req.ip,
    });

    res.json({
      id: users[idx].id,
      name: users[idx].name,
      is_active: users[idx].is_active,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/users/:id ────────────────────
// Admin: permanently delete user from database
router.delete("/users/:id", authenticate, can("users:block"), (req, res, next) => {
  try {
    const users = readJSON(FILES.users);
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Пользователь не найден" });

    // Prevent self-delete
    if (users[idx].id === req.user.id) {
      return res.status(400).json({ error: "Нельзя удалить свой аккаунт" });
    }

    const deleted = users.splice(idx, 1)[0];
    writeJSON(FILES.users, users);

    logAudit({
      actorUserId: req.user.id,
      action: "user.delete",
      entityType: "user",
      entityId: req.params.id,
      details: { name: deleted.name, phone: deleted.phone, role: deleted.role },
      ip: req.ip,
    });

    res.json({ ok: true, message: "Пользователь удалён" });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/users/:id/role ────────────────
// Admin: change user role (admin, barber, client, owner_admin)
router.patch("/users/:id/role", authenticate, can("users:block"), (req, res, next) => {
  try {
    const { role } = req.body;
    const validRoles = [ROLES.CLIENT, ROLES.BARBER, ROLES.ADMIN, ROLES.OWNER_ADMIN];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: "Некорректная роль. Допустимые: client, barber, admin, owner_admin" });
    }

    // Only owner can assign owner_admin role
    if (role === ROLES.OWNER_ADMIN && req.user.role !== ROLES.OWNER_ADMIN) {
      return res.status(403).json({ error: "Только владелец может назначать владельцев" });
    }

    // Only owner can assign admin role
    if (role === ROLES.ADMIN && req.user.role !== ROLES.OWNER_ADMIN) {
      return res.status(403).json({ error: "Только владелец может назначать админов" });
    }

    const users = readJSON(FILES.users);
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Пользователь не найден" });

    // Prevent changing own role
    if (users[idx].id === req.user.id) {
      return res.status(400).json({ error: "Нельзя изменить свою роль" });
    }

    const oldRole = users[idx].role;
    users[idx].role = role;
    users[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.users, users);

    logAudit({
      actorUserId: req.user.id,
      action: "user.role_change",
      entityType: "user",
      entityId: req.params.id,
      details: { name: users[idx].name, from: oldRole, to: role },
      ip: req.ip,
    });

    res.json({ ok: true, id: users[idx].id, name: users[idx].name, role: users[idx].role });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/users/:id/reset-password ──────
// Admin: reset user's password (generates temp password)
router.post("/users/:id/reset-password", authenticate, can("users:reset_password"), async (req, res, next) => {
  try {
    const users = readJSON(FILES.users);
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Пользователь не найден" });

    // Generate temporary password
    const tempPassword = generateOTP() + generateOTP(); // 12 digits
    users[idx].password = await hashPassword(tempPassword);
    users[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.users, users);

    logAudit({
      actorUserId: req.user.id,
      action: "user.admin_reset_password",
      entityType: "user",
      entityId: req.params.id,
      ip: req.ip,
    });

    res.json({
      ok: true,
      temp_password: tempPassword,
      message: "Передайте временный пароль пользователю. При входе рекомендуйте сменить пароль.",
    });
  } catch (err) {
    next(err);
  }
});

// ═══ ADMIN MANAGEMENT (OWNER_ADMIN ONLY) ═══════════

// ─── POST /api/admin/create-admin ──────────────────
// Owner: create new admin account
router.post("/create-admin", authenticate, can("admins:create"), async (req, res, next) => {
  try {
    const { name, phone, password, email, role } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ error: "Укажите имя, телефон и пароль" });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: "Пароль минимум 4 символа" });
    }

    const targetRole = role === ROLES.OWNER_ADMIN ? ROLES.OWNER_ADMIN : ROLES.ADMIN;
    const settings = getSettings();

    // Check limits
    const users = readJSON(FILES.users);
    if (targetRole === ROLES.OWNER_ADMIN) {
      const ownerCount = users.filter((u) => u.role === ROLES.OWNER_ADMIN).length;
      if (ownerCount >= (settings.max_owner_admins || 2)) {
        return res.status(400).json({ error: `Максимум ${settings.max_owner_admins || 2} владельца` });
      }
    } else {
      const adminCount = users.filter((u) => u.role === ROLES.ADMIN || u.role === ROLES.OWNER_ADMIN).length;
      if (adminCount >= (settings.max_admins || 3)) {
        return res.status(400).json({ error: `Максимум ${settings.max_admins || 3} администраторов` });
      }
    }

    // Check phone uniqueness
    if (users.find((u) => u.phone === phone)) {
      return res.status(409).json({ error: "Этот номер уже зарегистрирован" });
    }
    if (email && users.find((u) => u.email === email)) {
      return res.status(409).json({ error: "Этот email уже зарегистрирован" });
    }

    const hashedPw = await hashPassword(password);
    const user = {
      id: genId(),
      name,
      phone,
      email: email || null,
      password: hashedPw,
      role: targetRole,
      is_active: true,
      is_blacklisted: false,
      last_login_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    users.push(user);
    writeJSON(FILES.users, users);

    logAudit({
      actorUserId: req.user.id,
      action: "admin.create",
      entityType: "user",
      entityId: user.id,
      meta: { role: targetRole, name },
      ip: req.ip,
    });

    res.json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/admins/:id ──────────────────
// Owner: delete admin account
router.delete("/admins/:id", authenticate, can("admins:delete"), (req, res, next) => {
  try {
    const users = readJSON(FILES.users);
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Пользователь не найден" });

    if (!isAdmin(users[idx].role)) {
      return res.status(400).json({ error: "Пользователь не является администратором" });
    }
    if (users[idx].id === req.user.id) {
      return res.status(400).json({ error: "Нельзя удалить свой аккаунт" });
    }

    // Demote to client instead of hard delete
    users[idx].role = ROLES.CLIENT;
    users[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.users, users);

    logAudit({
      actorUserId: req.user.id,
      action: "admin.demote",
      entityType: "user",
      entityId: req.params.id,
      ip: req.ip,
    });

    res.json({ ok: true, message: "Администратор понижен до клиента" });
  } catch (err) {
    next(err);
  }
});

// ═══ AUDIT LOGS ════════════════════════════════════

// ─── GET /api/admin/audit-logs ─────────────────────
router.get("/audit-logs", authenticate, can("audit:view"), (req, res) => {
  const { action, from, to, limit, offset } = req.query;
  const result = getAuditLogs({
    action,
    from,
    to,
    limit: parseInt(limit) || 100,
    offset: parseInt(offset) || 0,
  });
  res.json(result);
});

// ─── GET /api/admin/audit-logs/export ──────────────
// Export audit logs as CSV
router.get("/audit-logs/export", authenticate, can("audit:export"), (req, res) => {
  const { from, to } = req.query;
  const result = getAuditLogs({ from, to, limit: 10000 });

  // BOM for Excel compatibility with Cyrillic
  const BOM = "\uFEFF";
  const header = "ID;Дата;Действие;Пользователь;Тип;ID сущности;IP\n";
  const rows = result.items
    .map(
      (l) =>
        `${l.id};${l.created_at};${l.action};${l.actor_user_id || ""};${l.entity_type || ""};${l.entity_id || ""};${l.ip || ""}`
    )
    .join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${new Date().toISOString().split("T")[0]}.csv"`);
  res.send(BOM + header + rows);
});

// ═══ SETTINGS (OWNER_ADMIN ONLY) ═══════════════════

// ─── GET /api/admin/settings ───────────────────────
router.get("/settings", authenticate, can("settings:manage"), (req, res) => {
  res.json(getSettings());
});

// ─── PATCH /api/admin/settings ─────────────────────
router.patch("/settings", authenticate, can("settings:manage"), (req, res, next) => {
  try {
    const current = readSettings();
    const allowed = [
      "max_admins", "max_owner_admins",
      "min_booking_lead_minutes", "work_start_hour", "work_end_hour",
      "day_off", "discount_registered_percent", "booking_slot_step_minutes",
      "shop_name", "shop_address", "shop_phone", "holidays",
      "points_per_booking", "points_per_review", "points_max_cap",
      "points_max_spend_per_booking", "points_value_percent",
      "points_expiration_days", "points_expiration_warning_days",
    ];

    const changes = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        current[key] = req.body[key];
        changes[key] = req.body[key];
      }
    });

    writeJSON(FILES.settings, current);

    logAudit({
      actorUserId: req.user.id,
      action: "settings.update",
      entityType: "settings",
      entityId: "global",
      meta: changes,
      ip: req.ip,
    });

    res.json(getSettings());
  } catch (err) {
    next(err);
  }
});

// ═══ BLACKLIST ═════════════════════════════════════

// ─── GET /api/admin/blacklist ──────────────────────
router.get("/blacklist", authenticate, can("blacklist:manage"), (req, res) => {
  res.json(readJSON(FILES.blacklist));
});

// ─── POST /api/admin/blacklist ─────────────────────
router.post("/blacklist", authenticate, can("blacklist:manage"), (req, res, next) => {
  try {
    const { phone, user_id, reason } = req.body;
    if (!phone && !user_id) {
      return res.status(400).json({ error: "Укажите телефон или ID пользователя" });
    }

    const blacklist = readJSON(FILES.blacklist);

    // Check if already blacklisted
    if (phone && blacklist.find((b) => b.phone === phone && b.is_active)) {
      return res.status(409).json({ error: "Этот номер уже в чёрном списке" });
    }

    const entry = {
      id: genId(),
      phone: phone || null,
      user_id: user_id || null,
      reason: reason || "",
      is_active: true,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    };

    blacklist.push(entry);
    writeJSON(FILES.blacklist, blacklist);

    // Also mark user as blacklisted
    if (user_id) {
      const users = readJSON(FILES.users);
      const userIdx = users.findIndex((u) => u.id === user_id);
      if (userIdx !== -1) {
        users[userIdx].is_blacklisted = true;
        users[userIdx].updated_at = new Date().toISOString();
        writeJSON(FILES.users, users);
      }
    }

    logAudit({
      actorUserId: req.user.id,
      action: "blacklist.add",
      entityType: "blacklist",
      entityId: entry.id,
      meta: { phone, user_id, reason },
      ip: req.ip,
    });

    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/blacklist/:id ───────────────
router.delete("/blacklist/:id", authenticate, can("blacklist:manage"), (req, res, next) => {
  try {
    const blacklist = readJSON(FILES.blacklist);
    const idx = blacklist.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Запись не найдена" });

    // Soft-deactivate
    blacklist[idx].is_active = false;
    writeJSON(FILES.blacklist, blacklist);

    // Remove blacklist flag from user
    if (blacklist[idx].user_id) {
      const users = readJSON(FILES.users);
      const userIdx = users.findIndex((u) => u.id === blacklist[idx].user_id);
      if (userIdx !== -1) {
        users[userIdx].is_blacklisted = false;
        users[userIdx].updated_at = new Date().toISOString();
        writeJSON(FILES.users, users);
      }
    }

    logAudit({
      actorUserId: req.user.id,
      action: "blacklist.remove",
      entityType: "blacklist",
      entityId: req.params.id,
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ═══ POINTS MANAGEMENT ═══════════════════════════

// ─── POST /api/admin/users/:id/points/give ──────
router.post("/users/:id/points/give", authenticate, can("users:list"), (req, res, next) => {
  try {
    const { amount, reason } = req.body;
    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Укажите количество баллов (>0)" });
    }
    const { adminGivePoints } = require("../lib/points");
    const result = adminGivePoints(req.params.id, +amount, req.user.id, reason);
    if (!result) return res.status(404).json({ error: "Пользователь не найден" });

    logAudit({
      actorUserId: req.user.id,
      action: "points.admin_give",
      entityType: "user",
      entityId: req.params.id,
      meta: { amount: +amount, reason },
      ip: req.ip,
    });

    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/users/:id/points/take ──────
router.post("/users/:id/points/take", authenticate, can("users:list"), (req, res, next) => {
  try {
    const { amount, reason } = req.body;
    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Укажите количество баллов (>0)" });
    }
    const { adminTakePoints } = require("../lib/points");
    const result = adminTakePoints(req.params.id, +amount, req.user.id, reason);
    if (!result) return res.status(404).json({ error: "Пользователь не найден" });

    logAudit({
      actorUserId: req.user.id,
      action: "points.admin_take",
      entityType: "user",
      entityId: req.params.id,
      meta: { amount: +amount, reason },
      ip: req.ip,
    });

    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

module.exports = router;
