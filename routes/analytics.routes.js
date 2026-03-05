/**
 * analytics.routes.js — Revenue, by-barber, top-services, CSV export
 */
const router = require("express").Router();
const { readJSON, FILES } = require("../lib/db");
const { authenticate } = require("../middleware/authenticate");
const { can } = require("../middleware/authorize");

/**
 * Helper: filter bookings by date range
 */
function filterByDateRange(bookings, from, to) {
  let result = bookings;
  if (from) result = result.filter((b) => b.date >= from);
  if (to) result = result.filter((b) => b.date <= to);
  return result;
}

// ─── GET /api/analytics/revenue ────────────────────
// Admin: revenue summary (total, by period)
router.get("/revenue", authenticate, can("analytics:full"), (req, res) => {
  const { from, to, period } = req.query; // period: day, week, month
  let bookings = readJSON(FILES.bookings).filter((b) => b.status === "completed");
  bookings = filterByDateRange(bookings, from, to);

  const totalRevenue = bookings.reduce((sum, b) => sum + (b.price_final || 0), 0);
  const totalBookings = bookings.length;
  const avgCheck = totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0;
  const totalDiscount = bookings.reduce((sum, b) => {
    return sum + ((b.price_original || 0) - (b.price_final || 0));
  }, 0);

  // Group by period
  const grouped = {};
  bookings.forEach((b) => {
    let key;
    if (period === "month") {
      key = b.date ? b.date.substring(0, 7) : "unknown"; // YYYY-MM
    } else if (period === "week") {
      const d = new Date(b.date + "T00:00:00");
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay() + 1); // Monday
      key = weekStart.toISOString().split("T")[0];
    } else {
      key = b.date || "unknown"; // by day
    }

    if (!grouped[key]) {
      grouped[key] = { period: key, revenue: 0, bookings: 0 };
    }
    grouped[key].revenue += b.price_final || 0;
    grouped[key].bookings++;
  });

  const periods = Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period));

  res.json({
    total_revenue: totalRevenue,
    total_bookings: totalBookings,
    avg_check: avgCheck,
    total_discount: totalDiscount,
    periods,
  });
});

// ─── GET /api/analytics/by-barber ──────────────────
// Admin: analytics grouped by barber
router.get("/by-barber", authenticate, can("analytics:full"), (req, res) => {
  const { from, to } = req.query;
  let bookings = readJSON(FILES.bookings).filter((b) => b.status === "completed");
  bookings = filterByDateRange(bookings, from, to);

  const barberStats = {};
  bookings.forEach((b) => {
    const bn = b.barber_name || b.master || "Неизвестно";
    if (!barberStats[bn]) {
      barberStats[bn] = { barber: bn, revenue: 0, bookings: 0, no_shows: 0 };
    }
    barberStats[bn].revenue += b.price_final || 0;
    barberStats[bn].bookings++;
  });

  // Count no_shows
  const noShows = readJSON(FILES.bookings).filter((b) => b.status === "no_show");
  filterByDateRange(noShows, from, to).forEach((b) => {
    const bn = b.barber_name || b.master || "Неизвестно";
    if (!barberStats[bn]) {
      barberStats[bn] = { barber: bn, revenue: 0, bookings: 0, no_shows: 0 };
    }
    barberStats[bn].no_shows++;
  });

  // Add avg_check
  const result = Object.values(barberStats).map((s) => ({
    ...s,
    avg_check: s.bookings > 0 ? Math.round(s.revenue / s.bookings) : 0,
  }));

  result.sort((a, b) => b.revenue - a.revenue);
  res.json(result);
});

// ─── GET /api/analytics/top-services ───────────────
// Admin: most popular services
router.get("/top-services", authenticate, can("analytics:full"), (req, res) => {
  const { from, to } = req.query;
  let bookings = readJSON(FILES.bookings).filter((b) => b.status === "completed");
  bookings = filterByDateRange(bookings, from, to);

  const serviceStats = {};
  bookings.forEach((b) => {
    const sn = b.service_name || b.service || "Неизвестно";
    if (!serviceStats[sn]) {
      serviceStats[sn] = { service: sn, count: 0, revenue: 0 };
    }
    serviceStats[sn].count++;
    serviceStats[sn].revenue += b.price_final || 0;
  });

  const result = Object.values(serviceStats).sort((a, b) => b.count - a.count);
  res.json(result);
});

// ─── GET /api/analytics/sources ────────────────────
// Admin: booking source breakdown (chat, calendar, walkin, rebook)
router.get("/sources", authenticate, can("analytics:full"), (req, res) => {
  const { from, to } = req.query;
  let bookings = readJSON(FILES.bookings);
  bookings = filterByDateRange(bookings, from, to);

  const sources = {};
  bookings.forEach((b) => {
    const src = b.source || "unknown";
    if (!sources[src]) {
      sources[src] = { source: src, count: 0 };
    }
    sources[src].count++;
  });

  res.json(Object.values(sources).sort((a, b) => b.count - a.count));
});

// ─── GET /api/analytics/export ─────────────────────
// Admin: CSV export of all bookings
router.get("/export", authenticate, can("analytics:full"), (req, res) => {
  const { from, to, status } = req.query;
  let bookings = readJSON(FILES.bookings);
  bookings = filterByDateRange(bookings, from, to);
  if (status) bookings = bookings.filter((b) => b.status === status);

  // Sort by date
  bookings.sort((a, b) => (a.date + "T" + a.time).localeCompare(b.date + "T" + b.time));

  // BOM for Excel compatibility with Cyrillic
  const BOM = "\uFEFF";
  const header = "ID;Дата;Время;Клиент;Телефон;Услуга;Мастер;Цена;Скидка%;Итого;Статус;Источник;Промокод\n";
  const rows = bookings
    .map(
      (b) =>
        [
          b.id,
          b.date,
          b.time,
          b.client_name || b.name || "",
          b.client_phone || b.phone || "",
          b.service_name || b.service || "",
          b.barber_name || b.master || "",
          b.price_original || "",
          b.discount_percent || 0,
          b.price_final || "",
          b.status || "",
          b.source || "",
          b.promo_code || "",
        ].join(";")
    )
    .join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bookings-${new Date().toISOString().split("T")[0]}.csv"`
  );
  res.send(BOM + header + rows);
});

module.exports = router;
