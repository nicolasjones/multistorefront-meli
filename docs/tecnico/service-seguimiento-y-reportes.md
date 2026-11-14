---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - supabase/functions
  - infra/superset
  - apps/web/src
---

# Service técnico: seguimiento y reportes (técnico, MSF-124)

Épica **MSF-124** · historias F-SVC-20 (MSF-134, fotos y adjuntos), F-SVC-21 (MSF-146, garantía), F-SVC-22 (MSF-157,
enlace de consulta) y F-SVC-23 (MSF-168, reportes y exportación), más el cierre MSF-582. Spec, plan, tareas y
contratos: `specs/20261028-100000-service-seguimiento-y-reportes/`. Implementación integrada en `dokploy` (PR #591); las guías de abajo
viven en el repo de código y llegan a `main` con la promoción. Resumen para usuarios:
[Service técnico: fotos, garantía, seguimiento y reportes](../producto/service-seguimiento-y-reportes.md).

Alcance de entrega: `refine`, `supabase` (migraciones, RPC, Storage, Edge Function) y `superset`.

## Guías por historia (en la rama de la épica)

| Historia | Guía | Contenido |
|---|---|---|
| F-SVC-20 | `docs/service-adjuntos.md` | Tabla, bucket privado, políticas, límites, huérfanos, reversión |
| F-SVC-21 | `docs/service-garantia.md` | Regla, RPC, vínculo, numeración, reversión |
| F-SVC-22 | `docs/service-seguimiento.md` | Token, Edge Function pública, límite por IP, riesgos |
| F-SVC-23 | `docs/service-reportes.md` | Exportación, vistas `analitica`, tablero, datos de prueba |
| Cierre | `docs/service-tecnico.md` | Índice y revisión de seguridad (T056) |

## Modelo de datos

Esquema (Principio VII): negocio del taller en `dominio`; contador transversal del endpoint público en `public`;
vistas de lectura en `analitica`.

```mermaid
erDiagram
    reparaciones ||--o{ reparacion_adjuntos : "tiene (FK compuesta con organizacion_id)"
    reparaciones ||--o| reparacion_enlaces_consulta : "un token"
    reparaciones |o--o{ reparaciones : "reparacion_origen_id (garantía)"
    reparaciones ||--|| service_reparaciones : "vista analitica"
```

| Objeto | Esquema | Migración | Acceso |
|---|---|---|---|
| `reparacion_adjuntos` | `dominio` | `20270219140100` | `select` por RLS (organización, nivel `service_tecnico`, tienda accesible); sin escritura directa |
| Bucket `reparacion-adjuntos` (privado, 5 MB, jpeg/png/webp) y políticas de `storage.objects` | plataforma | `20270219140200`, `20270219140600` | `select` lectura/edición; `insert`/`delete` edición; sin `update` |
| `registrar_adjunto_reparacion`, `quitar_adjunto_reparacion`, `listar_adjuntos_reparacion` | `public` | `20270219140300`, `…0400`, `…0500` | `authenticated`; máximo 20 por reparación bajo `for update`; anulada → `55000`; el registro compara tipo y tamaño con los metadatos (`mimetype`, `size`) que Storage guardó del objeto |
| `reparaciones.reparacion_origen_id` | `dominio` | `20270219150100` | FK compuesta, `check (origen <> id)`, sin escritura directa |
| `reingresar_por_garantia`, `obtener_vinculos_garantia` | `public` | `20270219150200`, `…0300` | `authenticated`; origen entregado y no anulado (`55000`); origen inexistente, de otra organización o de tienda inaccesible → `P0002` (antes `42501`) |
| `reparacion_enlaces_consulta` | `dominio` | `20270219160100` | RLS sin políticas ni grants |
| `obtener_enlace_consulta` | `public` | `20270219160200` | `authenticated`, exige `edicion`; idempotente; reparación inexistente o de tienda inaccesible → `P0002` (antes `42501`) |
| `consultas_publicas_intentos`, `registrar_consulta_publica` | `public` | `20270219160300` | RLS sin políticas; función solo `service_role` |
| `estado_publico_reparacion` (`private`) y `obtener_estado_publico_reparacion` | `private`/`public` | `20270219160400` | envoltorio solo `service_role` |
| `analitica.service_reparaciones`, `analitica.service_reparacion_items` | `analitica` | `20270219130100`, `…0200` | solo `select` para `superset_analitica`; sin costos |
| Fila en `public.reportes` (`seccion = 'service_tecnico'`) | `public` | `20270219130300` | asignada a organizaciones con el módulo, con backfill para las que ya lo tenían; roles por defecto `administracion` y `consulta` |
| `private.conjuntos_exportacion_total()` y `private.exclusiones_exportacion_total()` | `private` | `20270219170000` | integración con la exportación total: se exporta `reparacion_adjuntos` (solo el registro, no los archivos del bucket) y se excluye `reparacion_enlaces_consulta` (guarda tokens) |

Todas las migraciones son aditivas, con reversión en el encabezado de cada guía. Las RPC de la app llevan
`revoke … from public, anon` y `grant execute … to authenticated`.

## Flujos y contratos

- **Adjuntos**: la interfaz valida extensión, cabecera real, 5 MB y 20 por reparación, sube a
  `<organizacion_id>/<reparacion_id>/<uuid>.<ext>` y llama a `registrar_adjunto_reparacion`; si falla, borra el objeto (con reintentos). Para quitar, borra la fila y
  después el objeto, con hasta 3 intentos. Si Storage rechaza una subida, la interfaz borra los huérfanos de la
  carpeta con más de 10 minutos y reintenta una sola vez. Miniaturas con URL firmada de 5 minutos. Un huérfano no
  aparece en la aplicación pero **no es del todo inaccesible** (la política de `select` de `storage.objects` no mira
  la tabla; hace falta `lectura` y conocer la ruta, un UUID aleatorio), cuenta para el tope de 20 de la política de
  `insert` y no tiene purga automática; la guía de adjuntos trae la consulta para detectarlos.
- **Garantía**: `reingresar_por_garantia` copia tienda, cliente, contacto, modelo, serie y accesorios; numera con el
  bloqueo de MSF-182; no copia ítems, costos ni adjuntos. Deja **dos eventos** de actividad, `reparacion.creada` y
  `reparacion.reingreso_garantia`, a propósito.
- **Enlace**: página `/seguimiento/:token` fuera del panel (`apps/web/src/pages/seguimiento/index.tsx`) →
  Edge Function `supabase/functions/consultar-estado-reparacion` (`verify_jwt = false` en `supabase/config.toml`).
  Respuestas 200 (lista blanca de 8 claves: `codigo`, `tienda`, `equipo`, `modelo`, `estado`, `entrega_prevista`,
  `anulada`, `linea_de_tiempo`), 404 uniforme, 429 con `Retry-After`, 500. Una reparación anulada sale con `anulada`,
  sin entrega prevista ni evento de anulación en la línea de tiempo, y el motivo nunca sale. Límite: 30 consultas
  por 10 minutos por IP hasheada con `SEGUIMIENTO_IP_SALT` (solo en `supabase/functions/.env.example`). La IP sale
  **solo** de `x-forwarded-for` (el valor `SEGUIMIENTO_SALTOS_PROXY` proxies antes del último, por defecto 1);
  `x-real-ip` se ignora; una cadena más corta que la esperada cae a un contador compartido (falla cerrada). La
  topología Traefik → Kong **no está confirmada** y hay que probarla en STG antes de promover. `apps/web/nginx.conf`
  agrega `X-Robots-Tag: noindex, nofollow` y `Referrer-Policy: no-referrer` a `/seguimiento/`. Detalle en
  `docs/service-seguimiento.md`.
- **Exportación**: `apps/web/src/lib/exportarReparaciones.ts` sobre `listar_reparaciones` por lotes de 200, tope
  100.000 filas, sin RPC nueva ni costos.
- **Reportes**: tablero YAML en `infra/superset/dashboards/service/`, importado con `pnpm superset:importar-dashboards`;
  pestaña `/service-tecnico/reportes` con `ReporteEmbebido` (y su entrada «Reportes» en la ayuda del panel); token de invitado con cláusula
  `organizacion_id = '<org>'` y acceso con `lectura`/`edicion` en `service_tecnico`. Quien no tiene el reporte asignado a su rol ve «No tenés acceso
  al tablero de Service técnico: tu organización todavía no lo tiene asignado o tu rol no lo incluye. Pedile acceso a
  un administrador.»

## Empresa activa

Listado y exportación respetan la empresa activa (el export congela filtros y empresa al pulsar). El diálogo de
reingreso se cierra con aviso al cambiar de empresa. El tablero de Reportes **no** se filtra por empresa activa
(compara todas las tiendas). La página pública no es de empresa.

## Guía de prueba (técnica)

Rótulos de la spec; los E2E se omiten sin `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (ver `docs/e2e-app.md`).

| Qué | Prueba | Rótulo / archivo |
|---|---|---|
| Adjuntos: RLS, bucket, RPC, tope 20 | pgTAP | `service_adjuntos.test.sql` |
| Adjuntos: validación y solo lectura | Vitest | `AdjuntosReparacion.test.tsx` |
| Adjuntos de punta a punta | E2E | `service-adjuntos.e2e.ts` |
| Garantía: reglas, vínculo, aislamiento | pgTAP / Vitest | `service_garantia.test.sql`, `ReingresoGarantiaDialog.test.tsx`, `VinculosGarantia.test.tsx` |
| Garantía de punta a punta | E2E | `service-garantia.e2e.ts` (`[MSF-146:T022]`) |
| Enlace: token, lista blanca, límite, aislamiento | pgTAP / Deno | `service_enlace_consulta.test.sql`, `handler.test.ts` (`pnpm test:edge:consultar-estado-reparacion`) |
| Página pública y diálogo | Vitest / E2E | `seguimiento.test.tsx`, `EnlaceSeguimientoDialog.test.tsx`, `service-seguimiento.e2e.ts` |
| Exportación | Vitest / E2E | `exportarReparaciones.test.ts`, `service-exportacion.e2e.ts` |
| Vistas y acceso a reportes | pgTAP | `service_analitica.test.sql`, `service_reportes_acceso.test.sql` |
| Tablero | contrato + revisión manual | `tableroService.contrato.test.ts`; datos con `supabase/verificacion/service_datos_prueba.sql` (revisión T055) |

Prueba manual del enlace: copiar el enlace desde el detalle, abrirlo en una ventana sin sesión y comprobar que solo
muestra la lista blanca; con un token inventado ver «No encontramos esa reparación».

## Pendientes y decisiones abiertas

Aceptado a propósito (decisión de la spec; se cambia si el cliente lo pide):

- El token del enlace se guarda en claro, no vence ni se revoca.
- El tablero compara todas las tiendas de la organización: el token filtra por organización, no por tienda accesible
  (riesgo heredado de Rentabilidad).
- Un reingreso por garantía deja dos eventos de actividad.

Abierto:

- **Topología Traefik → Kong sin confirmar**: probar el límite por IP en STG antes de promover (procedimiento en
  `docs/service-seguimiento.md`).
- **Revisión del tablero de Superset (T055)** pendiente en STG (procedimiento en `docs/service-reportes.md`).
- **E2E con sesión**: no se ejecutan en el CI (se omiten sin `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`).
- **Concurrencia real** de la numeración y del tope de 20: el pgTAP es secuencial y solo comprueba el bloqueo
  `for update`.
- **TODO (dueño: documentación/producto):** capturas del manual (`pnpm docs:capturas`, specs en
  `apps/web/e2e/capturas/`, datos de `pnpm demo:dataset`); no se generaron.
- Decisiones provisorias de la spec a confirmar con el cliente: formatos distintos de imagen, garantía sin cargo o con
  plazo, «Regenerar enlace»/vencimiento, `.xlsx` real y si los reportes se limitan a quien ve todas las tiendas.
- Las pantallas del tablero y la página pública no tienen prototipo: se armaron con el sistema de diseño.
