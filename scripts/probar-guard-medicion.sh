#!/usr/bin/env bash
# Corre `scripts/medir-tienda-favoritos.guard.test.mjs` contra dos bases VACÍAS que crea este script (sin migraciones: los casos que leen `organizaciones` se omiten con
# MEDIR_SIN_ESQUEMA=1) y las borra al terminar. Lo usa el job `database` de validate.yml; se puede correr local.
# Uso: probar-guard-medicion.sh probar | limpiar
# Conexión por el entorno de psql: PGHOST, PGPORT, PGPASSWORD (y PGSSLMODE). El usuario es `postgres` si es superusuario y, si no (Supabase), `supabase_admin`.
set -euo pipefail

DESCARTABLE=guard_test_descartable   # cumple el guard (palabra delimitada)
OTRA=guardotrabase                   # no cumple el guard, vacía

usuario=${MEDIR_ADMIN_USER:-}
if [ -z "$usuario" ]; then
  if [ "$(PGUSER=postgres psql -X -q -A -t -d postgres -c 'show is_superuser' 2>/dev/null || echo off)" = on ]; then usuario=postgres; else usuario=supabase_admin; fi
fi
admin() { PGUSER="$usuario" psql -X -q -A -t -v ON_ERROR_STOP=1 -d postgres "$@"; }

limpiar() {
  admin -c "drop database if exists $DESCARTABLE" -c "drop database if exists $OTRA"
}

case "${1:-}" in
  limpiar) limpiar ;;
  probar)
    limpiar
    admin -c "create database $DESCARTABLE template template0" -c "create database $OTRA template template0"
    base="psql -h ${PGHOST:-localhost} -p ${PGPORT:-5432} -U $usuario"
    MEDIR_PSQL="$base -d $DESCARTABLE" MEDIR_PSQL_OTRA_BASE="$base -d $OTRA" MEDIR_SIN_ESQUEMA=1 \
      node --test scripts/medir-tienda-favoritos.guard.test.mjs
    ;;
  *) echo "uso: $0 probar|limpiar" >&2; exit 2 ;;
esac
