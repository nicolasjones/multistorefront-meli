# Implementation Plan: Ventas y despacho · Ventas cobros y conciliación

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-195 · **Rama**: `epic/MSF-195-ventas-y-despacho-ventas-cobros-y-concil`
**Alcance de entrega**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Tres historias sobre el documento de venta. **F-VTA-12** agrega la tabla de cobros, el registro de cobros parciales o totales, el saldo y el paso a Cobrado/Deuda (por el punto de entrada de MSF-177), y la tarjeta Cobros del detalle. **F-VTA-13** agrega la pantalla Pagos (`/ventas/pagos`) para conciliar los pagos con cuenta de cobro. **F-VTA-14** agrega los contrarreembolsos de transporte y su pestaña en `/ventas/transportes`. La implementación arranca cuando MSF-177 esté mergeada.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/ventas/comprobante.tsx` (se extiende, MSF-159/177), `pages/ventas/pagos/` (nueva), `pages/ventas/transportes/` (existente de MSF-139: se le agrega la pestaña), `components/ventas/` (cobros, diálogo, tarjeta de cuentas), `lib/ventas/cobros.ts`, `pagos.ts`, `contrarreembolsos.ts`; `FiltroEmpresa` para la tienda (`pnpm ui:empresas:check`); entradas de menú con icono en `components/navegacion/destinosPanel.ts`.
- **Base**: tablas nuevas `dominio.cobros_comprobante` y `dominio.contrarreembolsos`; RPC en `public` (lecturas `security invoker`, escrituras `security definer`, `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`); funciones internas en `private` sin `grant`. Contratos en [contracts/ventas-cobros-y-conciliacion.md](./contracts/ventas-cobros-y-conciliacion.md).
- **Estado actual verificado**: ver la spec. Fuera del repo hoy (rama de MSF-177): `private.marcar_estado_cobro_comprobante`, `cambiar_estado_comprobante`, `historial_comprobante`. En la rama de MSF-139: `dominio.formas_pago`. **No existe** `guia` en `comprobantes_venta` (*Decisiones abiertas* 2). Los nombres exactos se verifican con `graphify query` y contra `dokploy` antes de cada historia.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Las dos tablas con RLS por organización y empresa accesible; RPC con organización de la sesión; pgTAP con dos organizaciones (SC-001, SC-003, SC-005). |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | `conciliar`, `revertir`, `marcar_cobrado` y `abrir_contrarreembolso` idempotentes; eventos `comprobante.cobro_registrado`, `pago.conciliado`, `contrarreembolso.cobrado` con actor y tienda. |
| IV Despliegues independientes | Sin worker, Kestra ni Compose nuevos. |
| V Simplicidad | Dos tablas; la conciliación es una aprobación sobre el cobro (sin tabla de extractos); sin reverso de cobro. |
| VI Panel operable | Entrada «Pagos» con icono y ruta `/ventas/pagos`; «Transportes y contrarreembolsos» en la ruta existente; «Acceso restringido»; estados compartidos; teclado/lector; 320/768/1440 px; sin carga inicial pesada (paginación en servidor). |
| VII Esquemas | `cobros_comprobante` y `contrarreembolsos` en `dominio` (negocio de ventas); permisos y actividad en `public` (sin cambio). Se re-verifica en cada tarea de migración y en el PR. |
| VIII Empresa activa | Pagos, Transportes y el detalle recargan al cambiar de empresa y cierran diálogos con aviso (FR-009, FR-028, FR-048); fila «Empresa activa» en la matriz. |
| VIII Documentación | `docs/ventas-cobros-y-conciliacion.md`, `docs/permisos-por-rol.md`, roadmap y `pnpm docs:check` (cierre). |

## Decisiones de diseño

- **Cobro inmutable** con aprobación en columnas nulables: conciliar no crea filas, solo marca quién aprobó; no hay tabla de conciliaciones.
- **Una sola vía a Cobrado/Deuda**: `private.registrar_cobro_interno` es la única que llama `marcar_estado_cobro_comprobante`; la usan `registrar_cobro` y `marcar_contrarreembolso_cobrado`.
- **F-VTA-13 y F-VTA-14 son independientes** entre sí y dependen solo de lo ya mergeado de F-VTA-12 (tabla y función interna).
- **Contrarreembolso con tabla propia** porque `guia` no existe en el comprobante; F-VTA-16 solo llama a la función `private`.

## Riesgos y reversión

- **Roles a confirmar** (*Decisiones abiertas* 1): son datos; corregirlos es una migración de datos.
- **Nombres de MSF-177/MSF-139**: se verifican al empezar; si difieren, se ajusta la tarea y se anota `Desvío:` con commit.
- **Fecha**: riesgo de correr el cierre al 18 de diciembre (documento del componente).
- **Reversión**: migraciones aditivas con reversión en el encabezado (soltar tablas, funciones y filas sembradas; exportar antes los cobros); el PR se revierte entero con `git revert -m 1`.
