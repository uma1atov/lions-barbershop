/**
 * chat.routes.js — Ollama AI Chat (moved from server.js)
 */
const router = require("express").Router();
const { readJSON, writeJSON, FILES, genId } = require("../lib/db");
const { optionalAuth } = require("../middleware/authenticate");
const { logAudit } = require("../lib/audit");

// ─── System prompt builder ─────────────────────────
function getSystemPrompt(isRegistered) {
  // Load services dynamically from DB
  const services = readJSON(FILES.services).filter((s) => s.is_active);
  const barbers = readJSON(FILES.barbers).filter((b) => b.isActive);

  const servicesText = services
    .map((s, i) => `${i + 1}. ${s.name} — ${s.price}₽ (${s.duration} мин)`)
    .join("\n");

  const barbersText = barbers
    .map((b) => `- ${b.name} — ${b.bio || ""} ${b.experience || ""}`.trim())
    .join("\n");

  const discountNote = isRegistered
    ? `\nВАЖНО: Этот клиент зарегистрирован и имеет скидку 10% на все услуги. Упоминай об этом при озвучивании цен. Рассчитывай цену со скидкой.\nПример: "Мужская стрижка — 1350₽ (со скидкой 10%, обычная цена 1500₽)".`
    : `\nЕсли клиент спрашивает про скидки, скажи что зарегистрированные клиенты получают скидку 10% на все услуги. Предложи зарегистрироваться на сайте.`;

  return `Ты — ИИ-помощник мужского барбершопа "The Lion's Den". Твоя задача — помогать клиентам записаться на услуги.

ВАЖНО: Отвечай ТОЛЬКО на русском языке. Никогда не используй другие языки.

ИНФОРМАЦИЯ О БАРБЕРШОПЕ:
- Название: The Lion's Den Barbershop
- Адрес: ул. Примерная, д. 42, Москва
- Режим работы: ежедневно 9:00-20:00, без выходных
- Телефон / тех.поддержка: +7 (960) 408-37-44
- Это МУЖСКОЙ барбершоп. Женские услуги НЕ оказываем.

УСЛУГИ И ЦЕНЫ:
${servicesText}
${discountNote}

БАРБЕРЫ:
${barbersText}

ПРАВИЛА:
1. Будь дружелюбным, кратко и по делу.
2. Отвечай ТОЛЬКО на русском.
3. Женские услуги не оказываем — вежливо объясни.
4. Для записи собирай по очереди: услугу → имя → телефон → дату/время → барбера (необязательно).
5. Когда ВСЕ данные собраны, подтверди и добавь JSON:

Отлично! Записал вас:
- Услуга: [услуга]
- Дата: [дата], Время: [время]
- Барбер: [барбер или "любой свободный"]

Ждём вас в The Lion's Den!

\`\`\`booking
{"name":"Имя","phone":"телефон","service":"услуга","date":"ГГГГ-ММ-ДД","time":"ЧЧ:ММ","master":"барбер"}
\`\`\`

6. Сегодня ${new Date().toISOString().split("T")[0]}.
7. Работаем без выходных. Тех.поддержка: +7 (960) 408-37-44.`;
}

// ─── POST /api/chat ────────────────────────────────
// Public (optionalAuth): AI chat with booking creation
router.post("/", optionalAuth, async (req, res) => {
  const { messages } = req.body;
  const isRegistered = req.user && req.user.role === "client";

  const ollamaMessages = [
    { role: "system", content: getSystemPrompt(isRegistered) },
    ...messages,
  ];

  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2:3b",
        messages: ollamaMessages,
        stream: false,
        options: { temperature: 0.7, num_predict: 500 },
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Ollama не отвечает. Запустите: ollama serve" });
    }

    const data = await response.json();
    let msg = data.message?.content || "Ошибка";

    // Parse booking JSON from response
    const match = msg.match(/```booking\s*\n([\s\S]*?)\n```/);
    if (match) {
      try {
        const bookingData = JSON.parse(match[1]);

        // Get service details
        const services = readJSON(FILES.services);
        const serviceObj = services.find(
          (s) => s.name === bookingData.service || s.id === bookingData.service
        );

        const discountPercent = isRegistered ? 10 : 0;
        const priceOriginal = serviceObj ? serviceObj.price : 0;
        const priceFinal = Math.round(priceOriginal * (1 - discountPercent / 100));

        const slotStart = new Date(`${bookingData.date}T${bookingData.time}:00`);

        const booking = {
          id: genId(),
          name: bookingData.name,
          phone: bookingData.phone,
          service: bookingData.service,
          date: bookingData.date,
          time: bookingData.time,
          master: bookingData.master || "любой свободный",
          discount: discountPercent,
          userId: req.user ? req.user.id : null,
          createdAt: new Date().toISOString(),
          source: "chat",
          // Extended fields
          service_id: serviceObj ? serviceObj.id : null,
          service_name: serviceObj ? serviceObj.name : bookingData.service,
          barber_name: bookingData.master || "любой свободный",
          client_name: bookingData.name,
          client_phone: bookingData.phone,
          client_user_id: req.user ? req.user.id : null,
          start_at: slotStart.toISOString(),
          end_at: new Date(
            slotStart.getTime() + (serviceObj ? serviceObj.duration : 60) * 60 * 1000
          ).toISOString(),
          duration_minutes: serviceObj ? serviceObj.duration : 60,
          price_original: priceOriginal,
          discount_percent: discountPercent,
          price_final: priceFinal,
          promo_code: null,
          status: "scheduled",
          notes: "",
          created_by: req.user ? req.user.id : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          statusConfirm: "pending",
          confirmChannel: "none",
          confirmLastMessageAt: null,
          confirmResponseAt: null,
          confirmLog: [],
        };

        const bookings = readJSON(FILES.bookings);
        bookings.push(booking);
        writeJSON(FILES.bookings, bookings);

        logAudit({
          actorUserId: req.user ? req.user.id : null,
          action: "booking.create",
          entityType: "booking",
          entityId: booking.id,
          meta: { source: "chat", service: booking.service_name },
          ip: req.ip,
        });

        // Schedule confirmation jobs (optional integration)
        try {
          const { scheduleConfirmationJobs } = require("../integrations/jobs");
          scheduleConfirmationJobs(booking);
        } catch (e) {
          /* integrations optional */
        }
      } catch (e) {
        console.error("Ошибка парсинга записи из чата:", e);
      }
    }

    // Remove booking JSON from response
    msg = msg.replace(/```booking\s*\n[\s\S]*?\n```/, "").trim();
    res.json({ message: msg });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(502).json({ error: "Не удалось подключиться к Ollama. Запустите: ollama serve" });
  }
});

module.exports = router;
