#!/usr/bin/env bash
# Corre `scripts/medir-tienda-favoritos.guard.test.mjs` contra dos bases VACÍAS que crea este script (sin migraciones: los casos que leen `organizaciones` se omiten con
# MEDIR_SIN_ESQUEMA=1). Lo usa el job `database` de validate.yml; se puede correr local.
# Uso: probar-guard-medicion.sh probar | limpiar
#   probar   aborta sin tocar nada si alguna de las dos bases ya existe (puede ser ajena); si no, las crea y, al terminar por cualquier camino que el shell pueda atrapar
#            (éxito, fallo, señal), borra con un `trap` SOLO las que creó esta corrida (variables del propio proceso; no hay archivos ni entradas externas).
#   limpiar  es el paso final del job (`if: always()`, por si el proceso murió sin poder atrapar la señal): actúa solo en el CI (GITHUB_ACTIONS=true y CI definida, stack
#            efímero) y borra EXCLUSIVAMENTE las dos bases de nombre fijo; fuera del CI no hace nada.
# Conexión por el entorno de psql: PGHOST, PGPORT, PGPASSWORD (y PGSSLMODE). El usuario es `postgres` si es superusuario y, si no (Supabase), `supabase_admin`.
set -euo pipefail

DESCARTABLE=guard_test_descartable   # cumple el guard (palabra delimitada)
OTRA=guardotrabase                   # no cumple el guard, vacía

usuario=${MEDIR_ADMIN_USER:-}
if [ -z "$usuario" ]; then
  if [ "$(PGUSER=postgres psql -X -q -A -t -d postgres -c 'show is_superuser' 2>/dev/null || echo off)" = on ]; then usuario=postgres; else usuario=supabase_admin; fi
fi
admin() { PGUSER="$usuario" psql -X -q -A -t -v ON_ERROR_STOP=1 -d postgres "$@"; }

# Borra una base, y solo si es una de las dos de nombre fijo; el identificador va entrecomillado.
borrar_base() {
  case "$1" in
    guard_test_descartable | guardotrabase) admin -c "drop database if exists \"$1\"" ;;
    *) echo "borrar_base: rechazo borrar «$1»: no es una base de esta prueba" >&2; return 1 ;;
  esac
}

creadas=()
limpiar_propias() {
  local base
  for base in ${creadas[@]+"${creadas[@]}"}; do borrar_base "$base" < /dev/null || true; done
}

limpiar() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${CI:-}" ]; then
    borrar_base "$DESCARTABLE" < /dev/null
    borrar_base "$OTRA" < /dev/null
  else
    echo "limpiar solo actúa en el CI; fuera de él, probar limpia lo suyo con un trap" >&2
  fi
}

probar() {
  local base
  for base in "$DESCARTABLE" "$OTRA"; do
    if [ "$(admin -c "select count(*) from pg_database where datname = '$base'")" != 0 ]; then
      echo "ya existe la base $base: borrala a mano si es tuya" >&2
      exit 1
    fi
  done
  trap limpiar_propias EXIT
  trap 'exit 143' TERM INT
  for base in "$DESCARTABLE" "$OTRA"; do
    creadas+=("$base")   # se anota ANTES de crear: si el create muere a medias, el trap igual la borra
    admin -c "create database \"$base\" template template0"
  done
  local cmd="psql -h ${PGHOST:-localhost} -p ${PGPORT:-5432} -U $usuario"
  MEDIR_PSQL="$cmd -d $DESCARTABLE" MEDIR_PSQL_OTRA_BASE="$cmd -d $OTRA" MEDIR_SIN_ESQUEMA=1 \
    node --test scripts/medir-tienda-favoritos.guard.test.mjs
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    limpiar) limpiar ;;
    probar) probar ;;
    *) echo "uso: $0 probar|limpiar" >&2; exit 2 ;;
  esac
fi
