#!/usr/bin/env bash
# Corre `scripts/medir-tienda-favoritos.guard.test.mjs` contra dos bases VACÍAS que crea este script (sin migraciones: los casos que leen `organizaciones` se omiten con
# MEDIR_SIN_ESQUEMA=1) y las borra al terminar. Lo usa el job `database` de validate.yml; se puede correr local.
# Uso: probar-guard-medicion.sh probar | limpiar
# `probar` aborta sin tocar nada si alguna de las dos bases ya existe (puede ser ajena). `limpiar` borra solo las bases que creó `probar` (las anota en un archivo de marca,
# MEDIR_MARCA, por defecto en RUNNER_TEMP o /tmp) y no hace nada si no hay marca.
# Conexión por el entorno de psql: PGHOST, PGPORT, PGPASSWORD (y PGSSLMODE). El usuario es `postgres` si es superusuario y, si no (Supabase), `supabase_admin`.
set -euo pipefail

DESCARTABLE=guard_test_descartable   # cumple el guard (palabra delimitada)
OTRA=guardotrabase                   # no cumple el guard, vacía

usuario=${MEDIR_ADMIN_USER:-}
if [ -z "$usuario" ]; then
  if [ "$(PGUSER=postgres psql -X -q -A -t -d postgres -c 'show is_superuser' 2>/dev/null || echo off)" = on ]; then usuario=postgres; else usuario=supabase_admin; fi
fi
admin() { PGUSER="$usuario" psql -X -q -A -t -v ON_ERROR_STOP=1 -d postgres "$@"; }

MARCA=${MEDIR_MARCA:-${RUNNER_TEMP:-/tmp}/guard-medicion.creadas}

limpiar() {
  [ -f "$MARCA" ] || return 0
  while read -r base; do
    [ -n "$base" ] && admin -c "drop database if exists $base" < /dev/null
  done < "$MARCA"
  rm -f "$MARCA"
}

crear() {
  admin -c "create database $1 template template0"
  echo "$1" >> "$MARCA"
}

case "${1:-}" in
  limpiar) limpiar ;;
  probar)
    for base in "$DESCARTABLE" "$OTRA"; do
      if [ "$(admin -c "select count(*) from pg_database where datname = '$base'")" != 0 ]; then
        echo "ya existe la base $base: borrala a mano si es tuya" >&2
        exit 1
      fi
    done
    rm -f "$MARCA"
    crear "$DESCARTABLE"
    crear "$OTRA"
    base="psql -h ${PGHOST:-localhost} -p ${PGPORT:-5432} -U $usuario"
    MEDIR_PSQL="$base -d $DESCARTABLE" MEDIR_PSQL_OTRA_BASE="$base -d $OTRA" MEDIR_SIN_ESQUEMA=1 \
      node --test scripts/medir-tienda-favoritos.guard.test.mjs
    ;;
  *) echo "uso: $0 probar|limpiar" >&2; exit 2 ;;
esac
