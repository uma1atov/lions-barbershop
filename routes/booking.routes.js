/**
 * booking.routes.js — Slots, Public Booking, Admin Bookings Management
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId, getSettings } = require("../lib/db");
const { logAudit } = require("../lib/audit");
const { authenticate, optionalAuth } = require("../middleware/authenticate");
const { can } = require("../middleware/authorize");

// ─── Московское время (UTC+3) ───────────────────────
function moscowNow() {
  const now = new Date();
  // Сдвигаем на UTC+3: getTimezoneOffset() возвращает минуты от UTC (отрицательные для восточных)
  // Приводим к UTC, затем добавляем 3 часа
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + 3 * 60 * 60 * 1000);
}

function moscowDate(dateStr, timeStr) {
  // Парсим дату/время как московское (без сдвига часового пояса)
  // dateStr = "YYYY-MM-DD", timeStr = "HH:MM" (или undefined)
  const iso = timeStr ? `${dateStr}T${timeStr}:00` : `${dateStr}T00:00:00`;
  const d = new Date(iso);
  // Убираем локальный сдвиг и ставим UTC+3, чтобы сравнение было корректным
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + 3 * 60 * 60 * 1000);
}

// ─── GET /api/slots?date=YYYY-MM-DD ────────────────
// Public: get available slots for a date
router.get("/slots", (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Укажите дату (?date=ГГГГ-ММ-ДД)" });

    const settings = getSettings();
    const WORK_START = settings.work_start_hour || 9;
    const WORK_END = settings.work_end_hour || 20;
    const MIN_LEAD = settings.min_booking_lead_minutes || 0;

    // Check day off (-1 = no day off)
    const d = moscowDate(date);
    const dow = d.getDay();
    if (settings.day_off >= 0 && dow === settings.day_off) {
      return res.json({ closed: true, message: "Выходной день" });
    }

    // Check holidays
    if (settings.holidays && settings.holidays.includes(date)) {
      return res.json({ closed: true, message: "Праздничный день" });
    }

    const now = moscowNow();
    const leadMs = MIN_LEAD * 60 * 1000;
    const bookings = readJSON(FILES.bookings).filter(
      (b) => b.date === date && b.status !== "cancelled"
    );
    // Filter barbers by type: "laser" for laser specialists, default for barbers
    const slotType = req.query.type || "barber";
    const barbers = readJSON(FILES.barbers).filter((b) => {
      if (!b.isActive) return false;
      if (slotType === "laser") return b.type === "laser";
      return b.type !== "laser"; // default: only regular barbers
    });

    // Get barber names (active only)
    const masterNames = barbers.map((b) => b.name);

    // Check barber vacations + personal day_offs
    const availableMasters = barbers
      .filter((b) => {
        // Check vacations
        if (b.vacations && b.vacations.length > 0) {
          if (b.vacations.some((v) => date >= v.start && date <= v.end)) return false;
        }
        // Check personal day_offs
        if (b.day_offs && b.day_offs.includes(date)) return false;
        return true;
      })
      .map((b) => b.name);

    // If ALL barbers are off, salon is effectively closed
    if (availableMasters.length === 0) {
      return res.json({ date, closed: true, message: "Все мастера в выходном" });
    }

    // Пятница (dow=5): работа с 14:00
    const isFriday = dow === 5;
    const effectiveStart = isFriday ? Math.max(WORK_START, 14) : WORK_START;

    // Build slots
    const slots = [];
    for (let h = effectiveStart; h < WORK_END; h++) {
      const time = String(h).padStart(2, "0") + ":00";
      const slotStart = moscowDate(date, time);
      const isPast = slotStart.getTime() <= now.getTime() + leadMs;

      const masterSlots = {};

      // Mark explicitly assigned masters
      availableMasters.forEach((master) => {
        const booked = bookings.find(
          (b) => (b.master === master || b.barber_name === master) && b.time === time
        );
        masterSlots[master] = booked
          ? { free: false, service: booked.service || booked.service_name, name: booked.name || booked.client_name }
          : { free: true };
      });

      // Distribute "любой свободный" bookings to free masters
      const anyBookings = bookings.filter(
        (b) =>
          b.time === time &&
          ((b.master === "любой свободный" || b.barber_name === "любой свободный") ||
            (!availableMasters.includes(b.master) && !availableMasters.includes(b.barber_name)))
      );
      let remaining = anyBookings.length;
      if (remaining > 0) {
        for (const m of availableMasters) {
          if (remaining <= 0) break;
          if (masterSlots[m].free) {
            const ab = anyBookings[remaining - 1];
            masterSlots[m] = {
              free: false,
              service: ab.service || ab.service_name,
              name: ab.name || ab.client_name,
            };
            remaining--;
          }
        }
      }

      const freeCount = Object.values(masterSlots).filter((s) => s.free).length;
      slots.push({
        time,
        masters: masterSlots,
        freeCount,
        allBusy: freeCount === 0,
        isPast,
      });
    }

    res.json({ date, closed: false, slots });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/book ────────────────────────────────
// Public (optionalAuth): create booking from calendar
router.post("/book", optionalAuth, (req, res, next) => {
  try {
    const { name, phone, service, date, time, master, promo_code, points_to_spend } = req.body;

    if (!name || !phone || !service || !date || !time) {
      return res.status(400).json({ error: "Заполните все обязательные поля" });
    }

    const settings = getSettings();
    const MIN_LEAD = settings.min_booking_lead_minutes || 0;

    // Check day off (-1 = no day off)
    const d = moscowDate(date);
    if (settings.day_off >= 0 && d.getDay() === settings.day_off) {
      return res.status(400).json({ error: "Выходной день" });
    }
    if (settings.holidays && settings.holidays.includes(date)) {
      return res.status(400).json({ error: "Праздничный день" });
    }

    // Пятница: работа только с 14:00
    if (d.getDay() === 5 && parseInt(time.split(":")[0], 10) < 14) {
      return res.status(400).json({ error: "По пятницам запись доступна с 14:00" });
    }

    // Check past time (московское время)
    const slotStart = moscowDate(date, time);
    const now = moscowNow();
    const leadMs = MIN_LEAD * 60 * 1000;
    if (slotStart.getTime() <= now.getTime() + leadMs) {
      return res.status(400).json({
        error:
          MIN_LEAD > 0
            ? `Нельзя записаться менее чем за ${MIN_LEAD} мин. до начала`
            : "Это время уже прошло. Выберите другое время.",
      });
    }

    // Check blacklist
    const blacklist = readJSON(FILES.blacklist);
    const isBlacklisted = blacklist.find(
      (b) => b.is_active && (b.phone === phone || (req.user && b.user_id === req.user.id))
    );
    if (isBlacklisted) {
      return res.status(403).json({ error: "Запись невозможна. Обратитесь к администратору." });
    }

    const bookings = readJSON(FILES.bookings);
    const barbers = readJSON(FILES.barbers).filter((b) => b.isActive);
    const masterNames = barbers.map((b) => b.name);
    let chosenMaster = master || "любой свободный";

    // Auto-assign free master
    if (chosenMaster === "любой свободный") {
      const busyMasters = bookings
        .filter((b) => b.date === date && b.time === time && b.status !== "cancelled")
        .map((b) => b.master || b.barber_name);
      const freeMaster = masterNames.find((m) => !busyMasters.includes(m));
      if (!freeMaster) {
        return res.status(409).json({ error: `Все мастера заняты на ${time}` });
      }
      chosenMaster = freeMaster;
    } else {
      // Check if slot taken for specific master
      const conflict = bookings.find(
        (b) =>
          b.date === date &&
          b.time === time &&
          (b.master === chosenMaster || b.barber_name === chosenMaster) &&
          b.status !== "cancelled"
      );
      if (conflict) {
        return res
          .status(409)
          .json({ error: `Время ${time} у мастера ${chosenMaster} уже занято` });
      }
    }

    // Get service details
    const services = readJSON(FILES.services);
    const serviceObj = services.find(
      (s) => s.id === service || s.name === service
    );

    // Calculate discount
    const isRegistered = req.user && req.user.role === "client";
    const discountPercent = isRegistered ? (settings.discount_registered_percent || 10) : 0;

    // Validate promo code
    let promoDiscount = 0;
    let appliedPromo = null;
    if (promo_code) {
      const promoCodes = readJSON(FILES.promo_codes);
      const promo = promoCodes.find(
        (p) =>
          p.code.toLowerCase() === promo_code.toLowerCase() &&
          p.is_active &&
          (!p.expires_at || new Date(p.expires_at) > now) &&
          (!p.max_uses || p.used_count < p.max_uses)
      );
      if (promo) {
        promoDiscount = promo.discount_percent || 0;
        appliedPromo = promo.code;
        // Increment usage count
        promo.used_count = (promo.used_count || 0) + 1;
        writeJSON(FILES.promo_codes, promoCodes);
      }
    }

    // Points discount (only for logged-in clients with points)
    let pointsDiscountPercent = 0;
    let pointsActualSpend = 0;
    if (points_to_spend && points_to_spend > 0 && req.user && req.user.role === "client") {
      const { getUserPoints } = require("../lib/points");
      const pointsData = getUserPoints(req.user.id);
      if (pointsData && pointsData.activePoints > 0) {
        const maxSpend = settings.points_max_spend_per_booking || 5;
        const valuePercent = settings.points_value_percent || 10;
        pointsActualSpend = Math.min(points_to_spend, pointsData.activePoints, maxSpend);
        pointsDiscountPercent = pointsActualSpend * valuePercent;
      }
    }

    const totalDiscount = Math.min(discountPercent + promoDiscount + pointsDiscountPercent, 90); // Cap at 90%
    const priceOriginal = serviceObj ? serviceObj.price : 0;
    const priceFinal = Math.round(priceOriginal * (1 - totalDiscount / 100));

    const booking = {
      id: genId(),
      name,
      phone,
      service: serviceObj ? serviceObj.name : service,
      date,
      time,
      master: chosenMaster,
      discount: totalDiscount,
      userId: req.user ? req.user.id : null,
      createdAt: new Date().toISOString(),
      source: "calendar",
      // Extended fields
      service_id: serviceObj ? serviceObj.id : null,
      service_name: serviceObj ? serviceObj.name : service,
      barber_name: chosenMaster,
      client_name: name,
      client_phone: phone,
      client_user_id: req.user ? req.user.id : null,
      start_at: slotStart.toISOString(),
      end_at: new Date(
        slotStart.getTime() + (serviceObj ? serviceObj.duration : 60) * 60 * 1000
      ).toISOString(),
      duration_minutes: serviceObj ? serviceObj.duration : 60,
      price_original: priceOriginal,
      discount_percent: totalDiscount,
      price_final: priceFinal,
      promo_code: appliedPromo,
      points_spent: 0,
      points_discount_percent: pointsDiscountPercent,
      status: "scheduled",
      notes: "",
      created_by: req.user ? req.user.id : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Confirmation
      statusConfirm: "pending",
      confirmChannel: "none",
      confirmLastMessageAt: null,
      confirmResponseAt: null,
      confirmLog: [],
    };

    bookings.push(booking);
    writeJSON(FILES.bookings, bookings);

    // Spend points AFTER booking is saved
    if (pointsActualSpend > 0 && req.user) {
      const { spendPoints } = require("../lib/points");
      const spendResult = spendPoints(req.user.id, pointsActualSpend, booking.id);
      if (spendResult) {
        // Update booking with actual points spent
        const bks = readJSON(FILES.bookings);
        const bIdx = bks.findIndex((b) => b.id === booking.id);
        if (bIdx !== -1) {
          bks[bIdx].points_spent = spendResult.pointsSpent;
          writeJSON(FILES.bookings, bks);
          booking.points_spent = spendResult.pointsSpent;
        }
      }
    }

    logAudit({
      actorUserId: req.user ? req.user.id : null,
      action: "booking.create",
      entityType: "booking",
      entityId: booking.id,
      meta: { service: booking.service_name, date, time, master: chosenMaster, source: "calendar", points_spent: booking.points_spent },
      ip: req.ip,
    });

    // Schedule confirmation jobs (optional integration)
    try {
      const { scheduleConfirmationJobs } = require("../integrations/jobs");
      scheduleConfirmationJobs(booking);
    } catch (e) {
      /* integrations optional */
    }

    res.json({ ok: true, booking });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/bookings ───────────────────────
// Admin: list all bookings with filters
router.get("/admin/bookings", authenticate, can("appointments:list_all"), (req, res, next) => {
  try {
    let bookings = readJSON(FILES.bookings);
    const { date, barber, status, source, from, to } = req.query;

    if (date) bookings = bookings.filter((b) => b.date === date);
    if (barber) bookings = bookings.filter((b) => b.master === barber || b.barber_name === barber);
    if (status) bookings = bookings.filter((b) => b.status === status);
    if (source) bookings = bookings.filter((b) => b.source === source);
    if (from) bookings = bookings.filter((b) => b.date >= from);
    if (to) bookings = bookings.filter((b) => b.date <= to);

    // Sort newest first
    bookings.sort((a, b) => {
      const dateA = a.date + "T" + a.time;
      const dateB = b.date + "T" + b.time;
      return dateB.localeCompare(dateA);
    });

    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/bookings/:id ─────────────────
// Admin: update booking (status, reschedule, notes)
router.patch("/admin/bookings/:id", authenticate, can("appointments:list_all"), (req, res, next) => {
  try {
    const settings = getSettings();
    const bookings = readJSON(FILES.bookings);
    const idx = bookings.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Запись не найдена" });

    const allowed = [
      "status",
      "date",
      "time",
      "master",
      "barber_name",
      "notes",
      "price_final",
      "discount_percent",
    ];
    const changes = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        bookings[idx][key] = req.body[key];
        changes[key] = req.body[key];
      }
    });

    // Sync master/barber_name
    if (changes.master) bookings[idx].barber_name = changes.master;
    if (changes.barber_name) bookings[idx].master = changes.barber_name;

    bookings[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.bookings, bookings);

    // Points logic on status change
    const booking = bookings[idx];
    if (changes.status && booking.client_user_id) {
      if (changes.status === "completed") {
        // Earn points for completed booking
        const { earnPoints } = require("../lib/points");
        const pts = settings.points_per_booking || 1;
        earnPoints(booking.client_user_id, {
          type: "booking",
          amount: pts,
          booking_id: booking.id,
        });
      } else if (changes.status === "cancelled" && booking.points_spent > 0) {
        // Admin cancel: always refund points
        const { refundPoints } = require("../lib/points");
        refundPoints(booking.client_user_id, booking.id);
      }
      // no_show: points stay spent (no refund)
    }

    logAudit({
      actorUserId: req.user.id,
      action: "booking.update",
      entityType: "booking",
      entityId: req.params.id,
      meta: changes,
      ip: req.ip,
    });

    res.json(bookings[idx]);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/bookings/:id ────────────────
// Admin: cancel booking (soft delete — set status=cancelled)
router.delete("/admin/bookings/:id", authenticate, can("appointments:delete"), (req, res, next) => {
  try {
    const bookings = readJSON(FILES.bookings);
    const idx = bookings.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Запись не найдена" });

    bookings[idx].status = "cancelled";
    bookings[idx].updated_at = new Date().toISOString();
    writeJSON(FILES.bookings, bookings);

    logAudit({
      actorUserId: req.user.id,
      action: "booking.cancel",
      entityType: "booking",
      entityId: req.params.id,
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/bookings (legacy support) ────────────
// Public: returns all bookings (for backwards compatibility)
router.get("/bookings", (req, res) => {
  res.json(readJSON(FILES.bookings));
});

module.exports = router;
