#!/usr/bin/env bash
# Corre `scripts/medir-tienda-favoritos.guard.test.mjs` contra dos bases VACÍAS que crea este script (sin migraciones: los casos que leen `organizaciones` se omiten con
# MEDIR_SIN_ESQUEMA=1). Lo usa el job `database` de validate.yml; se puede correr local.
# Uso: probar-guard-medicion.sh probar | limpiar
#   probar   en el CI primero llama a `limpiar` (auto-recuperación, ver abajo). Aborta sin tocar nada si alguna de las dos bases ya existe (puede ser ajena); si no, las crea
#            y, al terminar por cualquier camino que el shell pueda atrapar (éxito, fallo, señal), borra con un `trap` las bases cuyo `create database` salió con éxito en esta
#            corrida (`create database` falla si la base existe, así que lo que se anota lo creó esta corrida; las anota después de crear). Variables del propio proceso: no
#            hay archivos ni entradas externas. Limitación: si el proceso muere entre el `create` y la anotación, o por una señal que no se atrapa (SIGKILL), la base queda.
#   limpiar  actúa solo en el CI (GITHUB_ACTIONS=true y CI definida) y borra EXCLUSIVAMENTE las dos bases de nombre fijo; fuera del CI no hace nada. Es el paso final del job
#            (`if: always()`) y se llama también al inicio de `probar` en el CI.
# El stack de Supabase del CI NO es efímero: es por ranura y se reutiliza entre corridas (`scripts/supabase-ci.mjs`, `liberar` solo suelta el lock) y `scripts/reset-db-ci.mjs`
# recrea los esquemas pero no borra otras bases. Por eso una corrida que muriera sin poder limpiar dejaría las dos bases a la siguiente de la ranura; el `limpiar` del inicio
# de `probar` en el CI la deja recuperarse sin fallar.
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
  local base existe
  if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${CI:-}" ]; then limpiar; fi   # auto-recuperación: solo en el CI
  for base in "$DESCARTABLE" "$OTRA"; do
    if ! existe=$(admin -c "select count(*) from pg_database where datname = '$base'"); then
      echo "no se pudo consultar la existencia de la base $base: revisá la conexión" >&2
      exit 1
    fi
    if [ "$existe" != 0 ]; then
      echo "ya existe la base $base: borrala a mano si es tuya" >&2
      exit 1
    fi
  done
  trap limpiar_propias EXIT
  trap 'exit 143' TERM INT
  for base in "$DESCARTABLE" "$OTRA"; do
    admin -c "create database \"$base\" template template0"   # falla si la base existe: no se toma una ajena
    creadas+=("$base")
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
