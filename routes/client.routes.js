/**
 * client.routes.js — Client self-service: my bookings, stats, rebook
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId, getSettings } = require("../lib/db");
const { logAudit } = require("../lib/audit");
const { authenticate } = require("../middleware/authenticate");

// ─── GET /api/my-bookings ──────────────────────────
// Client: list own bookings
router.get("/my-bookings", authenticate, (req, res) => {
  const bookings = readJSON(FILES.bookings).filter(
    (b) =>
      b.phone === req.user.phone ||
      b.client_phone === req.user.phone ||
      b.userId === req.user.id ||
      b.client_user_id === req.user.id
  );

  // Sort by date desc
  bookings.sort((a, b) => {
    const dtA = (a.date || "") + "T" + (a.time || "");
    const dtB = (b.date || "") + "T" + (b.time || "");
    return dtB.localeCompare(dtA);
  });

  res.json(bookings);
});

// ─── GET /api/my-stats ─────────────────────────────
// Client: own statistics
router.get("/my-stats", authenticate, (req, res) => {
  const bookings = readJSON(FILES.bookings).filter(
    (b) =>
      (b.phone === req.user.phone ||
        b.client_phone === req.user.phone ||
        b.userId === req.user.id ||
        b.client_user_id === req.user.id) &&
      b.status === "completed"
  );

  const totalVisits = bookings.length;
  const totalSpent = bookings.reduce((sum, b) => sum + (b.price_final || 0), 0);
  const avgCheck = totalVisits > 0 ? Math.round(totalSpent / totalVisits) : 0;

  // Favorite service
  const serviceCounts = {};
  bookings.forEach((b) => {
    const sn = b.service_name || b.service;
    serviceCounts[sn] = (serviceCounts[sn] || 0) + 1;
  });
  const favoriteService = Object.entries(serviceCounts)
    .sort((a, b) => b[1] - a[1])[0];

  // Favorite barber
  const barberCounts = {};
  bookings.forEach((b) => {
    const bn = b.barber_name || b.master;
    if (bn && bn !== "любой свободный") {
      barberCounts[bn] = (barberCounts[bn] || 0) + 1;
    }
  });
  const favoriteBarber = Object.entries(barberCounts)
    .sort((a, b) => b[1] - a[1])[0];

  // Savings from discounts
  const totalSaved = bookings.reduce((sum, b) => {
    const orig = b.price_original || 0;
    const final = b.price_final || 0;
    return sum + (orig - final);
  }, 0);

  // Upcoming bookings count
  const now = new Date().toISOString().split("T")[0];
  const upcoming = readJSON(FILES.bookings).filter(
    (b) =>
      (b.phone === req.user.phone ||
        b.client_phone === req.user.phone ||
        b.userId === req.user.id ||
        b.client_user_id === req.user.id) &&
      b.status === "scheduled" &&
      b.date >= now
  ).length;

  res.json({
    total_visits: totalVisits,
    total_spent: totalSpent,
    avg_check: avgCheck,
    total_saved: totalSaved,
    upcoming_bookings: upcoming,
    favorite_service: favoriteService ? { name: favoriteService[0], count: favoriteService[1] } : null,
    favorite_barber: favoriteBarber ? { name: favoriteBarber[0], count: favoriteBarber[1] } : null,
  });
});

// ─── POST /api/my-bookings/:id/cancel ──────────────
// Client: cancel own upcoming booking
router.post("/my-bookings/:id/cancel", authenticate, (req, res, next) => {
  try {
    const bookings = readJSON(FILES.bookings);
    const idx = bookings.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Запись не найдена" });

    const booking = bookings[idx];
    // Verify ownership
    const isOwner =
      booking.phone === req.user.phone ||
      booking.client_phone === req.user.phone ||
      booking.userId === req.user.id ||
      booking.client_user_id === req.user.id;

    if (!isOwner) return res.status(403).json({ error: "Это не ваша запись" });
    if (booking.status !== "scheduled") {
      return res.status(400).json({ error: "Можно отменить только запланированные записи" });
    }

    // Calculate time until appointment
    const slotTime = new Date(`${booking.date}T${booking.time}:00`);
    const now = new Date();
    const minutesBefore = (slotTime.getTime() - now.getTime()) / (60 * 1000);

    // Allow cancellation but track timing for points refund
    if (minutesBefore < 0) {
      return res.status(400).json({ error: "Время записи уже прошло" });
    }

    bookings[idx].status = "cancelled";
    bookings[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.bookings, bookings);

    // Points refund logic: >= 30 min before → refund, < 30 min → no refund
    let pointsRefunded = false;
    if (booking.points_spent && booking.points_spent > 0 && booking.client_user_id) {
      if (minutesBefore >= 30) {
        const { refundPoints } = require("../lib/points");
        pointsRefunded = refundPoints(booking.client_user_id, booking.id);
      }
    }

    logAudit({
      actorUserId: req.user.id,
      action: "booking.client_cancel",
      entityType: "booking",
      entityId: req.params.id,
      meta: { minutes_before: Math.round(minutesBefore), points_refunded: pointsRefunded },
      ip: req.ip,
    });

    const message = pointsRefunded
      ? "Запись отменена. Баллы возвращены."
      : booking.points_spent > 0 && minutesBefore < 30
        ? "Запись отменена. Баллы не возвращаются (отмена менее чем за 30 мин)."
        : "Запись отменена";

    res.json({ ok: true, message, points_refunded: pointsRefunded });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/my-bookings/:id/rebook ──────────────
// Client: rebook a past/cancelled booking (create new with same params)
router.post("/my-bookings/:id/rebook", authenticate, (req, res, next) => {
  try {
    const bookings = readJSON(FILES.bookings);
    const original = bookings.find((b) => b.id === req.params.id);
    if (!original) return res.status(404).json({ error: "Запись не найдена" });

    // Verify ownership
    const isOwnerFlag =
      original.phone === req.user.phone ||
      original.client_phone === req.user.phone ||
      original.userId === req.user.id ||
      original.client_user_id === req.user.id;

    if (!isOwnerFlag) return res.status(403).json({ error: "Это не ваша запись" });

    const { date, time } = req.body;
    if (!date || !time) {
      return res.status(400).json({ error: "Укажите новую дату и время" });
    }

    const settings = getSettings();

    // Check day off
    const d = new Date(date + "T00:00:00");
    if (d.getDay() === (settings.day_off ?? 0)) {
      return res.status(400).json({ error: "Выходной день" });
    }

    // Check past time
    const slotStart = new Date(`${date}T${time}:00`);
    const now = new Date();
    if (slotStart.getTime() <= now.getTime()) {
      return res.status(400).json({ error: "Это время уже прошло" });
    }

    // Check availability
    const masterName = original.master || original.barber_name;
    const conflict = bookings.find(
      (b) =>
        b.date === date &&
        b.time === time &&
        (b.master === masterName || b.barber_name === masterName) &&
        b.status !== "cancelled"
    );
    if (conflict) {
      return res.status(409).json({ error: `Время ${time} у мастера ${masterName} уже занято` });
    }

    // Get service details for pricing
    const services = readJSON(FILES.services);
    const serviceObj = services.find((s) => s.id === (original.service_id || original.service));
    const discountPercent = settings.discount_registered_percent || 10;
    const priceOriginal = serviceObj ? serviceObj.price : original.price_original || 0;
    const priceFinal = Math.round(priceOriginal * (1 - discountPercent / 100));

    const newBooking = {
      id: genId(),
      name: original.name || original.client_name,
      phone: original.phone || original.client_phone,
      service: original.service || original.service_name,
      date,
      time,
      master: masterName,
      discount: discountPercent,
      userId: req.user.id,
      createdAt: new Date().toISOString(),
      source: "rebook",
      service_id: original.service_id,
      service_name: original.service_name || original.service,
      barber_name: masterName,
      client_name: original.client_name || original.name,
      client_phone: original.client_phone || original.phone,
      client_user_id: req.user.id,
      start_at: slotStart.toISOString(),
      end_at: new Date(
        slotStart.getTime() + (original.duration_minutes || 60) * 60 * 1000
      ).toISOString(),
      duration_minutes: original.duration_minutes || 60,
      price_original: priceOriginal,
      discount_percent: discountPercent,
      price_final: priceFinal,
      promo_code: null,
      status: "scheduled",
      notes: "",
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      statusConfirm: "pending",
      confirmChannel: "none",
      confirmLog: [],
    };

    bookings.push(newBooking);
    writeJSON(FILES.bookings, bookings);

    logAudit({
      actorUserId: req.user.id,
      action: "booking.rebook",
      entityType: "booking",
      entityId: newBooking.id,
      meta: { original_booking_id: original.id },
      ip: req.ip,
    });

    res.json({ ok: true, booking: newBooking });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
