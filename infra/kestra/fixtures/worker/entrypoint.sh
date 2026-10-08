#!/bin/sh
set -eu

EJECUCION="${EJECUCION_ID:-${KESTRA_EJECUCION_ID:-sin-ejecucion}}"

# Evento del contrato de observabilidad (workers/CONTRATO.md): una línea JSON
# por cambio de etapa en stdout, sin datos sensibles.
evento() {
  printf '{"etapa":"%s","estado":"%s","timestamp":"%s","ejecucion":"%s","mensaje":"%s"}\n' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$EJECUCION" "$3"
}

# Captura de hito: un PNG mínimo de 1x1. Solo con evidencia habilitada; un
# fallo de captura se informa como evento y nunca cambia el resultado.
capturar() {
  [ "${EVIDENCIA_VISUAL:-false}" = "true" ] && [ -n "${EVIDENCIA_DIR:-}" ] || return 0
  destino="$EVIDENCIA_DIR"
  [ "$SISTEMA_EXTERNO" = "fixture-captura-fallida" ] && destino="$EVIDENCIA_DIR/no-existe"
  # El subshell silencia también el error de redirección: stderr queda
  # reservado a errores sanitizados del resultado de negocio.
  if (printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' \
    | base64 -d > "$destino/$(date -u +%Y%m%dT%H%M%S)000Z-$1.png") 2>/dev/null; then
    :
  else
    evento evidencia fallida "No se pudo guardar la captura de $1"
  fi
}

evento inicio iniciada "Worker fixture iniciado"

# Fallas no reintentables (workers/CONTRATO.md): con EJECUCION_ID, antes de
# resolver la credencial o contactar al sistema externo se verifica que la
# ejecución siga en curso; si no, sale 78 sin ningún efecto externo.
# Un error de la consulta es técnico (set -e sale con el código de psql y el
# flow lo reintenta); solo una respuesta "f" es no reintentable.
if [ -n "${EJECUCION_ID:-}" ]; then
  EN_CURSO=$(psql -v ON_ERROR_STOP=1 -Atqc "select private.ejecucion_worker_en_curso('$EJECUCION_ID')")
  if [ "$EN_CURSO" = "f" ]; then
    evento inicio fallida "Ejecución no en curso"
    printf 'EJECUCION_NO_EN_CURSO:%s\n' "$EJECUCION_ID" >&2
    exit 78
  fi
fi

# La consulta verifica el canal worker -> Vault sin serializar su resultado.
psql -v ON_ERROR_STOP=1 -Atqc \
  "select length(private.obtener_credencial_para_worker('$CONEXION_ID'))" \
  >/dev/null
evento sesion completada "Credencial resuelta"
capturar sesion

case "${SISTEMA_EXTERNO}" in
  fixture-credencial)
    evento sesion fallida "Credencial rechazada"
    printf 'CREDENCIAL_INVALIDA:%s\n' "$CONEXION_ID" >&2
    exit 78
    ;;
  fixture-tecnica)
    evento proceso fallida "Falla técnica simulada"
    capturar proceso
    printf 'FALLA_TECNICA_SANITIZADA\n' >&2
    exit 43
    ;;
  fixture-tecnica-cierra)
    # Caso real (Xubio): el worker cierra su ejecución y termina con una falla
    # técnica; el reintento del flow no debe volver a abrir sesión.
    evento proceso fallida "Falla técnica tras cerrar la ejecución"
    psql -v ON_ERROR_STOP=1 -Atqc "select public.cerrar_ejecucion_worker('$EJECUCION_ID', 'fallida', 'FALLA_TECNICA_SANITIZADA')" >/dev/null
    printf 'FALLA_TECNICA_SANITIZADA\n' >&2
    exit 43
    ;;
esac

evento proceso completada "Proceso simulado"
capturar fin
evento fin completada "Worker fixture finalizado"
