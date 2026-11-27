#!/usr/bin/env bash
# MSF-712 · Descarga un binario de un tarball y lo instala SOLO si el SHA256 del tarball coincide con el fijado en el repositorio.
# Reemplaza el `curl ... | tar -xz -C /usr/local/bin` que ejecutaba lo que dijera la red (con credenciales de producción en el entorno).
#
# Uso: scripts/instalar-binario-verificado.sh <url> <sha256> <miembro-del-tarball> <directorio-destino>
# - Verifica el hash ANTES de extraer; si no coincide, no instala nada y sale 1.
# - El destino es un directorio escribible por el job (por ejemplo "$RUNNER_TEMP/bin"); no necesita root.
# - Acepta file:// (lo usan las pruebas).
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Uso: $0 <url> <sha256> <miembro-del-tarball> <directorio-destino>" >&2
  exit 2
fi
url="$1"; esperado="$2"; miembro="$3"; destino="$4"

case "$esperado" in
  *[!0-9a-f]*|'') echo "El SHA256 debe ser hexadecimal en minúsculas." >&2; exit 2 ;;
esac
[ "${#esperado}" -eq 64 ] || { echo "El SHA256 debe tener 64 caracteres." >&2; exit 2; }
case "$miembro" in
  */*|.*|'') echo "El miembro del tarball debe ser un nombre de archivo simple." >&2; exit 2 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/paquete.tar.gz" "$url"
obtenido="$(sha256sum "$tmp/paquete.tar.gz" | cut -d' ' -f1)"
if [ "$obtenido" != "$esperado" ]; then
  echo "SHA256 distinto del fijado para $miembro: no se instala (esperado ${esperado:0:12}…, obtenido ${obtenido:0:12}…)." >&2
  exit 1
fi
mkdir -p "$destino"
tar -xzf "$tmp/paquete.tar.gz" -C "$destino" "$miembro"
chmod 0755 "$destino/$miembro"
echo "$miembro instalado en $destino (SHA256 verificado)."
