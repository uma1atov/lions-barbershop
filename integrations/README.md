# The Lion's Den Barbershop — Интеграции

## Обзор
Модуль подтверждения визитов через Telegram и WhatsApp + управление барберами.

## Архитектура
```
integrations/
├── config.js              # Конфигурация из ENV
├── jobs.js                # Очередь задач (JSON-файл)
├── clients.js             # Управление клиентами (привязка мессенджеров)
├── notifications.js       # Ядро уведомлений
├── scheduler.js           # Планировщик (node-cron)
├── index.js               # Точка входа + роутер
├── tests.js               # Тесты
├── telegram/
│   ├── bot.js             # Telegram Bot API
│   └── webhook.js         # Обработка webhook
└── whatsapp/
    ├── provider.js         # Фабрика провайдеров
    ├── webhook.js          # Обработка webhook
    └── providers/
        ├── twilio.js       # Адаптер Twilio
        └── meta.js         # Адаптер Meta Cloud API
```

## Быстрый старт

### 1. Установка
```bash
npm install
cp .env.example .env
```

### 2. Настройка Telegram бота
1. Откройте @BotFather в Telegram
2. `/newbot` → Создайте бота → Скопируйте токен
3. Впишите в `.env`:
```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ADMIN_CHAT_ID=ваш_chat_id
```
4. Узнать свой chat_id: напишите @userinfobot

### 3. Установка Telegram webhook
После запуска сервера с публичным URL (ngrok, cloudflare tunnel):
```bash
curl -X POST http://localhost:3001/integrations/setup-telegram-webhook \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-domain.com"}'
```

### 4. Привязка клиента к Telegram
Клиент открывает ссылку: `https://t.me/your_bot?start=phone_+79001234567`
Или отправляет боту свой номер телефона.

### 5. Настройка WhatsApp (опционально)

#### Twilio:
```env
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```
Webhook URL: `https://your-domain.com/integrations/whatsapp/webhook`

#### Meta Cloud API:
```env
WHATSAPP_PROVIDER=meta
META_WA_TOKEN=EAAxxxxx
META_WA_PHONE_NUMBER_ID=123456
META_WA_VERIFY_TOKEN=my-verify-token
META_WA_APP_SECRET=xxxxx
```

## Как работает подтверждение
1. Клиент записывается через сайт (календарь или чат)
2. Автоматически создаются 2 задачи:
   - `pre_confirm_30m` — за 30 мин до визита
   - `no_response_10m` — за 10 мин до визита
3. За 30 мин клиенту приходит сообщение с кнопками
4. При ответе:
   - Статус записи обновляется
   - Барбер получает уведомление в Telegram
5. Если нет ответа за 10 мин — статус `no_response`

## Управление барберами
- `GET /api/admin/barbers` — список (admin/manager)
- `POST /api/admin/barbers` — создать (admin)
- `PATCH /api/admin/barbers/:id` — обновить (admin/manager)
- `DELETE /api/admin/barbers/:id` — деактивировать (admin)
- `PATCH /api/admin/barbers/:id/telegram-link` — привязать Telegram

## Закрытие прошедших слотов
- Backend: `POST /api/book` отклоняет запись в прошлое время (400)
- Backend: `GET /api/slots` помечает прошедшие слоты `isPast: true`
- Frontend: прошедшие слоты серые, некликабельные
- Настройка: `MIN_BOOKING_LEAD_MINUTES=10` (запрет записи за N мин)

## Тесты
```bash
node integrations/tests.js
```

## RBAC (роли)
| Роль | Права |
|------|-------|
| admin | Полный доступ |
| manager | Управление расписанием, записями, барберами |
| barber | Просмотр своих записей |
| client | Запись, просмотр своих записей |

## Чеклист готовности к продакшну
- [ ] TELEGRAM_BOT_TOKEN установлен
- [ ] Telegram webhook настроен (публичный URL)
- [ ] TELEGRAM_ADMIN_CHAT_ID задан
- [ ] TELEGRAM_BARBER_CHAT_IDS заполнен
- [ ] WhatsApp провайдер настроен (если нужен)
- [ ] MIN_BOOKING_LEAD_MINUTES задан (рекомендуется 10)
- [ ] JOB_WORKER_ENABLED=true
- [ ] Пароли пользователей захешированы (TODO)
- [ ] HTTPS включён на продакшне
- [ ] Бэкапы data/ настроены
- [ ] Тесты пройдены (`node integrations/tests.js`)
