/**
 * review.routes.js — Reviews + Loyalty Points System
 *
 * Points rules:
 *   - 1 point per completed booking (auto)
 *   - 1 point per review
 *   - 1 point = 10% discount
 *   - 5 points = 50% discount (max)
 *   - Points are spent when discount is applied
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId } = require("../lib/db");
const { authenticate } = require("../middleware/authenticate");
const { logAudit } = require("../lib/audit");

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

  // Award 1 point for review
  const users = readJSON(FILES.users);
  const userIdx = users.findIndex((u) => u.id === req.user.id);
  if (userIdx !== -1) {
    if (!users[userIdx].points) users[userIdx].points = 0;
    if (!users[userIdx].points_history) users[userIdx].points_history = [];
    users[userIdx].points += 1;
    users[userIdx].points_history.push({
      type: "review",
      amount: 1,
      review_id: review.id,
      date: new Date().toISOString(),
    });
    writeJSON(FILES.users, users);
  }

  res.json({ ok: true, review, points_earned: 1 });
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
  const users = readJSON(FILES.users);
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });

  const points = user.points || 0;
  const discount_percent = Math.min(points * 10, 50);
  const history = (user.points_history || []).slice(-20).reverse();

  res.json({
    points,
    discount_percent,
    max_discount: 50,
    points_for_max: 5,
    history,
  });
});

// ─── POST /api/reviews/spend-points — Use points ───
router.post("/spend-points", authenticate, (req, res) => {
  const { points_to_spend } = req.body;
  if (!points_to_spend || points_to_spend < 1) {
    return res.status(400).json({ error: "Укажите количество баллов" });
  }

  const users = readJSON(FILES.users);
  const userIdx = users.findIndex((u) => u.id === req.user.id);
  if (userIdx === -1) return res.status(404).json({ error: "Пользователь не найден" });

  const user = users[userIdx];
  const currentPoints = user.points || 0;
  const spend = Math.min(points_to_spend, currentPoints, 5); // max 5 = 50%

  if (spend < 1) {
    return res.status(400).json({ error: "Недостаточно баллов" });
  }

  users[userIdx].points = currentPoints - spend;
  if (!users[userIdx].points_history) users[userIdx].points_history = [];
  users[userIdx].points_history.push({
    type: "spent",
    amount: -spend,
    discount_percent: spend * 10,
    date: new Date().toISOString(),
  });
  writeJSON(FILES.users, users);

  res.json({
    ok: true,
    points_spent: spend,
    discount_percent: spend * 10,
    points_remaining: users[userIdx].points,
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
