/**
 * auth.routes.js — Registration, Login, Logout, Profile, Password Reset
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId } = require("../lib/db");
const { hashPassword, verifyPassword, isHashed, signToken, generateOTP } = require("../lib/auth");
const { logAudit } = require("../lib/audit");
const { ROLES } = require("../lib/rbac");
const { authenticate } = require("../middleware/authenticate");
const { loginLimiter, registerLimiter, passwordResetLimiter, otpVerifyLimiter } = require("../middleware/rateLimiter");

// ─── POST /api/register ────────────────────────────
// Public: register as CLIENT only. Admin registration → 403
router.post("/register", registerLimiter, async (req, res, next) => {
  try {
    const { name, phone, password, email, role } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ error: "Заполните все поля" });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: "Пароль минимум 4 символа" });
    }

    // SECURITY: Block any non-client registration
    if (role && role !== "client") {
      return res.status(403).json({ error: "Регистрация с данной ролью запрещена" });
    }

    const users = readJSON(FILES.users);
    if (users.find((u) => u.phone === phone)) {
      return res.status(409).json({ error: "Этот номер уже зарегистрирован" });
    }
    if (email && users.find((u) => u.email === email)) {
      return res.status(409).json({ error: "Этот email уже зарегистрирован" });
    }

    const hashedPassword = await hashPassword(password);
    const user = {
      id: genId(),
      name,
      phone,
      email: email || null,
      password: hashedPassword,
      role: ROLES.CLIENT,
      is_active: true,
      is_blacklisted: false,
      last_login_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    users.push(user);
    writeJSON(FILES.users, users);

    const token = signToken({ id: user.id, role: user.role });

    logAudit({
      actorUserId: user.id,
      action: "user.register",
      entityType: "user",
      entityId: user.id,
      ip: req.ip,
    });

    res.json({
      token,
      user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/login ───────────────────────────────
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: "Заполните все поля" });
    }

    const users = readJSON(FILES.users);
    const user = users.find((u) => u.phone === phone);

    if (!user) {
      return res.status(401).json({ error: "Неверный номер или пароль" });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: "Аккаунт заблокирован" });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Неверный номер или пароль" });
    }

    // Opportunistic migration: re-hash plaintext passwords
    if (!isHashed(user.password)) {
      const idx = users.findIndex((u) => u.id === user.id);
      users[idx].password = await hashPassword(password);
      users[idx].updated_at = new Date().toISOString();
      writeJSON(FILES.users, users);
    }

    // Update last_login_at
    const idx = users.findIndex((u) => u.id === user.id);
    users[idx].last_login_at = new Date().toISOString();
    writeJSON(FILES.users, users);

    const token = signToken({ id: user.id, role: user.role });

    logAudit({
      actorUserId: user.id,
      action: "user.login",
      entityType: "user",
      entityId: user.id,
      ip: req.ip,
    });

    res.json({
      token,
      user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/logout ──────────────────────────────
router.post("/logout", authenticate, (req, res) => {
  logAudit({
    actorUserId: req.user.id,
    action: "user.logout",
    entityType: "user",
    entityId: req.user.id,
    ip: req.ip,
  });
  res.json({ ok: true });
});

// ─── GET /api/me ───────────────────────────────────
router.get("/me", authenticate, (req, res) => {
  res.json(req.user);
});

// ─── PATCH /api/me ─────────────────────────────────
// Update own profile (name, phone, email)
router.patch("/me", authenticate, async (req, res, next) => {
  try {
    const { name, phone, email } = req.body;
    const users = readJSON(FILES.users);
    const idx = users.findIndex((u) => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: "Пользователь не найден" });

    // Check phone uniqueness
    if (phone && phone !== users[idx].phone) {
      if (users.find((u) => u.phone === phone && u.id !== req.user.id)) {
        return res.status(409).json({ error: "Этот номер уже занят" });
      }
      users[idx].phone = phone;
    }

    // Check email uniqueness
    if (email !== undefined) {
      if (email && users.find((u) => u.email === email && u.id !== req.user.id)) {
        return res.status(409).json({ error: "Этот email уже занят" });
      }
      users[idx].email = email || null;
    }

    if (name) users[idx].name = name;
    users[idx].updated_at = new Date().toISOString();

    writeJSON(FILES.users, users);

    logAudit({
      actorUserId: req.user.id,
      action: "user.update_profile",
      entityType: "user",
      entityId: req.user.id,
      ip: req.ip,
    });

    res.json({
      id: users[idx].id,
      name: users[idx].name,
      phone: users[idx].phone,
      email: users[idx].email,
      role: users[idx].role,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/me/password ────────────────────────
// Change own password (requires current password)
router.patch("/me/password", authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Укажите текущий и новый пароль" });
    }
    if (new_password.length < 4) {
      return res.status(400).json({ error: "Новый пароль минимум 4 символа" });
    }

    const users = readJSON(FILES.users);
    const user = users.find((u) => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    const valid = await verifyPassword(current_password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Неверный текущий пароль" });
    }

    user.password = await hashPassword(new_password);
    user.updated_at = new Date().toISOString();
    writeJSON(FILES.users, users);

    logAudit({
      actorUserId: req.user.id,
      action: "user.change_password",
      entityType: "user",
      entityId: req.user.id,
      ip: req.ip,
    });

    res.json({ ok: true, message: "Пароль изменён" });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/password-reset/request ──────────────
router.post("/password-reset/request", passwordResetLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Укажите email" });

    // Always return 200 (don't leak whether email exists)
    const users = readJSON(FILES.users);
    const user = users.find((u) => u.email === email);

    if (user) {
      // Check lockout
      const codes = readJSON(FILES.password_reset_codes);
      const recent = codes.find(
        (c) => c.user_id === user.id && !c.used_at && c.locked_until && new Date(c.locked_until) > new Date()
      );
      if (recent) {
        return res.status(429).json({ error: "Слишком много попыток. Попробуйте позже." });
      }

      const otp = generateOTP();
      const code = {
        id: genId(),
        user_id: user.id,
        code_hash: await hashPassword(otp),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
        attempts: 0,
        used_at: null,
        locked_until: null,
        created_at: new Date().toISOString(),
      };
      codes.push(code);
      writeJSON(FILES.password_reset_codes, codes);

      // Try to send email (silently fail if SMTP not configured)
      try {
        const { sendOTP } = require("../lib/email");
        await sendOTP(email, otp);
      } catch (emailErr) {
        console.log("Email send failed (SMTP not configured?):", emailErr.message);
        // In dev mode, log OTP to console
        if (process.env.NODE_ENV !== "production") {
          console.log(`DEV: OTP for ${email}: ${otp}`);
        }
      }

      logAudit({
        actorUserId: null,
        action: "user.password_reset_request",
        entityType: "user",
        entityId: user.id,
        meta: { email },
        ip: req.ip,
      });
    }

    res.json({ ok: true, message: "Если email зарегистрирован, код отправлен" });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/password-reset/verify ───────────────
router.post("/password-reset/verify", otpVerifyLimiter, async (req, res, next) => {
  try {
    const { email, code, new_password } = req.body;
    if (!email || !code || !new_password) {
      return res.status(400).json({ error: "Заполните все поля" });
    }
    if (new_password.length < 4) {
      return res.status(400).json({ error: "Пароль минимум 4 символа" });
    }

    const users = readJSON(FILES.users);
    const user = users.find((u) => u.email === email);
    if (!user) return res.status(400).json({ error: "Неверный email или код" });

    const codes = readJSON(FILES.password_reset_codes);
    // Find the latest unused code for this user
    const codeRecord = codes
      .filter((c) => c.user_id === user.id && !c.used_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    if (!codeRecord) {
      return res.status(400).json({ error: "Код не найден. Запросите новый." });
    }

    // Check expiry
    if (new Date(codeRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: "Код истёк. Запросите новый." });
    }

    // Check lockout
    if (codeRecord.locked_until && new Date(codeRecord.locked_until) > new Date()) {
      return res.status(429).json({ error: "Слишком много попыток. Подождите 30 минут." });
    }

    // Increment attempts
    codeRecord.attempts++;

    // Lock after 5 attempts
    if (codeRecord.attempts >= 5) {
      codeRecord.locked_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      writeJSON(FILES.password_reset_codes, codes);
      return res.status(429).json({ error: "Превышено число попыток. Подождите 30 минут." });
    }

    // Verify code
    const valid = await verifyPassword(code, codeRecord.code_hash);
    if (!valid) {
      writeJSON(FILES.password_reset_codes, codes);
      return res.status(400).json({
        error: "Неверный код",
        attempts_left: 5 - codeRecord.attempts,
      });
    }

    // Success! Update password
    user.password = await hashPassword(new_password);
    user.updated_at = new Date().toISOString();
    writeJSON(FILES.users, users);

    // Mark code as used
    codeRecord.used_at = new Date().toISOString();
    writeJSON(FILES.password_reset_codes, codes);

    logAudit({
      actorUserId: user.id,
      action: "user.password_reset_complete",
      entityType: "user",
      entityId: user.id,
      ip: req.ip,
    });

    res.json({ ok: true, message: "Пароль изменён. Войдите с новым паролем." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
