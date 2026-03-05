/**
 * promo.routes.js — Promo codes CRUD + public validation
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId } = require("../lib/db");
const { logAudit } = require("../lib/audit");
const { authenticate } = require("../middleware/authenticate");
const { optionalAuth } = require("../middleware/authenticate");
const { can } = require("../middleware/authorize");

// ═══ ADMIN PROMO MANAGEMENT ════════════════════════

// ─── GET /api/admin/promo-codes ────────────────────
router.get("/admin", authenticate, can("promo:manage"), (req, res) => {
  res.json(readJSON(FILES.promo_codes));
});

// ─── POST /api/admin/promo-codes ───────────────────
router.post("/admin", authenticate, can("promo:manage"), (req, res, next) => {
  try {
    const { code, discount_percent, max_uses, expires_at, description } = req.body;

    if (!code || !discount_percent) {
      return res.status(400).json({ error: "Укажите код и процент скидки" });
    }
    if (discount_percent <= 0 || discount_percent > 50) {
      return res.status(400).json({ error: "Скидка от 1% до 50%" });
    }

    const promoCodes = readJSON(FILES.promo_codes);

    // Check uniqueness (case-insensitive)
    if (promoCodes.find((p) => p.code.toLowerCase() === code.toLowerCase())) {
      return res.status(409).json({ error: "Промокод с таким кодом уже существует" });
    }

    const promo = {
      id: genId(),
      code: code.toUpperCase(),
      discount_percent,
      max_uses: max_uses || null,
      used_count: 0,
      expires_at: expires_at || null,
      description: description || "",
      is_active: true,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    promoCodes.push(promo);
    writeJSON(FILES.promo_codes, promoCodes);

    logAudit({
      actorUserId: req.user.id,
      action: "promo.create",
      entityType: "promo_code",
      entityId: promo.id,
      meta: { code: promo.code, discount_percent },
      ip: req.ip,
    });

    res.json(promo);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/promo-codes/:id ──────────────
router.patch("/admin/:id", authenticate, can("promo:manage"), (req, res, next) => {
  try {
    const promoCodes = readJSON(FILES.promo_codes);
    const idx = promoCodes.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Промокод не найден" });

    const allowed = ["code", "discount_percent", "max_uses", "expires_at", "description", "is_active"];
    const changes = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        promoCodes[idx][key] = req.body[key];
        changes[key] = req.body[key];
      }
    });

    // Validate discount
    if (changes.discount_percent !== undefined) {
      if (changes.discount_percent <= 0 || changes.discount_percent > 50) {
        return res.status(400).json({ error: "Скидка от 1% до 50%" });
      }
    }

    // Uppercase code
    if (changes.code) {
      promoCodes[idx].code = changes.code.toUpperCase();
    }

    promoCodes[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.promo_codes, promoCodes);

    logAudit({
      actorUserId: req.user.id,
      action: "promo.update",
      entityType: "promo_code",
      entityId: req.params.id,
      meta: changes,
      ip: req.ip,
    });

    res.json(promoCodes[idx]);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/promo-codes/:id ─────────────
router.delete("/admin/:id", authenticate, can("promo:manage"), (req, res, next) => {
  try {
    const promoCodes = readJSON(FILES.promo_codes);
    const idx = promoCodes.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Промокод не найден" });

    promoCodes[idx].is_active = false;
    promoCodes[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.promo_codes, promoCodes);

    logAudit({
      actorUserId: req.user.id,
      action: "promo.deactivate",
      entityType: "promo_code",
      entityId: req.params.id,
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ═══ PUBLIC PROMO VALIDATION ═══════════════════════

// ─── POST /api/promo-codes/validate ────────────────
// Public: check if promo code is valid
router.post("/validate", optionalAuth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Укажите промокод" });

  const promoCodes = readJSON(FILES.promo_codes);
  const promo = promoCodes.find(
    (p) => p.code.toLowerCase() === code.toLowerCase() && p.is_active
  );

  if (!promo) {
    return res.status(404).json({ valid: false, error: "Промокод не найден" });
  }

  // Check expiration
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return res.json({ valid: false, error: "Промокод истёк" });
  }

  // Check usage limit
  if (promo.max_uses && promo.used_count >= promo.max_uses) {
    return res.json({ valid: false, error: "Промокод исчерпан" });
  }

  res.json({
    valid: true,
    code: promo.code,
    discount_percent: promo.discount_percent,
    description: promo.description,
  });
});

module.exports = router;
