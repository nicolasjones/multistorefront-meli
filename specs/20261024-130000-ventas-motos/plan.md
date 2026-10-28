# Implementation Plan: Ventas y despacho · Ventas motos

**Branch**: `epic/MSF-145-ventas-y-despacho-ventas-motos` | **Spec**: [spec.md](./spec.md) | **Contratos**: [contracts/ventas-motos.md](./contracts/ventas-motos.md)

> **HOLD**: la implementación no arranca hasta la Etapa 2 (2027-01-04) ni sin cupo; MSF-145 vuelve a Backlog (AGE-1773); al liberar, MSF-159 debe estar en `main` (no basta Review In DEV) y haber cupo. Ver *Estado de entrega* en [spec.md](./spec.md). El diseño de abajo no cambia.

## Summary

Registro de envíos con mensajería propia (guía, costo, abono, enviado) y su rendición (por fila y en lote con total), en la pestaña **Motos** de `/ventas/transportes`, más la tarjeta «Motos sin rendir». Una tabla nueva `dominio.envios_moto` colgada de `dominio.comprobantes_venta`, escrita solo por RPC.

## Technical Context

- **Stack**: Refine + MUI en `apps/web`, Supabase self-hosted (migración + RPC + pgTAP). Sin Kestra, Superset ni workers.
- **Base verificada**: `dominio.comprobantes_venta` (con `envio_id`, `empresa_id`, `estado`), `dominio.formas_envio.tipo` (incluye `moto`), `private.registrar_actividad`, página `apps/web/src/pages/ventas/transportes/list.tsx` (Terminales), `FiltroEmpresa`, ruta `/ventas/transportes` y menú «Transportes». `envios_moto` no existe en el grafo ni en migraciones: se crea.
- **Pruebas**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web`), `pnpm lint`, `pnpm build`, `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check`.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización; escritura solo por RPC; `anon` sin acceso. |
| II Spec primero | Spec con FR/SC, flujos y matriz. |
| III Idempotencia/auditoría | Rendir idempotente y reversible; eventos en `registro_actividad`; bloqueo optimista. |
| IV Despliegues | Solo `refine` y `supabase`. |
| V Simplicidad | Una tabla, sin infraestructura nueva. |
| VI Panel operable | Misma ruta y entrada de menú; pestaña con `?pestana=motos`; estados del kit; 320/768/1440 px; sin ids técnicos visibles. |
| VII Esquemas | `dominio.envios_moto` (negocio de ventas). Re-verificar en tareas, implementación y PR. |
| VIII Empresa activa | FR-007 y FR-025; fila en la matriz; tests SC-004 y SC-006. |

## Project Structure

- `supabase/migrations/20261205100100_envios_moto.sql` (tabla + RLS), `…100200_envios_moto_rpc.sql` (registro, edición, listado, elegibles), `…200100_rendir_envios_moto.sql` (rendición y resumen).
- `supabase/tests/database/ventas_motos_registro.test.sql`, `ventas_motos_rendicion.test.sql`.
- `apps/web/src/lib/ventas/enviosMoto.ts` (tipos y llamadas), `apps/web/src/pages/ventas/transportes/` (control segmentado y pestaña Motos), `apps/web/src/components/ventas/EnvioMotoDialog.tsx` y `RendicionMotosDialog.tsx`.
- `docs/ventas-motos.md`.

## Orden

F-VTA-24 (tabla, registro y listado) primero; F-VTA-25 (rendición y tarjeta) después porque comparte tabla y página. Cierre al final.
