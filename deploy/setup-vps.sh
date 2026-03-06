#!/bin/bash
# ============================================
# The Lion's Den Barbershop — VPS Setup Script
# Запуск: bash setup-vps.sh
# ============================================
set -e

echo "🦁 Установка The Lion's Den Barbershop..."

# 1. Обновление системы
echo "📦 Обновление системы..."
sudo apt update && sudo apt upgrade -y

# 2. Установка Node.js 20
echo "📦 Установка Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Установка nginx
echo "📦 Установка Nginx..."
sudo apt install -y nginx

# 4. Создание директории проекта
echo "📁 Создание директории..."
sudo mkdir -p /var/www/lions-barbershop
sudo chown $USER:$USER /var/www/lions-barbershop

# 5. Копирование файлов (предполагается что мы в папке проекта)
echo "📋 Копирование файлов..."
cp -r ./* /var/www/lions-barbershop/
cp .env /var/www/lions-barbershop/ 2>/dev/null || true
cp .env.example /var/www/lions-barbershop/.env.example

# 6. Установка зависимостей
echo "📦 Установка npm зависимостей..."
cd /var/www/lions-barbershop
npm install --production

# 7. Создание .env если нет
if [ ! -f /var/www/lions-barbershop/.env ]; then
  cp .env.example .env
  # Генерация случайного JWT_SECRET
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s|change-me-to-random-string-min-32-chars|$JWT_SECRET|g" .env
  echo ""
  echo "⚠️  Отредактируйте .env файл:"
  echo "   nano /var/www/lions-barbershop/.env"
  echo "   Установите OWNER_ADMIN_PHONE, OWNER_ADMIN_PASSWORD и другие настройки"
  echo ""
fi

# 8. Настройка systemd сервиса
echo "⚙️  Настройка systemd сервиса..."
sudo tee /etc/systemd/system/lions-barbershop.service > /dev/null <<'UNIT'
[Unit]
Description=The Lion's Den Barbershop
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/lions-barbershop
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=lions-barbershop
Environment=NODE_ENV=production
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
UNIT

# Права для www-data
sudo chown -R www-data:www-data /var/www/lions-barbershop

# 9. Настройка Nginx
echo "⚙️  Настройка Nginx..."
sudo tee /etc/nginx/sites-available/lions-barbershop > /dev/null <<'NGINX'
server {
    listen 80;
    server_name _;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/lions-barbershop /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 10. Запуск сервиса
echo "🚀 Запуск сервиса..."
sudo systemctl daemon-reload
sudo systemctl enable lions-barbershop
sudo systemctl start lions-barbershop

echo ""
echo "✅ ═══════════════════════════════════════════"
echo "   🦁 The Lion's Den Barbershop УСТАНОВЛЕН!"
echo "   Сайт доступен по IP вашего сервера"
echo "   "
echo "   Полезные команды:"
echo "   sudo systemctl status lions-barbershop"
echo "   sudo systemctl restart lions-barbershop"
echo "   sudo journalctl -u lions-barbershop -f"
echo "   nano /var/www/lions-barbershop/.env"
echo "═══════════════════════════════════════════════"
