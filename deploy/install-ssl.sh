#!/bin/bash
# ============================================
# Установка SSL-сертификата (HTTPS)
# Запуск: bash install-ssl.sh yourdomain.com
# ============================================
set -e

DOMAIN=$1

if [ -z "$DOMAIN" ]; then
  echo "Использование: bash install-ssl.sh yourdomain.com"
  exit 1
fi

echo "🔒 Установка SSL для $DOMAIN..."

# Установка certbot
sudo apt install -y certbot python3-certbot-nginx

# Обновление nginx конфига с доменом
sudo sed -i "s|server_name _;|server_name $DOMAIN;|g" /etc/nginx/sites-available/lions-barbershop
sudo nginx -t && sudo systemctl reload nginx

# Получение сертификата
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@"$DOMAIN" --redirect

# Автопродление
sudo systemctl enable certbot.timer

echo ""
echo "✅ SSL установлен! Сайт доступен: https://$DOMAIN"
