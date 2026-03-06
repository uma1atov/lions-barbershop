/**
 * points.js — Loyalty Points System Core Logic
 *
 * Centralized module for earning, spending, refunding, and expiring points.
 * All point rules come from settings (configurable by admin).
 */
const { readJSON, writeJSON, FILES, genId, getSettings } = require("./db");

// ─── Helper: recalculate cached user.points from history ──
function _recalcActivePoints(user) {
  const now = new Date();
  const history = user.points_history || [];
  return history
    .filter(
      (e) =>
        e.amount > 0 &&
        e.status === "active" &&
        (!e.expires_at || new Date(e.expires_at) > now)
    )
    .reduce((sum, e) => sum + e.amount, 0);
}

// ─── Migrate old points_history entries (no id/status/expires_at) ──
function _migrateEntry(entry, settings) {
  if (entry.id && entry.status) return entry; // already migrated
  const expirationDays = settings.points_expiration_days || 45;
  const earnedAt = entry.earned_at || entry.date || new Date().toISOString();
  const expiresAt = new Date(
    new Date(earnedAt).getTime() + expirationDays * 24 * 60 * 60 * 1000
  ).toISOString();

  return {
    ...entry,
    id: entry.id || genId(),
    earned_at: entry.amount > 0 ? earnedAt : undefined,
    expires_at: entry.amount > 0 ? expiresAt : undefined,
    status: entry.amount > 0 ? "active" : "spent",
  };
}

function _ensureMigrated(user, settings) {
  if (!user.points_history) {
    user.points_history = [];
    return false;
  }
  let changed = false;
  for (let i = 0; i < user.points_history.length; i++) {
    const orig = user.points_history[i];
    if (!orig.id || !orig.status) {
      user.points_history[i] = _migrateEntry(orig, settings);
      changed = true;
    }
  }
  return changed;
}

/**
 * Get active (non-expired, non-spent) points for a user.
 */
function getUserPoints(userId) {
  const settings = getSettings();
  const users = readJSON(FILES.users);
  const user = users.find((u) => u.id === userId);
  if (!user) return null;

  _ensureMigrated(user, settings);

  const now = new Date();
  const history = user.points_history || [];
  const warningDays = settings.points_expiration_warning_days || 5;

  // Active entries: positive amount, status=active, not expired
  const activeEntries = history.filter(
    (e) =>
      e.amount > 0 &&
      e.status === "active" &&
      (!e.expires_at || new Date(e.expires_at) > now)
  );

  const activePoints = activeEntries.reduce((sum, e) => sum + e.amount, 0);

  // Expiring entries: within warning window
  const warningThreshold = new Date(
    now.getTime() + warningDays * 24 * 60 * 60 * 1000
  );
  const expiringEntries = activeEntries.filter(
    (e) => e.expires_at && new Date(e.expires_at) <= warningThreshold
  );
  const expiringPoints = expiringEntries.reduce((sum, e) => sum + e.amount, 0);

  // Earliest expiry
  let expiringDays = null;
  if (expiringEntries.length > 0) {
    const earliest = expiringEntries
      .map((e) => new Date(e.expires_at))
      .sort((a, b) => a - b)[0];
    expiringDays = Math.max(
      0,
      Math.ceil((earliest - now) / (24 * 60 * 60 * 1000))
    );
  }

  return {
    activePoints,
    expiringPoints,
    expiringDays,
    history: history.slice(-30).reverse(),
  };
}

/**
 * Earn points for a user (capped at max).
 */
function earnPoints(
  userId,
  { type, amount, booking_id, review_id, admin_id, reason }
) {
  const settings = getSettings();
  const users = readJSON(FILES.users);
  const userIdx = users.findIndex((u) => u.id === userId);
  if (userIdx === -1) return null;

  const user = users[userIdx];
  _ensureMigrated(user, settings);

  const now = new Date();
  const currentActive = _recalcActivePoints(user);
  const maxCap = settings.points_max_cap || 10;

  // Cap: can only earn up to maxCap total
  const canEarn = Math.max(0, maxCap - currentActive);
  const actualEarn = Math.min(amount, canEarn);

  if (actualEarn <= 0) return { pointsEarned: 0, totalPoints: currentActive };

  const expirationDays = settings.points_expiration_days || 45;
  const expiresAt = new Date(
    now.getTime() + expirationDays * 24 * 60 * 60 * 1000
  );

  const entry = {
    id: genId(),
    type,
    amount: actualEarn,
    earned_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    booking_id: booking_id || null,
    review_id: review_id || null,
    admin_id: admin_id || null,
    reason: reason || null,
    date: now.toISOString(),
    status: "active",
  };

  user.points_history.push(entry);
  user.points = currentActive + actualEarn;
  writeJSON(FILES.users, users);

  return { pointsEarned: actualEarn, totalPoints: user.points };
}

/**
 * Spend points during booking.
 * FIFO: spend soonest-to-expire first.
 */
function spendPoints(userId, pointsToSpend, bookingId) {
  const settings = getSettings();
  const users = readJSON(FILES.users);
  const userIdx = users.findIndex((u) => u.id === userId);
  if (userIdx === -1) return null;

  const user = users[userIdx];
  _ensureMigrated(user, settings);

  const now = new Date();
  const maxSpend = settings.points_max_spend_per_booking || 5;
  const valuePercent = settings.points_value_percent || 10;

  // Active entries sorted by expiry (FIFO — spend soonest first)
  const activeEntries = user.points_history
    .filter(
      (e) =>
        e.amount > 0 &&
        e.status === "active" &&
        (!e.expires_at || new Date(e.expires_at) > now)
    )
    .sort((a, b) => (a.expires_at || "").localeCompare(b.expires_at || ""));

  const totalActive = activeEntries.reduce((sum, e) => sum + e.amount, 0);
  const spend = Math.min(pointsToSpend, totalActive, maxSpend);

  if (spend <= 0) return null;

  // Mark earning entries as "spent" (FIFO)
  let remaining = spend;
  const consumedIds = [];
  for (const entry of activeEntries) {
    if (remaining <= 0) break;
    const entryIdx = user.points_history.findIndex((e) => e.id === entry.id);
    if (entryIdx === -1) continue;

    if (entry.amount <= remaining) {
      user.points_history[entryIdx].status = "spent";
      consumedIds.push(entry.id);
      remaining -= entry.amount;
    } else {
      // Partial: reduce amount, create a spent copy
      const spentAmount = remaining;
      user.points_history[entryIdx].amount -= spentAmount;
      const spentCopy = {
        ...user.points_history[entryIdx],
        id: genId(),
        amount: spentAmount,
        status: "spent",
      };
      user.points_history.push(spentCopy);
      consumedIds.push(spentCopy.id);
      remaining = 0;
    }
  }

  // Create spend record
  const spendEntry = {
    id: genId(),
    type: "spent",
    amount: -spend,
    booking_id: bookingId,
    point_ids: consumedIds,
    discount_percent: spend * valuePercent,
    date: now.toISOString(),
    status: "spent",
  };
  user.points_history.push(spendEntry);

  // Recalculate cached points
  user.points = _recalcActivePoints(user);
  writeJSON(FILES.users, users);

  return {
    pointsSpent: spend,
    discountPercent: spend * valuePercent,
    spendEntryId: spendEntry.id,
  };
}

/**
 * Refund points from a cancelled booking.
 * Restores the earning entries that were consumed.
 */
function refundPoints(userId, bookingId) {
  const users = readJSON(FILES.users);
  const userIdx = users.findIndex((u) => u.id === userId);
  if (userIdx === -1) return false;

  const user = users[userIdx];
  if (!user.points_history) return false;

  // Find spend entry for this booking
  const spendEntry = user.points_history.find(
    (e) => e.type === "spent" && e.booking_id === bookingId && e.status === "spent"
  );
  if (!spendEntry) return false;

  // Mark spend entry as refunded
  const spendIdx = user.points_history.findIndex((e) => e.id === spendEntry.id);
  user.points_history[spendIdx].status = "refunded";

  // Restore consumed earning entries
  const consumedIds = spendEntry.point_ids || [];
  consumedIds.forEach((cid) => {
    const earnIdx = user.points_history.findIndex((e) => e.id === cid);
    if (earnIdx !== -1 && user.points_history[earnIdx].status === "spent") {
      user.points_history[earnIdx].status = "active";
    }
  });

  // Add refund record
  user.points_history.push({
    id: genId(),
    type: "refund",
    amount: Math.abs(spendEntry.amount),
    booking_id: bookingId,
    date: new Date().toISOString(),
    status: "refunded",
  });

  // Recalculate
  user.points = _recalcActivePoints(user);
  writeJSON(FILES.users, users);

  return true;
}

/**
 * Run expiration sweep: mark expired entries.
 * Called periodically by server.js setInterval.
 */
function expirePoints() {
  const users = readJSON(FILES.users);
  const now = new Date();
  let changed = false;

  users.forEach((user) => {
    if (!user.points_history) return;
    user.points_history.forEach((entry) => {
      if (
        entry.status === "active" &&
        entry.amount > 0 &&
        entry.expires_at &&
        new Date(entry.expires_at) <= now
      ) {
        entry.status = "expired";
        changed = true;
      }
    });
    if (changed) {
      user.points = _recalcActivePoints(user);
    }
  });

  if (changed) writeJSON(FILES.users, users);
}

/**
 * Admin: manually give points to a user
 */
function adminGivePoints(userId, amount, adminId, reason) {
  return earnPoints(userId, {
    type: "admin_give",
    amount,
    admin_id: adminId,
    reason: reason || "Начислено администратором",
  });
}

/**
 * Admin: manually take points from a user
 */
function adminTakePoints(userId, amount, adminId, reason) {
  const settings = getSettings();
  const users = readJSON(FILES.users);
  const userIdx = users.findIndex((u) => u.id === userId);
  if (userIdx === -1) return null;

  const user = users[userIdx];
  _ensureMigrated(user, settings);

  const now = new Date();
  // Take from active entries (FIFO by expiry)
  const activeEntries = user.points_history
    .filter(
      (e) =>
        e.amount > 0 &&
        e.status === "active" &&
        (!e.expires_at || new Date(e.expires_at) > now)
    )
    .sort((a, b) => (a.expires_at || "").localeCompare(b.expires_at || ""));

  const totalActive = activeEntries.reduce((sum, e) => sum + e.amount, 0);
  const take = Math.min(amount, totalActive);
  if (take <= 0) return { pointsTaken: 0, totalPoints: totalActive };

  let remaining = take;
  for (const entry of activeEntries) {
    if (remaining <= 0) break;
    const idx = user.points_history.findIndex((e) => e.id === entry.id);
    if (entry.amount <= remaining) {
      user.points_history[idx].status = "spent";
      remaining -= entry.amount;
    } else {
      user.points_history[idx].amount -= remaining;
      remaining = 0;
    }
  }

  user.points_history.push({
    id: genId(),
    type: "admin_take",
    amount: -take,
    admin_id: adminId,
    reason: reason || "Списано администратором",
    date: now.toISOString(),
    status: "spent",
  });

  user.points = _recalcActivePoints(user);
  writeJSON(FILES.users, users);

  return { pointsTaken: take, totalPoints: user.points };
}

module.exports = {
  getUserPoints,
  earnPoints,
  spendPoints,
  refundPoints,
  expirePoints,
  adminGivePoints,
  adminTakePoints,
};
