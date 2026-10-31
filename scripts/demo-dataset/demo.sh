#!/usr/bin/env bash
# Orquesta el dataset demo completo: pasos Node (por RPC) y pasos SQL (lo que `dominio` no deja hacer por API).
#
#   scripts/demo-dataset/demo.sh [--reset] [--sin-sql-final]
#
# Variables:
#   DEMO_PSQL  comando psql con un rol que escriba en `dominio` (postgres). Ej.:
#                "docker exec -i supabase_db_msf-demo psql -U postgres"   o   "psql postgresql://postgres:***@host:7634/postgres"
#   DEMO_RUN   cómo correr el runner Node. Por defecto: node scripts/demo-dataset/index.mjs
#   DEMO_ORGANIZACION / DEMO_SUFIJO  organización paralela (opcional).
# Más SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_ANON_KEY para el runner (ver index.mjs).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DEMO_PSQL:?Definí DEMO_PSQL (comando psql con rol postgres)}"
RUN="${DEMO_RUN:-node scripts/demo-dataset/index.mjs}"
ORG="${DEMO_ORGANIZACION:-San Javucho y Mundo JC (demo)}"
SUF="${DEMO_SUFIJO:-}"
SQL="scripts/demo-dataset/sql"
sql() { $DEMO_PSQL -tA -v org="$ORG" -v sufijo="$SUF" < "$SQL/$1"; }

if [[ " $* " == *" --reset "* ]]; then echo "› reset (SQL)"; sql 00-borrar-organizacion.sql; fi
echo "› módulos 01–02 (organización, usuarios, catálogo, precios)"; $RUN --hasta=02
echo "› aprovisionamiento SQL: tiendas"; sql 01-tiendas.sql
echo "› módulos 03 en adelante"; $RUN --desde=03
# Pasos SQL finales (90-98: lo que cada módulo no puede hacer por API, 99: fechas), en orden de nombre.
if [[ " $* " != *" --sin-sql-final "* ]]; then
  for f in "$SQL"/9*.sql; do [[ -e "$f" ]] || continue; echo "› paso SQL final: $(basename "$f")"; sql "$(basename "$f")"; done
fi
echo "✓ dataset demo completo"
