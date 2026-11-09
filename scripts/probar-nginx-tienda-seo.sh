#!/bin/sh
# Prueba de COMPORTAMIENTO de apps/web/nginx.conf para /robots.txt y /sitemap.xml (MSF-149) con nginx real en docker.
# `nginx -t` solo valida sintaxis; esto verifica: IP real desde X-Forwarded-For, 429 por IP + host, 429 global por IP al
# rotar el Host, que otra IP no se afecte, caché separada por host y que NO se sirva contenido viejo si el upstream cae.
# Uso: sh scripts/probar-nginx-tienda-seo.sh   (requiere docker; no corre en CI para no saturar los runners)
set -eu
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sed "s|__SUPABASE_URL__|http://127.0.0.1:8081|;s|__SUPABASE_ANON_KEY__|k|g;s|proxy_pass \$supabase_url/functions/v1/tienda-seo/\$1;|proxy_pass \$supabase_url/\$1;|;s|listen 80;|listen 8080;|" "$RAIZ/apps/web/nginx.conf" > "$TMP/default.conf"
# Un bucle de curl no llega a 100 pedidos/s: para ejercitar la zona global se achica SOLO en una copia de prueba
# (los valores reales los fija supabase/functions/tienda-seo/nginx.test.ts).
sed 's|zone=tienda_seo_global:10m rate=100r/s|zone=tienda_seo_global:10m rate=5r/s|; s|zone=tienda_seo_global burst=200|zone=tienda_seo_global burst=20|' "$TMP/default.conf" > "$TMP/global.conf"
cat > "$TMP/up.conf" <<'N'
server { listen 8081;
  location / {
    if (-f /tmp/caido) { return 502; }
    add_header Cache-Control "public, max-age=3, stale-if-error=3";
    return 200 "contenido de $http_x_tienda_host\n";
  }
}
N
cat > "$TMP/prueba.sh" <<'N'
set -eu
MODO=$1
nginx >/dev/null 2>&1; sleep 1
codigos() { # $1 = cantidad, $2 = IP, $3 = plantilla de host (con %s para el índice)
  i=1; while [ "$i" -le "$1" ]; do
    h=$(printf "$3" "$i")
    curl -s -o /dev/null -w "%{http_code}\n" -H "Host: $h" -H "X-Forwarded-For: $2" http://127.0.0.1:8080/robots.txt
    i=$((i+1)); done
}
falla() { echo "FALLA: $1"; exit 1; }
if [ "$MODO" = base ]; then
  n429=$(codigos 150 203.0.113.9 a.test | grep -c 429 || true)
  [ "$n429" -gt 0 ] || falla "una IP + host no recibió 429 pasado el cubo"
  [ "$(codigos 1 203.0.113.77 a.test)" = 200 ] || falla "otra IP quedó limitada (la IP real no se toma de X-Forwarded-For)"
  [ "$(codigos 1 203.0.113.9 b.test)" = 200 ] || falla "otro host de la misma IP quedó limitado"
  curl -s -H "Host: c.test" -H "X-Forwarded-For: 192.0.2.1" http://127.0.0.1:8080/sitemap.xml | grep -q "c.test" || falla "la respuesta no es del host pedido"
  curl -s -H "Host: d.test" -H "X-Forwarded-For: 192.0.2.1" http://127.0.0.1:8080/sitemap.xml | grep -q "d.test" || falla "la caché mezcló hosts"
  touch /tmp/caido
  sleep 5
  for t in 1 2 3; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: c.test' -H 'X-Forwarded-For: 192.0.2.1' http://127.0.0.1:8080/sitemap.xml)" != 200 ] || falla "se sirvió contenido viejo con el upstream caído"
    sleep 2
  done
fi
if [ "$MODO" = global ]; then
  n429=$(codigos 300 198.51.100.5 'h%s.test' | grep -c 429 || true)
  [ "$n429" -gt 0 ] || falla "rotar el Host evadió el límite por IP"
fi
echo "OK $MODO"
N
for modo in base global; do
  conf="$TMP/default.conf"; [ "$modo" = global ] && conf="$TMP/global.conf"
  docker run --rm -v "$conf:/etc/nginx/conf.d/default.conf:ro" -v "$TMP/up.conf:/etc/nginx/conf.d/up.conf:ro" -v "$TMP/prueba.sh:/prueba.sh:ro" nginx:alpine sh /prueba.sh "$modo" > "$TMP/salida.txt" 2>&1 || true
  grep -E "^(OK|FALLA)" "$TMP/salida.txt" || { cat "$TMP/salida.txt"; exit 1; }
  grep -q "^OK" "$TMP/salida.txt" || exit 1
done
