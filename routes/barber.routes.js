/**
 * barber.routes.js — Barber management (admin) + Self-service + Walk-in
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId, getSettings } = require("../lib/db");
const { hashPassword } = require("../lib/auth");
const { logAudit } = require("../lib/audit");
const { ROLES } = require("../lib/rbac");
const { authenticate } = require("../middleware/authenticate");
const { authorize, can } = require("../middleware/authorize");

// ─── GET /api/barbers ──────────────────────────────
// Public: list active barbers (for frontend)
router.get("/", (req, res) => {
  const barbers = readJSON(FILES.barbers)
    .filter((b) => b.isActive)
    .map((b) => ({
      id: b.id,
      name: b.name,
      bio: b.bio,
      photoUrl: b.photoUrl,
      services: b.services,
      experience: b.experience,
    }));
  res.json(barbers);
});

// ═══ ADMIN BARBER MANAGEMENT ═══════════════════════

// ─── GET /api/admin/barbers ────────────────────────
// Admin: list all barbers (including inactive)
router.get("/admin", authenticate, can("barbers:create"), (req, res) => {
  res.json(readJSON(FILES.barbers));
});

// ─── POST /api/admin/barbers ───────────────────────
// Admin: create barber + optionally create user account
router.post("/admin", authenticate, can("barbers:create"), async (req, res, next) => {
  try {
    const { name, bio, photoUrl, services, schedule, experience, telegramChatId, create_account, phone, password } = req.body;
    if (!name) return res.status(400).json({ error: "Укажите имя барбера" });

    const allServices = readJSON(FILES.services);
    const barbers = readJSON(FILES.barbers);

    const barber = {
      id: "barber_" + genId(),
      name,
      role: "barber",
      bio: bio || "",
      photoUrl: photoUrl || "",
      telegramChatId: telegramChatId || null,
      isActive: true,
      services: services || allServices.filter((s) => s.is_active).map((s) => s.id),
      schedule: schedule || {
        0: null,
        1: { start: "09:00", end: "20:00", breakStart: "13:00", breakEnd: "14:00" },
        2: { start: "09:00", end: "20:00", breakStart: "13:00", breakEnd: "14:00" },
        3: { start: "09:00", end: "20:00", breakStart: "13:00", breakEnd: "14:00" },
        4: { start: "09:00", end: "20:00", breakStart: "13:00", breakEnd: "14:00" },
        5: { start: "09:00", end: "20:00", breakStart: "13:00", breakEnd: "14:00" },
        6: { start: "09:00", end: "18:00", breakStart: null, breakEnd: null },
      },
      experience: experience || "",
      user_id: null,
      vacations: [],
      createdAt: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Optionally create a user account for the barber
    if (create_account && phone && password) {
      const users = readJSON(FILES.users);
      if (users.find((u) => u.phone === phone)) {
        return res.status(409).json({ error: "Пользователь с таким номером уже существует" });
      }

      const hashedPw = await hashPassword(password);
      const userId = genId();
      const barberUser = {
        id: userId,
        name,
        phone,
        email: null,
        password: hashedPw,
        role: ROLES.BARBER,
        is_active: true,
        is_blacklisted: false,
        last_login_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      users.push(barberUser);
      writeJSON(FILES.users, users);
      barber.user_id = userId;
    }

    barbers.push(barber);
    writeJSON(FILES.barbers, barbers);

    logAudit({
      actorUserId: req.user.id,
      action: "barber.create",
      entityType: "barber",
      entityId: barber.id,
      meta: { name },
      ip: req.ip,
    });

    res.json(barber);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/barbers/:id ──────────────────
// Admin: update barber
router.patch("/admin/:id", authenticate, can("barbers:edit"), (req, res, next) => {
  try {
    const barbers = readJSON(FILES.barbers);
    const idx = barbers.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Барбер не найден" });

    const allowed = [
      "name", "bio", "photoUrl", "services", "schedule",
      "experience", "telegramChatId", "isActive", "vacations",
    ];
    const changes = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        barbers[idx][key] = req.body[key];
        changes[key] = req.body[key];
      }
    });

    barbers[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.barbers, barbers);

    logAudit({
      actorUserId: req.user.id,
      action: "barber.update",
      entityType: "barber",
      entityId: req.params.id,
      meta: changes,
      ip: req.ip,
    });

    res.json(barbers[idx]);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/barbers/:id ─────────────────
// Admin: permanently delete barber
router.delete("/admin/:id", authenticate, can("barbers:deactivate"), (req, res, next) => {
  try {
    const barbers = readJSON(FILES.barbers);
    const idx = barbers.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Барбер не найден" });

    const deletedBarber = barbers[idx];
    barbers.splice(idx, 1);
    writeJSON(FILES.barbers, barbers);

    logAudit({
      actorUserId: req.user.id,
      action: "barber.delete",
      entityType: "barber",
      entityId: req.params.id,
      meta: { name: deletedBarber.name },
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/barbers/:id/telegram-link ────
// Admin: link barber to Telegram
router.patch("/admin/:id/telegram-link", authenticate, can("barbers:edit"), (req, res, next) => {
  try {
    const { telegramChatId } = req.body;
    const barbers = readJSON(FILES.barbers);
    const idx = barbers.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Барбер не найден" });

    barbers[idx].telegramChatId = telegramChatId || null;
    barbers[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.barbers, barbers);

    res.json({ ok: true, telegramChatId: barbers[idx].telegramChatId });
  } catch (err) {
    next(err);
  }
});

// ═══ BARBER SELF-SERVICE ═══════════════════════════

// ─── GET /api/barber/me ────────────────────────────
// Barber: get own barber profile
router.get("/me", authenticate, authorize("barber"), (req, res) => {
  const barbers = readJSON(FILES.barbers);
  const barber = barbers.find((b) => b.user_id === req.user.id);
  if (!barber) return res.status(404).json({ error: "Профиль барбера не найден" });
  res.json(barber);
});

// ─── PATCH /api/barber/me ──────────────────────────
// Barber: update own profile (limited fields)
router.patch("/me", authenticate, authorize("barber"), (req, res, next) => {
  try {
    const barbers = readJSON(FILES.barbers);
    const idx = barbers.findIndex((b) => b.user_id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: "Профиль барбера не найден" });

    const allowed = ["bio", "photoUrl", "experience"];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) barbers[idx][key] = req.body[key];
    });

    barbers[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.barbers, barbers);

    res.json(barbers[idx]);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/barber/my-day-offs ──────────────────
// Barber: get own day offs
router.get("/my-day-offs", authenticate, authorize("barber"), (req, res) => {
  const barbers = readJSON(FILES.barbers);
  const barber = barbers.find((b) => b.user_id === req.user.id);
  if (!barber) return res.status(404).json({ error: "Профиль барбера не найден" });
  res.json({ day_offs: barber.day_offs || [] });
});

// ─── POST /api/barber/my-day-offs ─────────────────
// Barber: add a day off
router.post("/my-day-offs", authenticate, authorize("barber"), (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Укажите дату в формате ГГГГ-ММ-ДД" });
    }

    // Can't set day off in the past
    const today = new Date().toISOString().split("T")[0];
    if (date < today) {
      return res.status(400).json({ error: "Нельзя ставить выходной на прошедшую дату" });
    }

    const barbers = readJSON(FILES.barbers);
    const barber = barbers.find((b) => b.user_id === req.user.id);
    if (!barber) return res.status(404).json({ error: "Профиль барбера не найден" });

    if (!barber.day_offs) barber.day_offs = [];
    if (barber.day_offs.includes(date)) {
      return res.status(400).json({ error: "Этот день уже в выходных" });
    }

    barber.day_offs.push(date);
    barber.day_offs.sort();
    writeJSON(FILES.barbers, barbers);

    logAudit(req.user.id, "barber_day_off_add", { barber: barber.name, date });
    res.json({ ok: true, day_offs: barber.day_offs });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/barber/my-day-offs ────────────────
// Barber: remove a day off
router.delete("/my-day-offs", authenticate, authorize("barber"), (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: "Укажите дату" });

    const barbers = readJSON(FILES.barbers);
    const barber = barbers.find((b) => b.user_id === req.user.id);
    if (!barber) return res.status(404).json({ error: "Профиль барбера не найден" });

    if (!barber.day_offs) barber.day_offs = [];
    barber.day_offs = barber.day_offs.filter((d) => d !== date);
    writeJSON(FILES.barbers, barbers);

    logAudit(req.user.id, "barber_day_off_remove", { barber: barber.name, date });
    res.json({ ok: true, day_offs: barber.day_offs });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/barber/my-appointments ───────────────
// Barber: list own appointments
router.get("/my-appointments", authenticate, authorize("barber"), (req, res) => {
  const barbers = readJSON(FILES.barbers);
  const barber = barbers.find((b) => b.user_id === req.user.id);
  if (!barber) return res.status(404).json({ error: "Профиль барбера не найден" });

  let bookings = readJSON(FILES.bookings).filter(
    (b) => (b.master === barber.name || b.barber_name === barber.name) && b.status !== "cancelled"
  );

  const { date, from, to } = req.query;
  if (date) bookings = bookings.filter((b) => b.date === date);
  if (from) bookings = bookings.filter((b) => b.date >= from);
  if (to) bookings = bookings.filter((b) => b.date <= to);

  // Sort by date+time ascending
  bookings.sort((a, b) => {
    const dtA = a.date + "T" + a.time;
    const dtB = b.date + "T" + b.time;
    return dtA.localeCompare(dtB);
  });

  res.json(bookings);
});

// ─── PATCH /api/barber/appointments/:id/status ─────
// Barber: mark appointment completed/no_show
router.patch("/appointments/:id/status", authenticate, can("appointments:mark_status"), (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["completed", "no_show"].includes(status)) {
      return res.status(400).json({ error: "Статус может быть: completed, no_show" });
    }

    const barbers = readJSON(FILES.barbers);
    const barber = barbers.find((b) => b.user_id === req.user.id);

    const bookings = readJSON(FILES.bookings);
    const idx = bookings.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Запись не найдена" });

    // Barber can only update own appointments (admin can update any)
    if (req.user.role === "barber") {
      if (!barber) return res.status(404).json({ error: "Профиль барбера не найден" });
      if (bookings[idx].master !== barber.name && bookings[idx].barber_name !== barber.name) {
        return res.status(403).json({ error: "Это не ваша запись" });
      }
    }

    bookings[idx].status = status;
    bookings[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.bookings, bookings);

    // Create payment record if completed
    if (status === "completed" && bookings[idx].price_final > 0) {
      const payments = readJSON(FILES.payments);
      payments.push({
        id: genId(),
        booking_id: bookings[idx].id,
        barber_name: bookings[idx].barber_name || bookings[idx].master,
        service_name: bookings[idx].service_name || bookings[idx].service,
        amount: bookings[idx].price_final,
        discount_percent: bookings[idx].discount_percent || 0,
        promo_code: bookings[idx].promo_code || null,
        client_name: bookings[idx].client_name || bookings[idx].name,
        client_phone: bookings[idx].client_phone || bookings[idx].phone,
        date: bookings[idx].date,
        created_at: new Date().toISOString(),
      });
      writeJSON(FILES.payments, payments);
    }

    // Award 1 loyalty point to registered client
    if (status === "completed" && bookings[idx].client_user_id) {
      const users = readJSON(FILES.users);
      const cIdx = users.findIndex((u) => u.id === bookings[idx].client_user_id);
      if (cIdx !== -1) {
        if (!users[cIdx].points) users[cIdx].points = 0;
        if (!users[cIdx].points_history) users[cIdx].points_history = [];
        users[cIdx].points += 1;
        users[cIdx].points_history.push({
          type: "booking_completed",
          amount: 1,
          booking_id: bookings[idx].id,
          date: new Date().toISOString(),
        });
        writeJSON(FILES.users, users);
      }
    }

    logAudit({
      actorUserId: req.user.id,
      action: `booking.${status}`,
      entityType: "booking",
      entityId: req.params.id,
      ip: req.ip,
    });

    res.json(bookings[idx]);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/barber/walkin ───────────────────────
// Barber: create walk-in appointment
router.post("/walkin", authenticate, can("appointments:walkin"), (req, res, next) => {
  try {
    const { client_name, client_phone, service, notes } = req.body;
    if (!client_name || !service) {
      return res.status(400).json({ error: "Укажите имя клиента и услугу" });
    }

    const barbers = readJSON(FILES.barbers);
    let barber;

    // Barber creates walkin for themselves; admin can specify barber
    if (req.user.role === "barber") {
      barber = barbers.find((b) => b.user_id === req.user.id);
      if (!barber) return res.status(404).json({ error: "Профиль барбера не найден" });
    } else {
      // Admin: use barber_name from body or first active barber
      const barberName = req.body.barber_name;
      barber = barberName
        ? barbers.find((b) => b.name === barberName && b.isActive)
        : barbers.find((b) => b.isActive);
      if (!barber) return res.status(404).json({ error: "Барбер не найден" });
    }

    // Get service details
    const services = readJSON(FILES.services);
    const serviceObj = services.find((s) => s.id === service || s.name === service);

    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

    const booking = {
      id: genId(),
      name: client_name,
      phone: client_phone || "",
      service: serviceObj ? serviceObj.name : service,
      date: dateStr,
      time: timeStr,
      master: barber.name,
      discount: 0,
      userId: null,
      createdAt: now.toISOString(),
      source: "walkin",
      service_id: serviceObj ? serviceObj.id : null,
      service_name: serviceObj ? serviceObj.name : service,
      barber_name: barber.name,
      client_name,
      client_phone: client_phone || "",
      client_user_id: null,
      start_at: now.toISOString(),
      end_at: new Date(now.getTime() + (serviceObj ? serviceObj.duration : 60) * 60 * 1000).toISOString(),
      duration_minutes: serviceObj ? serviceObj.duration : 60,
      price_original: serviceObj ? serviceObj.price : 0,
      discount_percent: 0,
      price_final: serviceObj ? serviceObj.price : 0,
      promo_code: null,
      status: "completed",
      notes: notes || "",
      created_by: req.user.id,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      statusConfirm: "confirmed",
      confirmChannel: "walkin",
      confirmLog: [],
    };

    const bookings = readJSON(FILES.bookings);
    bookings.push(booking);
    writeJSON(FILES.bookings, bookings);

    // Create payment record
    if (booking.price_final > 0) {
      const payments = readJSON(FILES.payments);
      payments.push({
        id: genId(),
        booking_id: booking.id,
        barber_name: barber.name,
        service_name: booking.service_name,
        amount: booking.price_final,
        discount_percent: 0,
        promo_code: null,
        client_name,
        client_phone: client_phone || "",
        date: dateStr,
        created_at: now.toISOString(),
      });
      writeJSON(FILES.payments, payments);
    }

    logAudit({
      actorUserId: req.user.id,
      action: "booking.walkin",
      entityType: "booking",
      entityId: booking.id,
      meta: { barber: barber.name, service: booking.service_name, client: client_name },
      ip: req.ip,
    });

    res.json({ ok: true, booking });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/barber/my-analytics ──────────────────
// Barber: own performance analytics
router.get("/my-analytics", authenticate, authorize("barber"), (req, res) => {
  const barbers = readJSON(FILES.barbers);
  const barber = barbers.find((b) => b.user_id === req.user.id);
  if (!barber) return res.status(404).json({ error: "Профиль барбера не найден" });

  const { from, to } = req.query;
  let bookings = readJSON(FILES.bookings).filter(
    (b) => (b.master === barber.name || b.barber_name === barber.name) && b.status === "completed"
  );

  if (from) bookings = bookings.filter((b) => b.date >= from);
  if (to) bookings = bookings.filter((b) => b.date <= to);

  const totalRevenue = bookings.reduce((sum, b) => sum + (b.price_final || 0), 0);
  const totalBookings = bookings.length;
  const avgCheck = totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0;

  // Top services
  const serviceCounts = {};
  bookings.forEach((b) => {
    const sn = b.service_name || b.service;
    serviceCounts[sn] = (serviceCounts[sn] || 0) + 1;
  });
  const topServices = Object.entries(serviceCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    barber_name: barber.name,
    total_revenue: totalRevenue,
    total_bookings: totalBookings,
    avg_check: avgCheck,
    top_services: topServices,
  });
});

// ─── Legacy: GET /api/barber/my-bookings ───────────
// (backwards compatible with old server.js)
router.get("/my-bookings", authenticate, (req, res) => {
  if (!["barber", "admin", "owner_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  const bookings = readJSON(FILES.bookings).filter(
    (b) => b.master === req.user.name || b.barber_name === req.user.name
  );
  res.json(bookings);
});

module.exports = router;
