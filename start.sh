#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
NGINX_CONF="/tmp/map_compare_nginx.conf"
PID_FILE="/tmp/map_compare_nginx.pid"

NGINX_TMP="/tmp/map_compare_nginx_tmp"
mkdir -p "$NGINX_TMP/client_body" "$NGINX_TMP/proxy" "$NGINX_TMP/fastcgi" "$NGINX_TMP/uwsgi" "$NGINX_TMP/scgi"

cat > "$NGINX_CONF" <<EOF
daemon off;
pid $PID_FILE;
error_log /tmp/map_compare_nginx_error.log;

events {
    worker_connections 64;
}

http {
    include /etc/nginx/mime.types;
    access_log /tmp/map_compare_nginx_access.log;
    client_body_temp_path $NGINX_TMP/client_body;
    proxy_temp_path       $NGINX_TMP/proxy;
    fastcgi_temp_path     $NGINX_TMP/fastcgi;
    uwsgi_temp_path       $NGINX_TMP/uwsgi;
    scgi_temp_path        $NGINX_TMP/scgi;

    server {
        listen 3333;
        root $DIR;
        index index.html;
    }
}
EOF

echo "Serving map_compare at http://localhost:3333"
echo "Press Ctrl+C to stop."
/usr/sbin/nginx -c "$NGINX_CONF" 2>/tmp/map_compare_nginx_error.log
