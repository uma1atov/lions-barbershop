#!/usr/bin/env node
/**
 * migrate.js — Data migration script
 *
 * Migrates existing JSON data to the new schema:
 * 1. Users: plaintext passwords → bcrypt, add new fields, promote first admin → owner_admin
 * 2. Bookings: expand schema with service_id, start_at/end_at, price_final, status
 * 3. Barbers: add user_id, vacations
 * 4. Services: extract hardcoded SERVICES to services.json
 * 5. Initialize empty JSON files for new entities
 *
 * IDEMPOTENT: Safe to run multiple times
 *
 * Usage:
 *   node scripts/migrate.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { readJSON, writeJSON, FILES, DATA_DIR, genId, DEFAULT_SETTINGS } = require("../lib/db");
const { hashPassword, isHashed } = require("../lib/auth");

// Hardcoded services (from original server.js)
const ORIGINAL_SERVICES = [
  { id: "haircut",    name: "Мужская стрижка",       price: 1500, duration: 60 },
  { id: "machine",    name: "Стрижка машинкой",      price: 800,  duration: 30 },
  { id: "beard",      name: "Моделирование бороды",  price: 1000, duration: 30 },
  { id: "shave",      name: "Королевское бритьё",    price: 1200, duration: 60 },
  { id: "complex",    name: "Стрижка + борода",      price: 2200, duration: 60 },
  { id: "camouflage", name: "Камуфляж седины",       price: 1500, duration: 60 },
];

const SERVICE_ICONS = {
  haircut: "✂️", machine: "💈", beard: "🧔",
  shave: "🪒", complex: "👑", camouflage: "🎨",
};

async function migrate() {
  console.log("═══════════════════════════════════════");
  console.log("  The Lion's Den — Data Migration");
  console.log("═══════════════════════════════════════\n");

  // 0. Backup
  const backupDir = path.join(DATA_DIR, `..`, `data-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
  if (!fs.existsSync(backupDir)) {
    fs.cpSync(DATA_DIR, backupDir, { recursive: true });
    console.log(`✅ Backup created: ${backupDir}\n`);
  } else {
    console.log(`ℹ️  Backup already exists: ${backupDir}\n`);
  }

  await migrateUsers();
  await migrateBarbers();
  createServicesFile();
  migrateBookings();
  initEmptyFiles();

  console.log("\n═══════════════════════════════════════");
  console.log("  Migration complete!");
  console.log("═══════════════════════════════════════");
}

// ─── 1. USERS ──────────────────────────────────────

async function migrateUsers() {
  console.log("1. Migrating users...");
  const users = readJSON(FILES.users);
  let hashed = 0;
  let promoted = 0;

  for (const user of users) {
    // Hash plaintext passwords
    if (!isHashed(user.password)) {
      user.password = await hashPassword(user.password);
      hashed++;
    }

    // Add new fields (idempotent)
    if (user.email === undefined) user.email = null;
    if (user.is_active === undefined) user.is_active = true;
    if (user.is_blacklisted === undefined) user.is_blacklisted = false;
    if (!user.last_login_at) user.last_login_at = null;

    // Normalize timestamps (camelCase → snake_case)
    if (user.createdAt && !user.created_at) {
      user.created_at = user.createdAt;
    }
    if (!user.created_at) user.created_at = new Date().toISOString();
    if (!user.updated_at) user.updated_at = new Date().toISOString();

    // Clean up old camelCase keys
    delete user.createdAt;
  }

  // Promote first admin to owner_admin (if no owner_admin exists)
  const hasOwner = users.some((u) => u.role === "owner_admin");
  if (!hasOwner) {
    const admin = users.find((u) => u.role === "admin");
    if (admin) {
      admin.role = "owner_admin";
      admin.updated_at = new Date().toISOString();
      promoted++;
      console.log(`   → Promoted "${admin.name}" to owner_admin`);
    }
  }

  writeJSON(FILES.users, users);
  console.log(`   ✅ ${users.length} users migrated (${hashed} passwords hashed, ${promoted} promoted)\n`);
}

// ─── 2. BARBERS ────────────────────────────────────

async function migrateBarbers() {
  console.log("2. Migrating barbers...");
  const barbers = readJSON(FILES.barbers);

  for (const barber of barbers) {
    if (barber.user_id === undefined) barber.user_id = null;
    if (!barber.vacations) barber.vacations = [];

    // Normalize timestamps
    if (barber.createdAt && !barber.created_at) {
      barber.created_at = barber.createdAt;
    }
    if (!barber.created_at) barber.created_at = new Date().toISOString();
    if (!barber.updated_at) barber.updated_at = new Date().toISOString();
  }

  writeJSON(FILES.barbers, barbers);
  console.log(`   ✅ ${barbers.length} barbers migrated\n`);
}

// ─── 3. SERVICES ───────────────────────────────────

function createServicesFile() {
  console.log("3. Creating services.json...");

  // Check if already exists with data
  const existing = readJSON(FILES.services);
  if (existing.length > 0) {
    console.log(`   ℹ️  services.json already has ${existing.length} entries, skipping\n`);
    return;
  }

  const services = ORIGINAL_SERVICES.map((svc, i) => ({
    id: svc.id,
    name: svc.name,
    price: svc.price,
    duration: svc.duration,
    icon: SERVICE_ICONS[svc.id] || "✂️",
    is_active: true,
    sort_order: i + 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  writeJSON(FILES.services, services);
  console.log(`   ✅ ${services.length} services created\n`);
}

// ─── 4. BOOKINGS ───────────────────────────────────

function migrateBookings() {
  console.log("4. Migrating bookings...");
  const bookings = readJSON(FILES.bookings);
  const services = readJSON(FILES.services);

  for (const b of bookings) {
    // Map service name to service_id
    const svc = services.find((s) => s.name === (b.service || b.service_name));

    if (!b.service_id) b.service_id = svc?.id || null;
    if (!b.service_name) b.service_name = b.service || "";
    if (!b.barber_name) b.barber_name = b.master || "";
    if (!b.client_name) b.client_name = b.name || "";
    if (!b.client_phone) b.client_phone = b.phone || "";
    if (b.client_user_id === undefined) b.client_user_id = b.userId || null;

    // Compute start_at / end_at
    if (!b.start_at && b.date && b.time) {
      b.start_at = `${b.date}T${b.time}:00.000Z`;
    }
    if (!b.end_at && b.start_at && svc) {
      const start = new Date(b.start_at);
      b.end_at = new Date(start.getTime() + (svc.duration || 60) * 60000).toISOString();
    }
    if (!b.duration_minutes) b.duration_minutes = svc?.duration || 60;

    // Price fields
    if (b.price_original === undefined) b.price_original = svc?.price || 0;
    if (b.discount_percent === undefined) b.discount_percent = b.discount || 0;
    if (b.price_final === undefined && b.price_original) {
      b.price_final = Math.round(b.price_original * (1 - b.discount_percent / 100));
    }
    if (!b.promo_code) b.promo_code = null;

    // Status
    if (!b.status) b.status = "scheduled";
    if (!b.source) b.source = b.source || "calendar";
    if (!b.notes) b.notes = "";
    if (b.created_by === undefined) b.created_by = b.client_user_id || null;

    // Timestamps
    if (b.createdAt && !b.created_at) b.created_at = b.createdAt;
    if (!b.created_at) b.created_at = new Date().toISOString();
    if (!b.updated_at) b.updated_at = new Date().toISOString();

    // Confirmation fields (keep existing, add defaults)
    if (!b.statusConfirm) b.statusConfirm = "pending";
    if (!b.confirmChannel) b.confirmChannel = "none";
    if (!b.confirmLog) b.confirmLog = [];
  }

  writeJSON(FILES.bookings, bookings);
  console.log(`   ✅ ${bookings.length} bookings migrated\n`);
}

// ─── 5. INIT EMPTY FILES ──────────────────────────

function initEmptyFiles() {
  console.log("5. Initializing new data files...");

  const filesToInit = [
    [FILES.payments, []],
    [FILES.password_reset_codes, []],
    [FILES.audit_logs, []],
    [FILES.promo_codes, []],
    [FILES.blacklist, []],
    [FILES.settings, DEFAULT_SETTINGS],
  ];

  for (const [file, defaultData] of filesToInit) {
    const name = path.basename(file);
    if (!fs.existsSync(file)) {
      writeJSON(file, defaultData);
      console.log(`   ✅ Created ${name}`);
    } else {
      console.log(`   ℹ️  ${name} already exists`);
    }
  }

  // Ensure clients.json and jobs.json exist
  if (!fs.existsSync(FILES.clients)) writeJSON(FILES.clients, []);
  if (!fs.existsSync(FILES.jobs)) writeJSON(FILES.jobs, []);

  console.log("");
}

// ─── RUN ───────────────────────────────────────────

migrate().catch((err) => {
  console.error("\n❌ Migration failed:", err);
  process.exit(1);
});
