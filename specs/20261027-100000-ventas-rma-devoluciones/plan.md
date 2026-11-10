# Implementation Plan: Ventas y despacho · Ventas RMA y devoluciones

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-178 · **Rama**: `epic/MSF-178-ventas-y-despacho-ventas-rma-devolucione`
**Alcance de entrega**: `refine` (apps/web) + `supabase` (migraciones + RPC + pgTAP). Sin `kestra`, `superset` ni `workers`.

## Resumen

Tres historias sobre el RMA (devoluciones y reclamos por ítem) de Ventas. **F-VTA-28** crea el dominio (tablas `rma` y `rma_items`), el alta por ítem sobre un comprobante vendido (validando cantidades) y la pantalla `/ventas/devoluciones` con su diálogo y listado. **F-VTA-29** agrega el seguimiento: filtro por forma de RMA y el ciclo de estado Abierto → En gestión → Cerrado. **F-VTA-30** vincula el RMA a la nota de crédito (reutilizando `emitir_nota_credito` de F-VTA-11) y al reingreso de stock (reutilizando `registrar_movimiento_stock` de MSF-136). Cada historia trae **su propia migración aditiva** y sus pruebas.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/ventas/devoluciones.tsx` (nueva), `components/ventas/` (diálogo de alta), `lib/formasRma.ts` y `lib/estadoRma.ts` (catálogos), `FiltroEmpresa` para la tienda (`pnpm ui:empresas:check`). Entrada de menú «Devoluciones» en el grupo Ventas de `apps/web/src/components/navegacion/destinosPanel.ts` (sección `ventas`).
- **Base**: tablas nuevas `dominio.rma` y `dominio.rma_items`; RPC en `public` (lecturas `security invoker`, escrituras `security definer`, `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`). No se alteran `comprobantes_venta`, `comprobantes_venta_lineas`, `movimientos_stock` ni `registro_actividad`. Contratos en [contracts/ventas-rma-devoluciones.md](./contracts/ventas-rma-devoluciones.md).
- **Estado actual verificado**: del repo `main` existen `dominio.comprobantes_venta` y `comprobantes_venta_lineas` (MSF-159/177), `emitir_nota_credito` + `private.devolver_stock_nota_credito` (MSF-177), `public.registrar_movimiento_stock` con `p_deposito` y `p_lote` (MSF-136/292/131) y el motivo de sistema «Devolución», `FiltroEmpresa`, `private.nivel_seccion('ventas')` y `private.empresas_accesibles()`. **No existen**: las tablas `rma`/`rma_items`, `registrar_rma`, `listar_rma`, `cambiar_estado_rma`, `vincular_nota_credito_rma`, `reingresar_stock_rma`, ni la pantalla de devoluciones. Todo lo nuevo se crea por migración o archivo; nada se asume.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | `rma` y `rma_items` con RLS por organización y sección `ventas`; RPC con organización de la sesión; pgTAP con dos organizaciones (SC-001, SC-003, SC-005, SC-006). |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | `cambiar_estado_rma`, `vincular_nota_credito_rma` y `reingresar_stock_rma` son idempotentes; eventos `rma.registrada`, `rma.estado_cambiado`, `rma.nota_credito_vinculada`, `rma.stock_reingresado`. |
| IV Despliegues independientes | Solo Refine y Supabase; sin Compose raíz; `pnpm infra:config` (validación, sin flujos nuevos). |
| V Simplicidad | Solo dos tablas nuevas; formas y estados como `check` + catálogo (sin tablas de catálogo); nota de crédito y stock se reutilizan, no se reimplementan. |
| VI Panel operable | Entrada «Devoluciones» en el grupo Ventas con icono y ruta `/ventas/devoluciones`, «Acceso restringido», estados compartidos, teclado/lector, 320/768/1440 px. |
| VII Esquemas | `rma` y `rma_items` en `dominio`; sin cambios de esquema en `public`. Se re-verifica en cada tarea de migración y en el PR. |
| VIII Empresa activa | El listado respeta el selector (FR-008), recarga al cambiar y los diálogos se cierran con aviso; test SC-002. |
| VIII Documentación | `docs/ventas-rma-devoluciones.md`, `docs/permisos-por-rol.md` (si suma una línea), roadmap y `pnpm docs:check` (cierre). |

## Decisiones de diseño

- **Formas y estados como valores fijos**: `check` en la base y catálogo único en el frontend; no son tablas (las tablas nuevas son solo `rma` y `rma_items`).
- **Alta valida contra lo vendido**: `registrar_rma` exige factura confirmada y que la cantidad no exceda lo vendido ni lo aún no devuelto en cada línea (bloqueo de fila del comprobante bajo concurrencia).
- **Estados como máquina lineal**: `abierto → en_gestion → cerrado`; cerrar también lo hace la resolución de F-VTA-30.
- **Resolución reutiliza lo existente**: nota de crédito vía `emitir_nota_credito` (F-VTA-11) y reingreso vía `registrar_movimiento_stock` (MSF-136) con motivo «Devolución» y nota `RMA {número}`; la nota económica y el stock no se reimplementan.
- **Mapeo forma → mecanismo** (*Decisiones abiertas* 6): propuesta a confirmar; vive en las RPC de F-VTA-30, no en la estructura.

## Riesgos y reversión

- **Mapeo forma → mecanismo a confirmar** (*Decisiones abiertas* 6): al ser lógica de RPC, cambiarlo es ajustar la función, no la estructura; no bloquea.
- **Nombres de MSF-159/177/136**: columnas de totales, numeración y `registrar_movimiento_stock` se verifican contra `main` al empezar cada historia; si difieren, se ajusta la tarea y se anota `Desvío:` con commit.
- **UI de resolución fuera del prototipo** (*Decisiones abiertas* 7): la acción de vincular nota / reingresar se agrega como acción del listado/detalle y la diferencia se anota en el PR.
- **`registrar_movimiento_stock` exige `stock` en `edición`**: el reingreso (F-VTA-30) corre con `security definer` y el rol del actor debe poder mover stock; se verifica al implementar y, si el permiso difiere, se ajusta la RPC o se anota `Desvío:`.
- **Reversión**: migraciones aditivas con reversión en el encabezado (drop de `rma_items`, `rma`, funciones y la columna `nota_credito_id`); el PR se revierte entero con `git revert -m 1`.
