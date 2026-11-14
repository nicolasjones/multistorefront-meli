# Implementation Plan: Tiendas online · Tienda compra y cuentas

**Branch**: `epic/MSF-176-tiendas-online-tienda-compra-y-cuentas` | **Date**: 2026-10-24 | **Spec**: `specs/20261024-120000-tienda-compra-y-cuentas/spec.md`

**Delivery scope**: a confirmar (previsible `refine` + `supabase`). **Plan parcial: NEEDS_INFO** — no se diseña el modelo ni las RPC hasta responder P1–P5 de la spec.

## Resumen

Agregar a la tienda pública (MSF-167) la compra y el pago en línea (F-TDA-26) y cuentas de clientes con favoritos (F-TDA-27), ambos opcionales para el cliente. La épica es P3, está en Backlog y no trae requisitos; este plan fija solo el marco y qué se decide primero.

## Contexto técnico

- **Frontend**: front público en `apps/web/src/pages/tienda-publica/` (rutas por archivo en `rutas/*.tsx`, resolución por `Host`). Cada historia aportará sus rutas sin tocar archivos comunes.
- **Base**: Postgres self-hosted; esquemas por naturaleza (Principio VII) — cuentas/sesión en `public`, carrito/favoritos/pedidos en `dominio`. **Nada de esto existe aún**: no hay tablas de carrito, favoritos ni pedido en el repo; se crearían con migración aditiva y reversión. No se inventan nombres hasta tener respuestas.
- **Reutilizable**: catálogo y ficha de MSF-167, precios (MSF-114), stock (MSF-231), «Cuentas de cobro» del panel (candidato para P2).
- **Testing**: pgTAP (RLS y grants de `anon`), Vitest + axe, Playwright E2E con las dos tiendas del seed.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Toda tabla nueva con RLS por organización; sin service-role en el navegador; `anon` solo ejecuta funciones de `publico`. |
| II Especificar primero | Spec parcial; no se implementa hasta responder P1–P5. |
| III Idempotencia/auditoría | Pago y pedido deberán ser idempotentes y auditables (se diseña tras P2). |
| IV Despliegues independientes | Sin Compose nuevo. |
| V Simplicidad | Sin infraestructura nueva sin caso de uso. |
| VI Panel operable | Front público: estados del kit, teclado, 320/768/1440 px, carga diferida por ruta. |
| VII Esquemas | Sin tablas en esta versión; cuando existan se declaran y re-verifican por tabla. |
| VIII Empresa activa | No aplica al front público (ver matriz de la spec). |
| Documentación | `docs/tiendas-online.md` en el cierre. |

## Contratos

No se declara `contracts/` todavía: no hay RPC/endpoints definidos. Se agrega `contracts/tienda-compra-y-cuentas.md` (firma de cada RPC, y `BREAKING:` si cambia algo existente) al responder las preguntas.

## Historias

| Historia | Talla | Migración propia | Notas |
|---|---|---|---|
| F-TDA-26 | XL | Sí (aditiva, con reversión), a definir | Posible partición en specs de carrito/pagos/envíos/facturación/pedidos (P1). |
| F-TDA-27 | L | Sí (aditiva, con reversión), a definir | Acotar a favoritos e historial si se confirma P3. |

Cada historia trae su propia migración con su timestamp; no se encadenan entre sí.
