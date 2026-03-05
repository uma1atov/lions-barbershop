/**
 * email.js — Nodemailer SMTP transport for OTP and notifications
 */
const nodemailer = require("nodemailer");

let transporter = null;

/**
 * Get or create SMTP transporter
 */
function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP не настроен (SMTP_HOST, SMTP_USER, SMTP_PASS)");
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

/**
 * Send OTP code for password recovery
 * @param {string} to - email address
 * @param {string} otp - 6-digit code
 */
async function sendOTP(to, otp) {
  const transport = getTransporter();
  const from = process.env.SMTP_FROM || "noreply@lionsbarbershop.ru";

  await transport.sendMail({
    from: `"The Lion's Den Barbershop" <${from}>`,
    to,
    subject: "Код восстановления пароля — The Lion's Den",
    text: `Ваш код восстановления пароля: ${otp}\n\nКод действителен 10 минут.\n\nЕсли вы не запрашивали сброс пароля, проигнорируйте это письмо.\n\nThe Lion's Den Barbershop`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #d4a843; text-align: center;">The Lion's Den Barbershop</h2>
        <hr style="border: 1px solid #d4a843;">
        <p>Ваш код восстановления пароля:</p>
        <div style="background: #0a0a14; color: #e8c84a; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="color: #666; font-size: 14px;">Код действителен 10 минут.</p>
        <p style="color: #999; font-size: 12px;">Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
        <hr style="border: 1px solid #eee;">
        <p style="color: #999; font-size: 11px; text-align: center;">The Lion's Den Barbershop</p>
      </div>
    `,
  });
}

/**
 * Send booking confirmation email
 * @param {string} to - email address
 * @param {Object} booking - booking object
 */
async function sendBookingConfirmation(to, booking) {
  const transport = getTransporter();
  const from = process.env.SMTP_FROM || "noreply@lionsbarbershop.ru";

  await transport.sendMail({
    from: `"The Lion's Den Barbershop" <${from}>`,
    to,
    subject: `Подтверждение записи — ${booking.date} в ${booking.time}`,
    text: `Ваша запись подтверждена!\n\nУслуга: ${booking.service_name || booking.service}\nДата: ${booking.date}\nВремя: ${booking.time}\nМастер: ${booking.barber_name || booking.master}\nСтоимость: ${booking.price_final}₽\n\nThe Lion's Den Barbershop`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #d4a843; text-align: center;">The Lion's Den Barbershop</h2>
        <hr style="border: 1px solid #d4a843;">
        <h3>Ваша запись подтверждена!</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px; color: #666;">Услуга:</td><td style="padding: 8px; font-weight: bold;">${booking.service_name || booking.service}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Дата:</td><td style="padding: 8px; font-weight: bold;">${booking.date}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Время:</td><td style="padding: 8px; font-weight: bold;">${booking.time}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Мастер:</td><td style="padding: 8px; font-weight: bold;">${booking.barber_name || booking.master}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Стоимость:</td><td style="padding: 8px; font-weight: bold;">${booking.price_final}₽</td></tr>
        </table>
        <hr style="border: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; text-align: center;">The Lion's Den Barbershop</p>
      </div>
    `,
  });
}

/**
 * Send booking reminder email
 * @param {string} to - email address
 * @param {Object} booking - booking object
 */
async function sendBookingReminder(to, booking) {
  const transport = getTransporter();
  const from = process.env.SMTP_FROM || "noreply@lionsbarbershop.ru";

  await transport.sendMail({
    from: `"The Lion's Den Barbershop" <${from}>`,
    to,
    subject: `Напоминание о записи — ${booking.date} в ${booking.time}`,
    text: `Напоминаем о вашей записи!\n\nУслуга: ${booking.service_name || booking.service}\nДата: ${booking.date}\nВремя: ${booking.time}\nМастер: ${booking.barber_name || booking.master}\n\nЖдём вас в The Lion's Den!`,
  });
}

module.exports = {
  getTransporter,
  sendOTP,
  sendBookingConfirmation,
  sendBookingReminder,
};
