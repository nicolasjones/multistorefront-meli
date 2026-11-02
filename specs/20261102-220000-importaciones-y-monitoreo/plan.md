# Plan de implementación: Importaciones y monitoreo (MSF-206)

**Spec**: [`spec.md`](./spec.md) · **Contratos**: [`contracts/importaciones-y-monitoreo.md`](./contracts/importaciones-y-monitoreo.md)

## Enfoque técnico

- **F-IMP-01 (Supabase + Refine + workers)**: capa de procesos masivos sobre el ciclo del template. `procesos_masivos` cuelga de `ejecuciones_worker` (spec 016) y de la outbox (spec 019); `iniciar_proceso_masivo` llama a `iniciar_ejecucion_worker` (patrón de `solicitar_importacion_historial`, MSF-293). Escritura solo por funciones `security definer`; los workers usan su rol `worker_<org>` y la organización sale de la sesión, nunca de un parámetro. Pantalla `pages/importaciones/` con tabla, diálogo de detalle y cancelación; refresco por consulta periódica mientras haya procesos abiertos (D-4). Protocolo para workers documentado en `workers/CONTRATO.md`.
- **F-OPS-03 (Kestra + Supabase + infra + workers)**: GlitchTip como producto (`infra/glitchtip/compose.yaml`, D-1); SDK compatible con Sentry en `apps/web` y en los workers. Las alertas operativas salen de tres flows de Kestra (`monitoreo-salud-tiendas`, `monitoreo-evaluar`, `monitoreo-errores-aplicacion`) que escriben/leen `eventos_monitoreo` y `alertas_monitoreo` con el rol `kestra_orquestacion` y notifican por el subflow `alertas` **sin modificarlo**. La base calcula umbrales y deduplica; Kestra solo sondea, lee y notifica (Principio III).
- **Empresa activa** (Principio VIII): todas las consultas del centro llevan la empresa activa en su `queryKey` (patrón de `docs/empresa-activa.md`).
- **Independencia entre historias**: no comparten tabla, migración ni archivo de código (F-IMP-01 documenta en `workers/CONTRATO.md` y `docs/importaciones.md`; F-OPS-03 en `docs/monitoreo.md` y `workers/README.md`). Por eso corren en paralelo.

## Esquemas y reversión (aditivo)

Marcas de tiempo posteriores a la última migración del repo (`20270201200140`).

| Migración | Historia | Objetos (esquema) | Reversión (migración posterior) |
|---|---|---|---|
| `20270202100000_procesos_masivos_tablas.sql` | F-IMP-01 | `public.procesos_masivos`, `public.procesos_masivos_errores`, RLS, índices, grants | `drop table public.procesos_masivos_errores; drop table public.procesos_masivos;` (solo mientras no haya datos productivos) |
| `20270202100100_procesos_masivos_inicio.sql` | F-IMP-01 | `public.iniciar_proceso_masivo` | `drop function public.iniciar_proceso_masivo(...)` |
| `20270202100200_procesos_masivos_worker.sql` | F-IMP-01 | `actualizar_progreso_…`, `registrar_error_…`, `cerrar_…` (`public`) | `drop function …` por cada una |
| `20270202100300_procesos_masivos_cancelacion.sql` | F-IMP-01 | `solicitar_cancelacion_…`, `proceso_masivo_cancelado` (`public`) | `drop function …` |
| `20270202100400_procesos_masivos_reconciliar.sql` | F-IMP-01 | trigger y función `private.reconciliar_proceso_masivo` sobre `ejecuciones_worker` | `drop trigger …; drop function …` |
| `20270202110000_monitoreo_tablas.sql` | F-OPS-03 | `public.eventos_monitoreo`, `public.alertas_monitoreo`, RLS, grants | `drop table public.alertas_monitoreo; drop table public.eventos_monitoreo;` |
| `20270202110100_monitoreo_funciones.sql` | F-OPS-03 | `public.registrar_evento_monitoreo`, `public.evaluar_monitoreo`, permisos a `kestra_orquestacion` | `drop function …` |

Cada tabla/vista/RPC se re-verifica contra el Principio VII (spec → plan → tareas → implementación → PR). Ninguna migración destruye lo que crea en el mismo PR.

## Decisiones técnicas

- **Cancelación cooperativa**: el worker consulta `proceso_masivo_cancelado` entre lotes; no se mata el contenedor. Cancelar `pendiente` resuelve la orden de la outbox con la función de liberación existente (a verificar su nombre exacto en `20260923172738_iniciar_ejecucion_outbox.sql` al implementar T004).
- **Reconciliación**: trigger `AFTER UPDATE OF estado` en `ejecuciones_worker` (aditivo; no cambia la tabla) que cierra como `fallido` el proceso abierto cuyo `ejecucion_id` termina `fallida`/`timeout`.
- **Umbrales en la base** (`evaluar_monitoreo(p_ventana, p_fallos, p_cola)`), con los valores 10 min / 5 / 15 min como inputs por defecto de los flows. Una alerta abierta por `(fuente, clave)` con índice único parcial.
- **Fuentes**: `tienda` (sondeo), `sincronizacion` (`ejecuciones_worker` fallida/timeout por capacidad, leídas por `evaluar_monitoreo`), `cola` (`despachos_ejecucion` sin avanzar), `aplicacion` (API de la herramienta de errores). La cola de Mercado Libre se agrega como otra fuente cuando exista MSF-175.
- **Spike de API (primera tarea de F-OPS-03)**: confirmar el endpoint exacto de conteo de eventos de GlitchTip (API compatible con Sentry) antes de escribir `monitoreo-errores-aplicacion`; si no sirve, se vuelve a D-1 y se pregunta.
- **Sanitización**: `motivo_sanitizado` pasa por la misma función de sanitización del ciclo de ejecuciones; el SDK web filtra en `beforeSend` (correos, teléfonos, tokens, cuerpos de formularios). Lección previa del repo: nunca loguear el error crudo de PostgREST con datos personales.

## Riesgos

- **Dependencia nueva (SDK de errores)**: revisión con `supply-chain-security` antes de agregarla; versión fijada en el lockfile.
- **Errores en cantidad por proceso**: tope de errores guardados por proceso (valor inicial configurable en la función) para que un archivo de millones de filas malas no llene la tabla; `con_errores` sigue contando todos.
- **Sondeo de tiendas**: solo hace GET al dominio registrado en `dominio.tiendas` (valor ya validado por `normalizar_dominio_tienda`), sin seguir redirecciones a otros hosts, para no abrir un SSRF.
- **GlitchTip es infraestructura nueva**: su Compose propio, variables en `.env.example`, bajo demanda en staging (Principio V). Si no se aprueba D-1, el resto de F-OPS-03 sigue valiendo.
- **Centro vacío al inicio**: hasta que otras épicas se conecten (D-5), no habrá filas reales; el E2E crea procesos de prueba por las funciones.
- **Rol de Kestra**: los flows nuevos necesitan grants en `kestra_orquestacion` (`infra/kestra/sincronizar-rol-orquestacion.mjs`).

## Documentación

`docs/importaciones.md`, `docs/monitoreo.md`, `workers/CONTRATO.md`, `workers/README.md`, `Constitución` (lista de proyectos Compose del Principio IV con `multistorefront-meli-glitchtip-dev`), `docs/roadmap-template.md` (cierre). `pnpm docs:check` debe pasar.
