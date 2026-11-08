---
owner: tecnico
sources:
  - apps/web/src/pages/importaciones
  - apps/web/src/hooks/useProcesosMasivos.ts
  - apps/web/src/hooks/useErroresProceso.ts
  - apps/web/src/lib/procesosMasivos.ts
  - apps/web/src/lib/erroresWeb.ts
  - apps/web/e2e
  - supabase/migrations
  - supabase/tests/database
  - infra/kestra/flows
  - infra/glitchtip
  - workers
---

# Importaciones y monitoreo (MSF-206)

Épica de Plataforma con dos historias: **F-IMP-01 · MSF-354** (centro de importaciones y exportaciones) y
**F-OPS-03 · MSF-369** (monitoreo y registro de errores). El manual de la persona que usa el sistema está en
[Importaciones y exportaciones](../producto/importaciones.md); esta página cubre datos, API, flujos, operación
y pruebas.

!!! warning "Estado de la rama"
    La implementación vive en la línea de la épica: merge `cba8f00a` (PR #764, rama
    `epic/MSF-206-plataforma-importaciones-y-monitoreo`) sobre `dokploy`; a la fecha de esta página **no está en
    `main`**. Las rutas, migraciones y pruebas citadas existen en esa línea. La spec vive en
    `specs/20261102-220000-importaciones-y-monitoreo/` (`spec.md`, `plan.md`, `tasks.md`, `contracts/`).

## Alcance

- **Entrega:** `refine`, `supabase`, `kestra`, `workers` y un producto de infraestructura nuevo,
  `infra/glitchtip/` (registro de errores).
- **No hace:** no migra cargas existentes ni inicia importaciones por sí mismo; cada funcionalidad (Catálogo,
  Stock, Mercado Libre, exportación total) registra sus procesos con este contrato. Tampoco agrega la cola de
  Mercado Libre (MSF-175): la regla de monitoreo la admite como otra fuente cuando exista.
- **Fuera de alcance del prototipo:** reintentar errores, descargar el registro, columnas `Nuevas`/`Actualizadas`
  y las pestañas internas de Mercado Libre (ver matriz de la spec).

## Modelo de datos

Migraciones **aditivas** (los números reales son `20270211100001…05` y `20270211100011…12`; los nombres de
`plan.md` quedaron desactualizados por la renumeración de la integración):

| Migración | Contenido |
|---|---|
| `20270211100001_procesos_masivos_tablas.sql` | `public.procesos_masivos`, `public.procesos_masivos_errores`, `private.sanitizar_motivo_proceso`, RLS y grants por columna; trigger de terminalidad |
| `20270211100002_procesos_masivos_inicio.sql` | `public.iniciar_proceso_masivo(...)` |
| `20270211100003_procesos_masivos_worker.sql` | `private.autorizar_worker_proceso`, `actualizar_progreso_proceso_masivo`, `registrar_error_proceso_masivo`, `cerrar_proceso_masivo` |
| `20270211100004_procesos_masivos_cancelacion.sql` | `solicitar_cancelacion_proceso_masivo`, `proceso_masivo_cancelado` |
| `20270211100005_procesos_masivos_reconciliar.sql` | Trigger `reconciliar_proceso_masivo` sobre `ejecuciones_worker` |
| `20270211100011_monitoreo_tablas.sql` | `public.eventos_monitoreo`, `public.alertas_monitoreo`, RLS solo superadmin, índice único parcial de alerta abierta |
| `20270211100012_monitoreo_funciones.sql` | `registrar_evento_monitoreo`, `evaluar_monitoreo`, `tiendas_a_sondear`, `private.sanitizar_motivo_monitoreo` |

Tablas y DER del grafo afectado: [Datos y DER](datos.md#importaciones-y-monitoreo-msf-206). Resumen:

| Tabla | Estado | Acceso |
|---|---|---|
| `public.procesos_masivos` | **nueva** | `select` solo administradores de la organización (`private.es_administrador_de`); sin escritura directa; `anon` sin privilegios |
| `public.procesos_masivos_errores` | **nueva** | Ídem, por `organizacion_id` |
| `public.eventos_monitoreo` | **nueva** | `select` solo superadmin (`private.is_superadmin`); escritura solo por funciones |
| `public.alertas_monitoreo` | **nueva** | Ídem; una única fila `abierta` por `(fuente, clave)` |

Estados del proceso: `pendiente | en_curso | completado | con_errores | fallido | cancelado`. El trigger
`proteger_proceso_masivo` impide que un estado terminal cambie; `finalizado_en` es `null` si y solo si el proceso
sigue abierto. La tabla cuelga de `public.ejecuciones_worker` (`ejecucion_id` único) y de la outbox
`public.despachos_ejecucion`; no hay un segundo ciclo de ejecución.

## RPC y contrato

Todas son `security definer` con `search_path = ''` y autorizan dentro; la organización sale de la sesión, nunca
de un parámetro.

| Función | Quién la ejecuta | Qué hace |
|---|---|---|
| `public.iniciar_proceso_masivo(p_conexion_id, p_capacidad, p_tipo, p_funcionalidad, p_nombre, p_empresa_id?, p_parametros?)` | `authenticated`, solo administrador | Crea proceso `pendiente` + ejecución (`iniciar_ejecucion_worker`, origen `manual`) + orden de despacho en una transacción. Devuelve el `id`. Errores: `NO_AUTORIZADO`, `TIPO_INVALIDO`, `ARGUMENTO_INVALIDO`, `SECRETO_DETECTADO`, `EMPRESA_INVALIDA`, más `YA_EN_CURSO`/`CAPACIDAD_NO_HABILITADA` del ciclo |
| `public.actualizar_progreso_proceso_masivo(p_proceso_id, p_procesados, p_total?)` | `workers_orquestacion` autorizado sobre su organización | Pasa a `en_curso` en el primer aviso; `procesados` no retrocede ni supera `total` |
| `public.registrar_error_proceso_masivo(p_proceso_id, p_fila?, p_referencia?, p_motivo)` | ídem | Guarda un error por fila con motivo sanitizado; idempotente por `(proceso, fila)`; hasta 1000 detalles por proceso; `con_errores` cuenta todos |
| `public.proceso_masivo_cancelado(p_proceso_id)` | ídem | `true` si hay cancelación solicitada; el worker lo consulta entre lotes |
| `public.cerrar_proceso_masivo(p_proceso_id, p_estado, p_motivo?)` | ídem | Cierra como `completado`, `con_errores`, `fallido` o `cancelado`; un motivo de cierre queda como detalle sin fila |
| `public.solicitar_cancelacion_proceso_masivo(p_proceso_id)` | `authenticated`, solo administrador | `pendiente` → `cancelado` (libera la orden y cierra la ejecución como `fallida`/`CANCELADA`); `en_curso` → `cancelacion_solicitada`; terminal → `PROCESO_TERMINADO` |

`iniciar_proceso_masivo` y `solicitar_cancelacion_proceso_masivo` tienen `revoke` a `public`/`anon` y `grant` a
`authenticated`. Las funciones del worker tienen `revoke` a `public`/`anon`/`authenticated` y `grant` a
`workers_orquestacion`; `private.autorizar_worker_proceso` valida que el proceso sea de la organización del worker.

## Pantalla `/importaciones`

- Ruta en `apps/web/src/App.tsx`, ítem **Importaciones** en *Administración* con audiencia `administrador`
  (`apps/web/src/components/navegacion/destinosPanel.ts`). No hay rutas anteriores.
- Implementación: `apps/web/src/pages/importaciones/list.tsx` (tabla), `DetalleImportacion.tsx` (diálogo),
  `CancelarProceso.tsx` (confirmación); datos en `hooks/useProcesosMasivos.ts` y `hooks/useErroresProceso.ts`;
  textos y formato en `lib/procesosMasivos.ts`.
- Columnas: fecha, origen (nombre legible + tipo + funcionalidad; nunca la clave técnica), estado, avance,
  errores y duración. Página de 20 procesos; errores de a 10. Estados compartidos de carga, vacío y error.
- Refresco por consulta cada 5 s (`REFRESCO_PROCESOS_MS`) mientras haya procesos `pendiente`/`en_curso`; se
  detiene cuando todos son terminales. No usa Realtime.
- **Empresa activa (Principio VIII):** la empresa va en las dependencias de la consulta; al cambiar se recarga,
  la paginación vuelve a la página 1 y los diálogos se cierran con aviso. Un proceso sin empresa solo aparece en
  «Todas mis empresas».
- Accesibilidad: tablas y diálogos MUI con `aria-label`, foco devuelto al botón al cerrar con Escape; E2E con axe a
  320/768/1440 px. Sin identificadores técnicos visibles.

## Monitoreo y registro de errores

### Herramienta de errores

- Producto propio `infra/glitchtip/compose.yaml` (proyecto Compose `multistorefront-meli-glitchtip-dev`,
  GlitchTip `v5.1`), bajo demanda: `pnpm dev:glitchtip` / `pnpm dev:down:glitchtip` (en la línea de la épica).
  El puerto se publica atado a `127.0.0.1:${GLITCHTIP_PORT:-8100}`.
- **Web:** `apps/web/src/lib/erroresWeb.ts` instala los manejadores globales desde `apps/web/src/main.tsx`. Sin
  `VITE_ERRORES_DSN` es un no-op. Filtra correos, teléfonos, tokens, parámetros sensibles y reduce la URL a origen y
  ruta; no envía cuerpos de formulario, cookies ni cabeceras. Deduplica un mismo error una vez por minuto y tope de
  10 envíos por minuto para no inundar la herramienta.
- **Workers:** `workers/_comun/errores.mjs` envía el evento con el tag `EJECUCION_ID`; sin `ERRORES_DSN` no hace
  nada y nunca cambia el código de salida del worker.

### Tablas y regla de alertas

- `public.eventos_monitoreo` guarda `fuente` (`tienda`, `sincronizacion`, `cola`, `aplicacion`), `clave`, `resultado`
  (`ok`/`fallo`), motivo sanitizado y `ocurrido_en`.
- `public.alertas_monitoreo` guarda una alerta `abierta` o `resuelta` por `(fuente, clave)`; el índice único parcial
  impide duplicados abiertos. `evaluar_monitoreo(p_ventana_min, p_fallos, p_cola_min)` abre, resuelve y devuelve
  **solo las nuevas** ya marcadas como notificadas (idempotente).
- Umbrales por defecto: **5 fallos en 10 minutos** por fuente y clave (tienda, sincronización; aplicación con un
  fallo porque el flow ya contó contra el umbral) y **cola sin avanzar 15 minutos**. Son inputs de los flows.
- Sincronización se deriva de `ejecuciones_worker` con estado `fallida`/`timeout` por `(organización, capacidad)`;
  la cola se deriva de `despachos_ejecucion` en `pendiente`/`reclamada` sin cambios.
- La notificación sale por el subflow `alertas` existente (tipo `tecnica`) hacia `KESTRA_ALERTAS_WEBHOOK_URL`, sin
  modificarlo. El subflow solo admite el motivo `FALLA_TECNICA_SANITIZADA`; el detalle queda en
  `alertas_monitoreo`. **Proveedor y casilla de destino: pendiente (D-2), dueño Nicolás.**

### Flows de Kestra (`infra/kestra/flows/`)

| Flow | Frecuencia | Qué hace |
|---|---|---|
| `monitoreo-salud-tiendas` | cada 2 min | Sondea `https://<dominio>/` de `public.tiendas_a_sondear()` sin seguir redirecciones; 2xx/3xx = `ok`, el resto fallo |
| `monitoreo-evaluar` | cada 2 min | Llama a `evaluar_monitoreo` con `ventana_min=10`, `fallos=5`, `cola_min=15` y notifica cada alerta nueva por el subflow `alertas` |
| `monitoreo-errores-aplicacion` | cada 2 min | Cuenta eventos de los últimos 10 min en GlitchTip (umbral 5) y registra `fallo`/`ok` de fuente `aplicacion`; sin `ERRORES_APP_URL` no hace nada |

Todos los flows usan el rol `kestra_orquestacion`; las funciones de monitoreo tienen `revoke` para `public`,
`anon` y `authenticated`. `postgres`/`supabase_admin` se admiten por nombre para el pgTAP y el mantenimiento.

### Variables

| Variable | Dónde | Efecto |
|---|---|---|
| `VITE_ERRORES_DSN`, `VITE_ERRORES_AMBIENTE`, `VITE_APP_VERSION` | `apps/web/.env` | DSN del panel; **vacío = no se envía nada** |
| `ERRORES_DSN`, `ERRORES_AMBIENTE`, `ERRORES_VERSION` | entorno de cada worker | Ídem para workers; el evento lleva `EJECUCION_ID` |
| `ERRORES_APP_URL`, `ERRORES_APP_ORGANIZACION`, `ERRORES_APP_PROYECTO` | `infra/kestra/.env` | Dónde cuenta Kestra los errores; sin URL el flow no hace nada |
| `SECRET_ERRORES_APP_TOKEN` | `infra/kestra/.env` (base64) | Token de **lectura** de GlitchTip; secreto de Kestra, nunca en Git |
| `KESTRA_ALERTAS_WEBHOOK_URL` | `.env` / `infra/kestra/.env` | Destino de las alertas |
| `GLITCHTIP_PORT`, `GLITCHTIP_DB_PASSWORD`, `GLITCHTIP_SECRET_KEY` | `infra/glitchtip/.env` | GlitchTip local; en entornos compartidos se fijan fuera de Git |

## Cómo probarlo (técnico)

### Prerrequisitos

- `pnpm dev:supabase` y el panel servido; para la base, `pnpm test` (pgTAP) o `supabase test db`.
- Un administrador de una organización con una conexión y una capacidad habilitada (`capacidades_ejecucion`) para
  poder iniciar un proceso masivo.
- Para GlitchTip en la línea de la épica: `pnpm dev:glitchtip`, organización y proyectos web/workers, y los DSN en
  `.env` (sin DSN el envío es un no-op).

### Pasos

1. **Base (pgTAP).** Correr `pnpm test`. Deben quedar verdes `procesos_masivos.test.sql`,
   `procesos_masivos_worker.test.sql`, `procesos_masivos_cancelacion.test.sql`, `monitoreo.test.sql` y
   `rls_en_toda_tabla`.
2. **Crear un proceso.** Como administrador, llamar a `iniciar_proceso_masivo` con una conexión/capacidad válidas.
   Debe devolver un `uuid` y dejar una fila `pendiente` con `ejecucion_id` y su orden en `despachos_ejecucion`.
3. **Ver la pantalla.** Abrir `/importaciones` con ese usuario: la fila debe aparecer en **Pendiente**; con el rol
   de un no administrador, el ítem no aparece y la ruta muestra el aviso de permisos.
4. **Progreso y errores.** Con el rol de worker, llamar a `actualizar_progreso_proceso_masivo` (por ejemplo 40 de
   100) y a `registrar_error_proceso_masivo` con una fila de prueba. La tabla debe mostrar «40 de 100» y el detalle
   la fila, la referencia y el motivo. Reintentar el mismo error no debe duplicarlo ni sumar a `con_errores`.
5. **Cancelar.** Con el proceso pendiente, pulsar **Cancelar** y confirmar: pasa a **Cancelado** y la orden queda
   `cancelada`. Repetir sobre uno `en_curso`: queda **Cancelando** y el worker lo cierra `cancelado` entre lotes.
   Sobre uno terminal, el mensaje es «El proceso ya terminó, no se puede cancelar.».
6. **Reconciliación.** Cerrar la ejecución como `fallida` o `timeout` sin cerrar el proceso: el trigger debe dejarlo
   `fallido`.
7. **Empresa activa.** Crear procesos en dos empresas y uno sin empresa; cambiar la empresa en la barra superior: la
   tabla recarga, vuelve a la página 1, cierra el diálogo con aviso y no muestra procesos de la empresa anterior.
8. **Monitoreo (línea de la épica).** Con `pnpm dev:glitchtip` y los DSN cargados, inducir un error en la consola
   del panel y uno en un worker con `EJECUCION_ID`. Deben aparecer agrupados, sin correos ni teléfonos, y el del
   worker con el tag `EJECUCION_ID`.
9. **Alertas (SQL).** Con el rol de plataforma, revisar:

   ```sql
   select fuente, clave, estado, abierta_en, notificada_en, resuelta_en
   from public.alertas_monitoreo
   order by abierta_en desc;

   select fuente, clave, resultado, motivo_sanitizado, ocurrido_en
   from public.eventos_monitoreo
   order by ocurrido_en desc
   limit 20;
   ```

   Cuatro fallos no deben abrir alerta; el quinto sí, una sola vez. Al normalizarse debe quedar `resuelta` y una
   nueva caída debe abrir otra. Una orden de cola sin avanzar 14 minutos no alerta; a los 15 sí.

### Resultado esperado

- Un administrador ve el proceso, su avance y sus errores sin recargar a mano; al terminar todos, la tabla deja de
  refrescarse.
- Cancelar un proceso pendiente o en curso termina en `cancelado` conservando lo procesado.
- Otra organización, un no administrador y `anon` no leen ni cancelan procesos.
- 5 fallos en 10 minutos generan **una** alerta, no se repite mientras siga abierta y una nueva caída tras
  resolverse genera otra.
- Un error inducido en web y en un worker aparece en GlitchTip sin datos personales.

### Cómo automatizarlo

| Rótulo / prueba | Qué cubre |
|---|---|
| `[MSF-354:T013]` `apps/web/e2e/importaciones-a11y.e2e.ts` | Axe sin violaciones a 320/768/1440 px, teclado, sin identificadores técnicos |
| `[MSF-354:T014]` `apps/web/e2e/importaciones.e2e.ts` | Avance visible, detalle con errores, cancelación y cambio de empresa |
| `apps/web/src/pages/importaciones/*.test.tsx` | Tabla, refresco, detalle, cancelación y empresa activa (Vitest) |
| `supabase/tests/database/procesos_masivos*.test.sql` | RLS, estados, progreso, cancelación y reconciliación (pgTAP) |
| `supabase/tests/database/monitoreo.test.sql` | Umbrales, deduplicación, resolución y permisos (pgTAP) |
| `infra/kestra/validar-monitoreo-*.test.mjs` | Flows válidos, umbrales por defecto y uso del subflow `alertas` |
| `scripts/tests/errores-worker.test.mjs`, `apps/web/src/lib/errores-web.test.ts` | Filtrado de datos y `EJECUCION_ID` |

Los E2E requieren Supabase local y `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; sin eso se omiten. El paso manual de
GlitchTip (SC-006) todavía no está automatizado contra una instancia real: queda pendiente de automatizar.

## Pendientes y seguimiento

- **TODO (capturas del manual):** no se pudieron generar en esta rama (no existe `pnpm docs:capturas` y el código
  de la épica no está en `main`). Cuando la épica esté en la línea de documentación, generarlas en
  `docs/producto/img/importaciones/` y enlazarlas desde el manual. Dueño: Documentación / Nicolás.
- **TODO (D-2):** proveedor y casilla de destino de las alertas. Dueño: Nicolás.
- **TODO (spike de la API de GlitchTip):** la ruta de listado de eventos (`ruta_eventos`) no se pudo verificar
  contra una instancia; si no sirve para contar, volver a D-1. Dueño: Plataforma.
- **Cargas existentes:** conectar Stock, Productos, Mercado Libre e historial al centro es trabajo de sus épicas;
  hasta entonces el centro puede estar vacío. Fuera de alcance de MSF-206.
- **Endurecimiento de GlitchTip:** fallar al arrancar si faltan `GLITCHTIP_SECRET_KEY`/contraseña fuera de
  desarrollo. Dueño: Infraestructura.

## Reversión

Cada migración trae su reversión en el encabezado. En orden inverso: `drop trigger reconciliar_proceso_masivo on
public.ejecuciones_worker`; las funciones `*_proceso_masivo`, `private.autorizar_worker_proceso`,
`private.reconciliar_proceso_masivo`, `private.proteger_proceso_masivo`,
`private.sanitizar_motivo_proceso(text, boolean)`, `public.tiendas_a_sondear`, `public.evaluar_monitoreo`,
`public.registrar_evento_monitoreo` y `private.sanitizar_motivo_monitoreo`; y por último las tablas
`public.procesos_masivos_errores`, `public.procesos_masivos`, `public.alertas_monitoreo` y
`public.eventos_monitoreo` (solo mientras no haya datos productivos).
