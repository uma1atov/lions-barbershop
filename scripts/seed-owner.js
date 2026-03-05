#!/usr/bin/env node
/**
 * seed-owner.js — CLI script to create OWNER_ADMIN
 *
 * Usage:
 *   node scripts/seed-owner.js
 *
 * Reads from .env:
 *   OWNER_ADMIN_PHONE, OWNER_ADMIN_PASSWORD, OWNER_ADMIN_NAME, OWNER_ADMIN_EMAIL
 *
 * Or pass as arguments:
 *   node scripts/seed-owner.js --phone=+79001234567 --password=secret --name="Admin" --email=admin@test.com
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { readJSON, writeJSON, FILES, genId } = require("../lib/db");
const { hashPassword } = require("../lib/auth");
const { ROLES } = require("../lib/rbac");

// Parse CLI args
const args = {};
process.argv.slice(2).forEach((arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  if (key && val) args[key] = val;
});

async function seed() {
  const phone = args.phone || process.env.OWNER_ADMIN_PHONE;
  const password = args.password || process.env.OWNER_ADMIN_PASSWORD;
  const name = args.name || process.env.OWNER_ADMIN_NAME || "Owner Admin";
  const email = args.email || process.env.OWNER_ADMIN_EMAIL || "";

  if (!phone || !password) {
    console.error("ERROR: Provide OWNER_ADMIN_PHONE and OWNER_ADMIN_PASSWORD");
    console.error("  Via .env file or CLI: --phone=... --password=...");
    process.exit(1);
  }

  const users = readJSON(FILES.users);

  // Check max OWNER_ADMIN count
  const maxOwners = parseInt(process.env.MAX_OWNER_ADMINS || "2", 10);
  const existing = users.filter((u) => u.role === ROLES.OWNER_ADMIN);
  if (existing.length >= maxOwners) {
    console.error(`ERROR: Already ${existing.length} owner_admin(s). Max: ${maxOwners}`);
    process.exit(1);
  }

  // Check if phone already registered
  const dup = users.find((u) => u.phone === phone);
  if (dup) {
    if (dup.role === ROLES.OWNER_ADMIN) {
      console.log(`OWNER_ADMIN with phone ${phone} already exists (${dup.name})`);
      process.exit(0);
    }
    // Promote existing user
    dup.role = ROLES.OWNER_ADMIN;
    dup.password = await hashPassword(password);
    dup.email = email || dup.email;
    dup.is_active = true;
    dup.updated_at = new Date().toISOString();
    writeJSON(FILES.users, users);
    console.log(`Promoted existing user "${dup.name}" (${phone}) to OWNER_ADMIN`);
    process.exit(0);
  }

  // Create new
  const hashed = await hashPassword(password);
  const user = {
    id: genId(),
    name,
    phone,
    email: email || null,
    password: hashed,
    role: ROLES.OWNER_ADMIN,
    is_active: true,
    is_blacklisted: false,
    last_login_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  users.push(user);
  writeJSON(FILES.users, users);

  console.log(`OWNER_ADMIN created successfully!`);
  console.log(`  Name:  ${name}`);
  console.log(`  Phone: ${phone}`);
  console.log(`  Email: ${email || "(not set)"}`);
  console.log(`  ID:    ${user.id}`);
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
