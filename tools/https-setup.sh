#!/bin/bash
# Podesi Nginx + besplatni HTTPS certifikat (Let's Encrypt) za aplikaciju.
# Upotreba:  bash tools/https-setup.sh dijelovi2.delicauto.com
# Prije toga u DNS-u domena dodaj A zapis:  dijelovi2  ->  IP servera
set -e
DOMAIN="$1"
PORT="$(grep -E '^PORT=' "$(dirname "$0")/../.env" 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-3020}"
EMAIL="${2:-autootpaddelic@gmail.com}"
[ -z "$DOMAIN" ] && { echo "Upotreba: bash tools/https-setup.sh poddomen.delicauto.com"; exit 1; }

IP_SERVER="$(curl -s -4 ifconfig.me || true)"
IP_DNS="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}')"
echo "Server: $IP_SERVER   |   $DOMAIN pokazuje na: ${IP_DNS:-NIŠTA}"
if [ -z "$IP_DNS" ] || [ "$IP_DNS" != "$IP_SERVER" ]; then
  echo "STOP: $DOMAIN još ne pokazuje na ovaj server. U DNS-u dodaj A zapis -> $IP_SERVER, sačekaj par minuta pa ponovi."
  exit 1
fi

CONF="/etc/nginx/sites-available/delicdijelovi-$DOMAIN"
cat > "$CONF" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 30M;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
ln -sf "$CONF" /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
echo
echo "GOTOVO: https://$DOMAIN  — otvori u Chromeu na telefonu i u meniju klikni 'Instaliraj aplikaciju'."
