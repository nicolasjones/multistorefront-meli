# Contratos: Importaciones y monitoreo

Todos nuevos (sin `BREAKING`). No hay Edge Functions nuevas (no aplica OpenAPI).

## F-IMP-01 (esquema `public`)

```ts
iniciar_proceso_masivo(p_conexion_id: uuid, p_capacidad: text, p_tipo: 'importacion' | 'exportacion', p_funcionalidad: text, p_nombre: text, p_empresa_id?: uuid, p_parametros?: jsonb): uuid
```
`security definer` (`authenticated` no escribe las tablas; autoriza dentro con la organización de la sesión). Solo administradores de la organización de la sesión. Crea el proceso `pendiente` y su ejecución (`iniciar_ejecucion_worker`, origen `manual`) en la misma transacción. Errores: `NO_AUTORIZADO`, `TIPO_INVALIDO`, `ARGUMENTO_INVALIDO`, `SECRETO_DETECTADO`, `EMPRESA_INVALIDA`, `YA_EN_CURSO` (propagado del ciclo). `revoke … from public, anon`; `grant … to authenticated`.

```ts
actualizar_progreso_proceso_masivo(p_proceso_id: uuid, p_procesados: int, p_total?: int): void
registrar_error_proceso_masivo(p_proceso_id: uuid, p_fila?: int, p_referencia?: text, p_motivo: text): void
cerrar_proceso_masivo(p_proceso_id: uuid, p_estado: 'completado' | 'con_errores' | 'fallido' | 'cancelado', p_motivo?: text): void
proceso_masivo_cancelado(p_proceso_id: uuid): boolean   // true si hay cancelación solicitada
```
`security definer`, `search_path = ''`. Solo el rol `worker_<org>` de la organización dueña del proceso. `procesados` no retrocede ni supera `total`. Desvío (revisión independiente, `20270217400001`): `cerrar_proceso_masivo` valida el cierre: `completado` y `con_errores` exigen `procesados = total` cuando se informó `total` (un archivo vacío es 0 de 0), y `cancelado` exige `cancelacion_solicitada` (`ESTADO_INVALIDO`, 22023); no estaba en la spec original y evita cierres que mienten sobre lo procesado. `iniciar_proceso_masivo` exige capacidad `importar-…`/`exportar-…` acorde al tipo (`CAPACIDAD_INVALIDA`). Pasados 10.000 errores `registrar_error_proceso_masivo` deja de guardar claves y usa una marca de agua de fila (el worker informa los errores en orden ascendente de fila). El motivo se sanitiza en la base; el motivo del cierre queda como detalle sin fila (no suma a `con_errores`); se guardan hasta 1000 detalles por proceso. Primer cambio a `en_curso` en `actualizar_progreso_proceso_masivo`. `revoke … from public, anon, authenticated`; grant al rol de worker como el ciclo de ejecuciones.

```ts
solicitar_cancelacion_proceso_masivo(p_proceso_id: uuid): 'cancelado' | 'cancelacion_solicitada'
```
`security definer` (por la misma razón). Solo administradores de la organización. Terminal → error `PROCESO_TERMINADO`. `grant … to authenticated`; `revoke … from public, anon`.

```ts
procesos_masivos: { id, organizacion_id, empresa_id, tipo, funcionalidad, nombre, estado, ejecucion_id, solicitado_por, total, procesados, con_errores, cancelacion_solicitada, creado_en, iniciado_en, finalizado_en }
procesos_masivos_errores: { id, proceso_id, organizacion_id, fila, referencia, motivo_sanitizado, creado_en }
```
Tablas `public`, RLS: `select` solo administradores de la organización; sin escritura directa. Estados: `pendiente | en_curso | completado | con_errores | fallido | cancelado`.

## F-OPS-03 (esquema `public`)

```ts
registrar_evento_monitoreo(p_fuente: 'tienda' | 'sincronizacion' | 'cola' | 'aplicacion', p_clave: text, p_resultado: 'ok' | 'fallo', p_motivo?: text, p_organizacion_id?: uuid): void
evaluar_monitoreo(p_ventana_min: int = 10, p_fallos: int = 5, p_cola_min: int = 15): { fuente: text, clave: text, organizacion_id: uuid | null, motivo_sanitizado: text }[]   // alertas NUEVAS, ya marcadas como notificadas
```
`security definer`, `search_path = ''`. Solo `kestra_orquestacion`; `revoke … from public, anon, authenticated`. `evaluar_monitoreo` abre las alertas que cruzan umbral, resuelve las normalizadas y devuelve solo las nuevas (idempotente: llamarla dos veces seguidas no repite).

```ts
eventos_monitoreo: { id, organizacion_id, fuente, clave, resultado, motivo_sanitizado, ocurrido_en }
alertas_monitoreo: { id, fuente, clave, organizacion_id, estado, motivo_sanitizado, abierta_en, notificada_en, resuelta_en }
```
Tablas `public`, RLS: `select` solo superadmin; sin escritura directa. Índice único parcial `(fuente, clave) where estado = 'abierta'`.

## Kestra y variables

- Flows nuevos: `monitoreo-salud-tiendas`, `monitoreo-evaluar`, `monitoreo-errores-aplicacion` (namespace `platform.monitoreo`); usan el subflow `alertas` existente sin cambiar su firma.
- Variables nuevas en `.env.example`: DSN de la herramienta de errores para web y workers (vacío = desactivado), URL y token de lectura de la herramienta para Kestra (secreto de Kestra).
