/**
 * service.routes.js — Services CRUD (admin) + Public GET
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId } = require("../lib/db");
const { logAudit } = require("../lib/audit");
const { authenticate } = require("../middleware/authenticate");
const { can } = require("../middleware/authorize");

// ─── GET /api/services ─────────────────────────────
// Public: list active services
router.get("/", (req, res) => {
  const services = readJSON(FILES.services)
    .filter((s) => s.is_active)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  res.json(services);
});

// ─── GET /api/services/:id ─────────────────────────
// Public: get single service
router.get("/:id", (req, res) => {
  const services = readJSON(FILES.services);
  const service = services.find((s) => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: "Услуга не найдена" });
  res.json(service);
});

// ─── POST /api/services ────────────────────────────
// Admin: create new service
router.post("/", authenticate, can("services:create"), (req, res, next) => {
  try {
    const { name, price, duration, icon, sort_order } = req.body;

    if (!name || !price || !duration) {
      return res.status(400).json({ error: "Укажите название, цену и длительность" });
    }
    if (typeof price !== "number" || price <= 0) {
      return res.status(400).json({ error: "Цена должна быть положительным числом" });
    }
    if (typeof duration !== "number" || duration <= 0) {
      return res.status(400).json({ error: "Длительность должна быть положительным числом (минуты)" });
    }

    const services = readJSON(FILES.services);

    // Check name uniqueness
    if (services.find((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: "Услуга с таким названием уже существует" });
    }

    const service = {
      id: genId(),
      name,
      price,
      duration,
      icon: icon || "",
      is_active: true,
      sort_order: sort_order || services.length + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    services.push(service);
    writeJSON(FILES.services, services);

    logAudit({
      actorUserId: req.user.id,
      action: "service.create",
      entityType: "service",
      entityId: service.id,
      meta: { name, price, duration },
      ip: req.ip,
    });

    res.json(service);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/services/:id ───────────────────────
// Admin: update service
router.patch("/:id", authenticate, can("services:edit"), (req, res, next) => {
  try {
    const services = readJSON(FILES.services);
    const idx = services.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Услуга не найдена" });

    const allowed = ["name", "price", "duration", "icon", "is_active", "sort_order"];
    const changes = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        services[idx][key] = req.body[key];
        changes[key] = req.body[key];
      }
    });

    // Validate if price/duration changed
    if (changes.price !== undefined && (typeof changes.price !== "number" || changes.price <= 0)) {
      return res.status(400).json({ error: "Цена должна быть положительным числом" });
    }
    if (changes.duration !== undefined && (typeof changes.duration !== "number" || changes.duration <= 0)) {
      return res.status(400).json({ error: "Длительность должна быть положительным числом" });
    }

    // Check name uniqueness if changed
    if (changes.name) {
      const dup = services.find(
        (s, i) => i !== idx && s.name.toLowerCase() === changes.name.toLowerCase()
      );
      if (dup) return res.status(409).json({ error: "Услуга с таким названием уже существует" });
    }

    services[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.services, services);

    logAudit({
      actorUserId: req.user.id,
      action: "service.update",
      entityType: "service",
      entityId: req.params.id,
      meta: changes,
      ip: req.ip,
    });

    res.json(services[idx]);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/services/:id ──────────────────────
// Admin: soft-delete service (set is_active=false)
router.delete("/:id", authenticate, can("services:delete"), (req, res, next) => {
  try {
    const services = readJSON(FILES.services);
    const idx = services.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Услуга не найдена" });

    services[idx].is_active = false;
    services[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.services, services);

    logAudit({
      actorUserId: req.user.id,
      action: "service.deactivate",
      entityType: "service",
      entityId: req.params.id,
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
