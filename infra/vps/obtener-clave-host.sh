#!/usr/bin/env bash
# MSF-706 · Obtiene la clave pública ed25519 de un VPS y la imprime lista para el secret VPS_SSH_KNOWN_HOSTS (o para
# infra/vps/known_hosts.<entorno>), junto con su HUELLA. SOLO LEE y no escribe ningún archivo.
#
# Esto NO verifica nada por sí solo: `ssh-keyscan` confía en lo que conteste la red. La verificación es COMPARAR la huella impresa acá con la que
# muestra el propio servidor por un canal de confianza (consola web del proveedor):  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
# Si no coinciden, NO cargues la línea.
#
# Uso: infra/vps/obtener-clave-host.sh <host>
set -euo pipefail

host="${1:-}"
case "$host" in
  ''|*[!A-Za-z0-9.:-]*|-*) echo "Uso: $0 <host o IP>" >&2; exit 2 ;;
esac

linea="$(ssh-keyscan -T 10 -t ed25519 "$host" 2>/dev/null | grep -v '^#' | head -n1 || true)"
if [ -z "$linea" ]; then
  echo "No se obtuvo ninguna clave ed25519 de $host (¿puerto 22 cerrado o el host sin esa clave?)." >&2
  exit 1
fi
echo "Huella (compará con la del servidor, por la consola del proveedor):"
printf '%s\n' "$linea" | ssh-keygen -lf -
echo
echo "Línea para VPS_SSH_KNOWN_HOSTS / infra/vps/known_hosts.<entorno> (solo si la huella coincide):"
printf '%s\n' "$linea"
