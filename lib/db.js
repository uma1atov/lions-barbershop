/**
 * db.js — Centralized JSON file storage
 * Atomic writes (temp+rename), path constants, helpers
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  users: path.join(DATA_DIR, "users.json"),
  barbers: path.join(DATA_DIR, "barbers.json"),
  bookings: path.join(DATA_DIR, "bookings.json"),
  services: path.join(DATA_DIR, "services.json"),
  payments: path.join(DATA_DIR, "payments.json"),
  password_reset_codes: path.join(DATA_DIR, "password_reset_codes.json"),
  audit_logs: path.join(DATA_DIR, "audit_logs.json"),
  promo_codes: path.join(DATA_DIR, "promo_codes.json"),
  blacklist: path.join(DATA_DIR, "blacklist.json"),
  settings: path.join(DATA_DIR, "settings.json"),
  clients: path.join(DATA_DIR, "clients.json"),
  jobs: path.join(DATA_DIR, "jobs.json"),
  reviews: path.join(DATA_DIR, "reviews.json"),
};

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Atomic write: write to .tmp first, then rename
 * Prevents file corruption on crash
 */
function writeJSON(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

/**
 * Generate unique ID: timestamp base36 + random suffix
 */
function genId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
}

/**
 * Find item by ID in a JSON file
 */
function findById(file, id) {
  const list = readJSON(file);
  return list.find((item) => item.id === id) || null;
}

/**
 * Update item by ID: read → find → merge → write
 * Returns updated item or null if not found
 */
function updateById(file, id, updates) {
  const list = readJSON(file);
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  Object.assign(list[idx], updates, { updated_at: new Date().toISOString() });
  writeJSON(file, list);
  return list[idx];
}

/**
 * Append item to list in JSON file
 */
function appendToList(file, item) {
  const list = readJSON(file);
  list.push(item);
  writeJSON(file, list);
  return item;
}

/**
 * Remove item by ID from a JSON file (hard delete)
 */
function removeById(file, id) {
  const list = readJSON(file);
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  writeJSON(file, list);
  return true;
}

/**
 * Read settings (object, not array)
 */
function readSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(FILES.settings, "utf-8"));
    return typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS = {
  max_admins: 3,
  max_owner_admins: 2,
  min_booking_lead_minutes: 10,
  work_start_hour: 9,
  work_end_hour: 20,
  day_off: -1,
  discount_registered_percent: 10,
  booking_slot_step_minutes: 60,
  shop_name: "The Lion's Den Barbershop",
  shop_address: "",
  shop_phone: "",
  holidays: [],
  // Points / Loyalty system
  points_per_booking: 1,
  points_per_review: 1,
  points_max_cap: 10,
  points_max_spend_per_booking: 5,
  points_value_percent: 10,
  points_expiration_days: 45,
  points_expiration_warning_days: 5,
};

function getSettings() {
  const saved = readSettings();
  return { ...DEFAULT_SETTINGS, ...saved };
}

/**
 * Initialize all data files (create empty ones if missing)
 * Safe to call multiple times (idempotent)
 */
function initDataFiles() {
  const arrayFiles = [
    FILES.users, FILES.barbers, FILES.bookings, FILES.services,
    FILES.payments, FILES.password_reset_codes, FILES.audit_logs,
    FILES.promo_codes, FILES.blacklist, FILES.clients, FILES.jobs, FILES.reviews,
  ];
  for (const f of arrayFiles) {
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, "[]", "utf-8");
    }
  }
  if (!fs.existsSync(FILES.settings)) {
    fs.writeFileSync(FILES.settings, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8");
  }
}

// Auto-init on load
initDataFiles();

module.exports = {
  DATA_DIR,
  FILES,
  readJSON,
  writeJSON,
  genId,
  findById,
  updateById,
  appendToList,
  removeById,
  readSettings,
  getSettings,
  DEFAULT_SETTINGS,
  initDataFiles,
};
