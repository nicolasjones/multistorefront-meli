#!/usr/bin/env bash
# EVIDENCIA E2E de punta a punta (recetas A y B en un comando).
#
#   scripts/e2e-evidencia.sh stack                 # Receta B: stack Supabase AISLADO + .env + claves
#   scripts/e2e-evidencia.sh correr [spec...]      # corre E2E con video y publica la evidencia
#   scripts/e2e-evidencia.sh epica MSF-119 [T0xx]  # Receta A: crea el spec base si falta, corre y publica
#   scripts/e2e-evidencia.sh publicar              # sólo manifiesto + MP4 + publicar
#   scripts/e2e-evidencia.sh checklist MSF-119     # qué falta para que la épica tenga evidencia
#
# Variables (opcionales):
#   E2E_BASE_URL        app contra la que se corre (por defecto la DEV)
#   ITSAPLAN_API_KEY   clave para publicar (si no está, arma los MP4 pero NO publica)
#   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   para los E2E que siembran (Receta B)
set -uo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"
DEV_URL="${E2E_BASE_URL:-https://dev.212-90-120-53.sslip.io}"
WEB="${WEB_PORT:-4300}"
REPORT="$RAIZ/apps/web/e2e-report.json"
MANIFIESTO="$RAIZ/cobertura-e2e.json"
VIDEOS="$RAIZ/apps/web/test-results"
OUT_VIDEOS="$RAIZ/videos"

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
preflight() {
  command -v node >/dev/null 2>&1 || fail "falta Node (corré este script donde tengas Node >= 20)"
  [ -d "$RAIZ/node_modules" ] || info "sin node_modules: corré 'pnpm install' en el repo"
}
info() { printf '   %s\n' "$*"; }
fail() { printf '\033[31m   ✖ %s\033[0m\n' "$*" >&2; exit 1; }

pedir_ffmpeg() {
  command -v ffmpeg >/dev/null 2>&1 && return 0
  fail "falta ffmpeg con libx264 (el de Playwright no sirve): instalá 'ffmpeg' (apt-get install -y ffmpeg)"
}

# ─────────────────────────────────────────────────────────────────────────────
# Receta B: stack Supabase AISLADO (para los E2E que siembran datos)
# ─────────────────────────────────────────────────────────────────────────────
cmd_stack() {
  log "Stack Supabase aislado (Receta B)"
  if ! command -v docker >/dev/null 2>&1; then fail "necesitás Docker"; fi
  info "levantando el stack local (pnpm dev:supabase = supabase start)"
  pnpm dev:supabase || fail "falló 'supabase start'"
  info "claves del stack:"
  pnpm exec supabase status || fail "falló 'supabase status'"
  if [ ! -f "$RAIZ/apps/web/.env" ]; then
    cp "$RAIZ/apps/web/.env.example" "$RAIZ/apps/web/.env"
    info "creé apps/web/.env desde el ejemplo (poné la ANON key que imprime 'supabase status')"
  else
    info "apps/web/.env ya existe: revisá que VITE_SUPABASE_URL apunte al stack local"
  fi
  info "exportá antes de correr los tests que siembran:"
  info "  export SUPABASE_URL=http://127.0.0.1:9300"
  info "  export SUPABASE_SERVICE_ROLE_KEY=<service_role de 'supabase status'>"
  info "y levantá la web: pnpm --filter @platform/web dev   (http://127.0.0.1:$WEB)"
}

# ─────────────────────────────────────────────────────────────────────────────
# Receta A: spec base de una épica
# ─────────────────────────────────────────────────────────────────────────────
tareas_de_epica() { # $1 = MSF-xxx -> lista "T020 T021 ..."
  local epic="$1" dir
  dir="$(grep -rl "Jira Epic.*$epic" specs/*/spec.md 2>/dev/null | head -1 | xargs -r dirname)"
  [ -n "$dir" ] || return 1
  grep -oE '^\s*-\s*\[[ xX]\]\s*T[0-9]+' "$dir/tasks.md" 2>/dev/null | grep -oE 'T[0-9]+' | sort -u | tr '\n' ' '
}

cmd_epica() {
  local epic="${1:?falta la épica (ej. MSF-119)}"
  shift
  local tasks=("$@")
  [ ${#tasks[@]} -gt 0 ] || tasks=()
  local task="${tasks[0]:-}"
  log "Épica $epic"
  if [ -z "$task" ]; then
    task="$(tareas_de_epica "$epic" | awk '{print $1}')"
    [ -n "$task" ] || fail "no encontré el tasks.md de $epic (pasá el TASK explícito: $epica T020)"
    info "TASK tomado del tasks.md: $task"
  fi
  local archivo="$RAIZ/apps/web/e2e/epica-${epic,,}.e2e.ts"
  # Si YA existe un spec con ese rótulo, se usa ese (no se crea otro).
  local existente
  existente="$(grep -rl "\[$epic:$task\]" apps/web/e2e/*.e2e.ts 2>/dev/null | head -1)"
  if [ -n "$existente" ]; then
    info "ya hay un spec con el rótulo [$epic:$task]: ${existente#$RAIZ/} → lo corro"
    cmd_correr "${existente#$RAIZ/}"
    return
  fi
  if [ -f "$archivo" ]; then
    info "el spec ya existe: ${archivo#$RAIZ/} (no lo toco)"
  elif [ ${#tasks[@]} -gt 1 ]; then
    # Varias tareas: un spec por tarea (un rótulo por test).
    local t
    for t in "${tasks[@]}"; do
      cat > "$RAIZ/apps/web/e2e/epica-${epic,,}-${t,,}.e2e.ts" <<EOF
import { expect, test } from './fixture'
import { paso, prepararPaginaVisible } from './visible'

// Plantilla de evidencia para $epica · $t (EDITALO: es un esqueleto).
test.describe('$epica · $t', () => {
  test.beforeEach(async ({ page }) => { await prepararPaginaVisible(page) })

  test('[$epic:$t] <qué hace el usuario>', async ({ page }) => {
    await paso(page, 'Abre /ruta', () => page.goto('/ruta'))
    await paso(page, 'Verifica el resultado', async () => {
      await expect(page.getByRole('heading', { name: 'Titulo' })).toBeVisible()
    })
  })
})
EOF
      info "creé el spec base: apps/web/e2e/epica-${epic,,}-${t,,}.e2e.ts"
    done
    cmd_correr "e2e/epica-${epic,,}-"*
    return
  else
    cat > "$archivo" <<EOF
import { expect, test } from './fixture'
import { paso, prepararPaginaVisible } from './visible'

// Plantilla de evidencia para $epica (TASK $task).
// Reemplazá los cuerpos por el recorrido real de la historia; el RÓTULO del título es lo que
// ata el video a la historia (ver docs/e2e-app.md → Receta A).
test.describe('$epica', () => {
  test.beforeEach(async ({ page }) => {
    await prepararPaginaVisible(page)
  })

  test('[$epic:$task] <qué hace el usuario>', async ({ page }) => {
    await paso(page, 'Abre /ruta', () => page.goto('/ruta'))
    await paso(page, 'Verifica el resultado', async () => {
      await expect(page.getByRole('heading', { name: 'Titulo' })).toBeVisible()
    })
  })
})
EOF
    info "creé el spec base: ${archivo#$RAIZ/} (EDITALO antes de publicar: la plantilla es un esqueleto)"
  fi
  cmd_correr "$archivo"
}

# ─────────────────────────────────────────────────────────────────────────────
# correr E2E con video + manifiesto + MP4 + publicar
# ─────────────────────────────────────────────────────────────────────────────
cmd_correr() {
  preflight
  local specs=("$@")
  [ ${#specs[@]} -gt 0 ] || specs=("e2e")
  log "Corriendo E2E con evidencia contra $DEV_URL"
  pedir_ffmpeg
  ( cd apps/web && PLAYWRIGHT_JSON_OUTPUT_NAME="$REPORT" E2E_BASE_URL="$DEV_URL" E2E_VIDEO=on E2E_VISIBLE=1 \
      npx playwright test "${specs[@]}" --reporter=list,json ) || info "la suite devolvió errores (mirá el reporte)"
  cmd_publicar
}

cmd_publicar() {
  log "Manifiesto de cobertura"
  node scripts/cobertura-e2e.mjs --report "$REPORT" --results "$VIDEOS" --specs specs \
    --out "$MANIFIESTO" --run-id "${RUN_ID:-local}" --modo "${MODO:-on}" || fail "falló el manifiesto"
  log "Armando MP4"
  node scripts/armar-video-evidencia.mjs --manifiesto "$MANIFIESTO" --videos "$VIDEOS" --out "$OUT_VIDEOS" \
    || fail "falló el ensamblado de videos"
  if [ -n "${ITSAPLAN_API_KEY:-}" ]; then
    log "Publicando en It's a Plan"
    node scripts/armar-video-evidencia.mjs --manifiesto "$MANIFIESTO" --videos "$VIDEOS" --out "$OUT_VIDEOS" --publicar \
      || fail "falló la publicación"
  else
    info "sin ITSAPLAN_API_KEY: los MP4 quedaron en $OUT_VIDEOS pero NO se publicaron"
    info "publicá con: ITSAPLAN_API_KEY=… scripts/e2e-evidencia.sh publicar"
  fi
  log "Listo"
  info "MP4:      $(ls -1 "$OUT_VIDEOS"/*.mp4 2>/dev/null | wc -l) archivo(s) en ${OUT_VIDEOS#$RAIZ/}/"
  info "Manifiesto: ${MANIFIESTO#$RAIZ/} (evidencias 'pasado' = publicables)"
}

# ─────────────────────────────────────────────────────────────────────────────
# checklist: qué falta para que la épica tenga evidencia
# ─────────────────────────────────────────────────────────────────────────────
cmd_checklist() {
  local epic="${1:?falta la épica (ej. MSF-119)}"
  log "Checklist de evidencia para $epic"
  local dir
  dir="$(grep -rl "Jira Epic.*$epic" specs/*/spec.md 2>/dev/null | head -1 | xargs -r dirname)"
  [ -n "$dir" ] || fail "no encontré el spec de $epic"
  local tareas; tareas="$(tareas_de_epica "$epic")"
  info "spec:     $dir"
  info "tareas:   $tareas"
  local conrotulo=0 faltan=""
  for t in $tareas; do
    if grep -rl "\[$epic:$t\]" apps/web/e2e/*.e2e.ts >/dev/null 2>&1; then
      conrotulo=$((conrotulo+1))
      info "  ✔ $t tiene test rotulado [$epic:$t]"
    else
      faltan="$faltan $t"
      info "  ✖ $t SIN test rotulado [$epic:$t]  ← hay que escribirlo (Receta A)"
    fi
  done
  info ""
  if [ -n "$faltan" ]; then
    info "Para escribirla: scripts/e2e-evidencia.sh epica $epic$faltan   (crea el spec base y corre)"
  else
    info "La épica tiene todas sus tareas con test rotulado (falta correrlos y publicar)"
  fi
  info "Total con evidencia: $conrotulo de $(echo $tareas | wc -w) tareas"
}

case "${1:-}" in
  stack)     cmd_stack ;;
  correr)    shift; cmd_correr "$@" ;;
  epica)     shift; cmd_epica "$@" ;;
  publicar)  cmd_publicar ;;
  checklist) shift; cmd_checklist "$@" ;;
  *) cat <<EOF
uso: scripts/e2e-evidencia.sh <comando> [args]

  stack                 Receta B: stack Supabase aislado + .env + claves
  correr [spec...]      corre E2E con video y publica la evidencia
  epica MSF-xxx [T0xx]  Receta A: crea el spec base si falta, corre y publica
  publicar              sólo manifiesto + MP4 + publicar
  checklist MSF-xxx     qué falta para que la épica tenga evidencia

  (guía completa en docs/e2e-app.md)
EOF
  exit 1 ;;
esac
