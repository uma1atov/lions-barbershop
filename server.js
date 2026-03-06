/**
 * server.js — The Lion's Den Barbershop
 * Slim entry point: app setup → mount routes → error handler → listen
 */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const path = require("path");
const { errorHandler } = require("./lib/errors");
const { autoSeed } = require("./lib/seed");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Trust proxy (Railway / Render / Heroku) ────────
app.set("trust proxy", 1);

// ─── Security headers ──────────────────────────────
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ─── Middleware ─────────────────────────────────────
// Fix: Node v24 fetch sends charset=UTF-8 (uppercase), body-parser wants utf-8
app.use((req, _res, next) => {
  const ct = req.headers["content-type"];
  if (ct) req.headers["content-type"] = ct.replace(/charset=UTF-8/gi, "charset=utf-8");
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0
}));

// ─── Public shop info (no auth) ─────────────────────
const { readSettings, getSettings } = require("./lib/db");
app.get("/api/shop-info", (_req, res) => {
  const s = getSettings();
  res.json({
    shop_name: s.shop_name || "",
    shop_address: s.shop_address || "",
    shop_phone: s.shop_phone || "",
    day_off: s.day_off !== undefined ? s.day_off : -1,
    holidays: s.holidays || [],
    work_start_hour: s.work_start_hour || 9,
    work_end_hour: s.work_end_hour || 20,
    // Points config (public, for client UI)
    points_value_percent: s.points_value_percent || 10,
    points_max_spend_per_booking: s.points_max_spend_per_booking || 5,
    points_max_cap: s.points_max_cap || 10,
    points_per_booking: s.points_per_booking || 1,
    points_per_review: s.points_per_review || 1,
  });
});

// ─── Routes ─────────────────────────────────────────
const authRoutes     = require("./routes/auth.routes");
const serviceRoutes  = require("./routes/service.routes");
const bookingRoutes  = require("./routes/booking.routes");
const barberRoutes   = require("./routes/barber.routes");
const adminRoutes    = require("./routes/admin.routes");
const clientRoutes   = require("./routes/client.routes");
const chatRoutes     = require("./routes/chat.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const promoRoutes    = require("./routes/promo.routes");
const reviewRoutes   = require("./routes/review.routes");

// Auth
app.use("/api", authRoutes);

// Services (public GET + admin CRUD)
app.use("/api/services", serviceRoutes);

// Booking (slots, book, admin bookings)
app.use("/api", bookingRoutes);

// Barbers (public GET + admin CRUD + self-service)
app.use("/api/barbers", barberRoutes);
app.use("/api/barber", barberRoutes);

// Admin (users, settings, audit, blacklist)
app.use("/api/admin", adminRoutes);

// Client (my-bookings, my-stats, rebook)
app.use("/api", clientRoutes);

// Chat (Ollama AI)
app.use("/api/chat", chatRoutes);

// Analytics
app.use("/api/analytics", analyticsRoutes);

// Promo codes
app.use("/api/promo-codes", promoRoutes);

// Reviews + Loyalty Points
app.use("/api/reviews", reviewRoutes);

// ─── Integrations (Telegram, WhatsApp, Scheduler) ──
setTimeout(() => {
  try {
    const integrations = require("./integrations");
    app.use("/integrations", integrations.router);
    integrations.init();
  } catch (e) {
    console.log("⚠️  Интеграции не загружены:", e.message);
  }
}, 100);

// ─── Error handler (must be last) ──────────────────
app.use(errorHandler);

// ─── Start ──────────────────────────────────────────
(async () => {
  // Auto-seed OWNER_ADMIN on first start
  await autoSeed();

  // Points expiration sweep — run every hour
  const { expirePoints } = require("./lib/points");
  try { expirePoints(); } catch (e) { /* first run */ }
  setInterval(() => {
    try { expirePoints(); } catch (e) { console.error("Points expiration error:", e.message); }
  }, 60 * 60 * 1000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🦁 The Lion's Den Barbershop запущен: http://localhost:${PORT}\n`);
  });
})();
