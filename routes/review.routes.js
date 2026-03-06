/**
 * review.routes.js — Reviews + Loyalty Points System
 *
 * Points rules are configurable via admin settings.
 * All points logic is centralized in lib/points.js
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId, getSettings } = require("../lib/db");
const { authenticate } = require("../middleware/authenticate");
const { logAudit } = require("../lib/audit");
const { earnPoints, getUserPoints } = require("../lib/points");

// ─── GET /api/reviews — Public: approved reviews ───
router.get("/", (_req, res) => {
  const reviews = readJSON(FILES.reviews)
    .filter((r) => r.status === "approved")
    .map((r) => ({
      id: r.id,
      client_name: r.client_name,
      barber_name: r.barber_name,
      rating: r.rating,
      text: r.text,
      created_at: r.created_at,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(reviews);
});

// ─── POST /api/reviews — Client: leave a review ────
router.post("/", authenticate, (req, res) => {
  if (req.user.role !== "client") {
    return res.status(403).json({ error: "Только клиенты могут оставлять отзывы" });
  }

  const { booking_id, rating, text } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Оценка должна быть от 1 до 5" });
  }
  if (!text || text.trim().length < 3) {
    return res.status(400).json({ error: "Напишите отзыв (минимум 3 символа)" });
  }

  const reviews = readJSON(FILES.reviews);

  // Check if already reviewed this booking (if booking_id provided)
  if (booking_id) {
    const existing = reviews.find(
      (r) => r.booking_id === booking_id && r.user_id === req.user.id
    );
    if (existing) {
      return res.status(400).json({ error: "Вы уже оставили отзыв к этой записи" });
    }
  }

  // Get booking info if provided
  let barber_name = req.body.barber_name || "";
  let service_name = "";
  if (booking_id) {
    const bookings = readJSON(FILES.bookings);
    const booking = bookings.find((b) => b.id === booking_id);
    if (booking) {
      barber_name = booking.barber_name || booking.master || barber_name;
      service_name = booking.service_name || booking.service || "";
    }
  }

  const review = {
    id: genId(),
    user_id: req.user.id,
    client_name: req.user.name,
    client_phone: req.user.phone,
    booking_id: booking_id || null,
    barber_name,
    service_name,
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    text: text.trim(),
    status: "approved", // auto-approve, admin can hide
    created_at: new Date().toISOString(),
  };

  reviews.push(review);
  writeJSON(FILES.reviews, reviews);

  // Award points for review (configurable)
  const settings = getSettings();
  const pointsAmount = settings.points_per_review || 1;
  const result = earnPoints(req.user.id, {
    type: "review",
    amount: pointsAmount,
    review_id: review.id,
  });

  res.json({ ok: true, review, points_earned: result ? result.pointsEarned : 0 });
});

// ─── GET /api/reviews/my — Client: my reviews ──────
router.get("/my", authenticate, (req, res) => {
  const reviews = readJSON(FILES.reviews)
    .filter((r) => r.user_id === req.user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(reviews);
});

// ─── GET /api/reviews/my-points — Client: points ───
router.get("/my-points", authenticate, (req, res) => {
  const data = getUserPoints(req.user.id);
  if (!data) return res.status(404).json({ error: "Пользователь не найден" });

  const settings = getSettings();
  const maxSpend = settings.points_max_spend_per_booking || 5;
  const valuePercent = settings.points_value_percent || 10;
  const maxDiscount = maxSpend * valuePercent;

  res.json({
    points: data.activePoints,
    expiring_points: data.expiringPoints,
    expiring_days: data.expiringDays,
    discount_per_point: valuePercent,
    max_spend_per_booking: maxSpend,
    max_discount: maxDiscount,
    points_max_cap: settings.points_max_cap || 10,
    points_per_booking: settings.points_per_booking || 1,
    points_per_review: settings.points_per_review || 1,
    history: data.history,
  });
});

// ─── POST /api/reviews/spend-points — Disabled ──────
// Points can only be spent during booking now
router.post("/spend-points", authenticate, (_req, res) => {
  res.status(400).json({
    error: "Баллы можно потратить только при создании записи на стрижку",
  });
});

// ─── ADMIN: GET all reviews ─────────────────────────
router.get("/admin", authenticate, (req, res) => {
  if (!["admin", "owner_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  const reviews = readJSON(FILES.reviews).sort(
    (a, b) => b.created_at.localeCompare(a.created_at)
  );
  res.json(reviews);
});

// ─── ADMIN: PATCH review status ─────────────────────
router.patch("/admin/:id", authenticate, (req, res) => {
  if (!["admin", "owner_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  const { status } = req.body;
  if (!["approved", "hidden"].includes(status)) {
    return res.status(400).json({ error: "Статус: approved или hidden" });
  }

  const reviews = readJSON(FILES.reviews);
  const idx = reviews.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Отзыв не найден" });

  reviews[idx].status = status;
  reviews[idx].updated_at = new Date().toISOString();
  writeJSON(FILES.reviews, reviews);

  logAudit({
    actorUserId: req.user.id,
    action: `review.${status}`,
    entityType: "review",
    entityId: req.params.id,
    ip: req.ip,
  });

  res.json({ ok: true });
});

// ─── ADMIN: DELETE review ───────────────────────────
router.delete("/admin/:id", authenticate, (req, res) => {
  if (!["admin", "owner_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  const reviews = readJSON(FILES.reviews);
  const idx = reviews.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Отзыв не найден" });

  reviews.splice(idx, 1);
  writeJSON(FILES.reviews, reviews);

  res.json({ ok: true });
});

module.exports = router;
