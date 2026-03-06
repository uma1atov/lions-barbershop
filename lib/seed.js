/**
 * seed.js — Auto-seed OWNER_ADMIN on first startup
 * Also provides manual seed function for CLI usage
 */
const { readJSON, writeJSON, FILES, genId } = require("./db");
const { hashPassword, isHashed } = require("./auth");
const { ROLES } = require("./rbac");

/**
 * Auto-seed: check if OWNER_ADMIN exists, create from ENV if not
 * Called once on server startup
 */
async function autoSeed() {
  try {
    const users = readJSON(FILES.users);
    const hasOwner = users.some((u) => u.role === ROLES.OWNER_ADMIN);

    if (hasOwner) return; // Already seeded

    const phone = process.env.OWNER_ADMIN_PHONE || "+79285758000";
    const password = process.env.OWNER_ADMIN_PASSWORD || "Apple1998";
    const name = process.env.OWNER_ADMIN_NAME || "Админ Kamal";
    const email = process.env.OWNER_ADMIN_EMAIL || "";

    if (!phone || !password) {
      console.log("INFO: No OWNER_ADMIN found. Set OWNER_ADMIN_PHONE and OWNER_ADMIN_PASSWORD in .env to auto-create.");
      return;
    }

    // Check if phone already taken by another user
    const existing = users.find((u) => u.phone === phone);
    if (existing) {
      // Promote existing user to owner_admin
      existing.role = ROLES.OWNER_ADMIN;
      if (email && !existing.email) existing.email = email;
      if (!isHashed(existing.password)) {
        existing.password = await hashPassword(password);
      }
      existing.is_active = true;
      existing.updated_at = new Date().toISOString();
      writeJSON(FILES.users, users);
      console.log(`OWNER_ADMIN: promoted existing user ${existing.name} (${phone})`);
      return;
    }

    // Create new OWNER_ADMIN
    const hashed = await hashPassword(password);
    users.push({
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
    });

    writeJSON(FILES.users, users);
    console.log(`OWNER_ADMIN created: ${name} (${phone})`);
  } catch (err) {
    console.error("Auto-seed error:", err.message);
  }
}

module.exports = { autoSeed };
