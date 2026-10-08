# Data Model: Observabilidad de plataforma para workers de navegador

No hay cambios de base de datos. Las entidades son contratos de archivo/log.

## Evento de etapa (línea JSON en stdout)

| Campo | Tipo | Regla |
|---|---|---|
| `etapa` | string | `^[a-z][a-z0-9_-]{0,39}$`; nombre libre del producto. `evidencia` queda reservada para fallos de captura. |
| `estado` | string | `iniciada` \| `completada` \| `fallida` \| `omitida` |
| `timestamp` | string | ISO-8601 UTC con `Z` |
| `ejecucion` | string | `EJECUCION_ID` si existe; si no, `KESTRA_EJECUCION_ID` |
| `mensaje` | string | opcional, ≤ 500 caracteres, sanitizado |

Transiciones por etapa: `iniciada → completada | fallida`; `omitida` es un
estado terminal sin inicio. La última etapa `completada` antes de un `fallida`
es la última etapa completada de la ejecución.

## Evidencia visual (archivo)

- Ubicación en el worker: `$EVIDENCIA_DIR/<AAAAMMDDTHHMMSSmmmZ>-<etapa>.png`.
- Ubicación transitoria en el host:
  `<EVIDENCIA_DIR_HOST>/<execution.id>/<organizacion_id>/`.
- Ubicación final: output `outputFiles` de la tarea `publicar_evidencia` de la
  ejecución de Kestra, hasta la limpieza.
- Máximo 50 archivos por despacho de organización.

## Política de retención

- `EVIDENCIA_RETENCION_DIAS`: entero ≥ 0, default 30.
- Corte: ejecuciones terminales iniciadas antes de `now - N días`.
- Se borra: almacenamiento interno de esas ejecuciones (capturas y archivo de
  logs publicado). Se conserva: ejecución, logs, métricas, Supabase.
