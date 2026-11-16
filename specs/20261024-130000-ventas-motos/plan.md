# Implementation Plan: Ventas y despacho · Ventas motos

**Branch**: `epic/MSF-145-ventas-y-despacho-ventas-motos` | **Spec**: [spec.md](./spec.md) | **Contratos**: [contracts/ventas-motos.md](./contracts/ventas-motos.md)

> **Implementada** (PR #825, MSF-145; levantó el HOLD de la Etapa 2 un pedido expreso de Nicolás). El diseño de abajo es el que se construyó, con las diferencias listadas en *Diferencias con la spec* del PR y en `docs/ventas-motos.md`.

## Summary

Registro de envíos con mensajería propia (mensajero, guía opcional, costo, abono, enviado) y su rendición por fila y en lote con total, en la pestaña **Motos** de `/ventas/transportes`, más la tarjeta «Motos sin rendir». Una tabla nueva `dominio.envios_moto` colgada de `dominio.comprobantes_venta`, escrita solo por RPC, con `rendido`/`rendido_en` escritos únicamente por la RPC de rendición y sin reversión.

## Technical Context

- **Stack**: Refine + MUI en `apps/web`, Supabase self-hosted (migraciones + RPC + pgTAP). Sin Kestra, Superset ni workers.
- **Base verificada**: `dominio.comprobantes_venta` (con `envio_id`, `empresa_id`, `estado`, `tipo`), `dominio.formas_envio.tipo` (incluye `moto`), `private.registrar_actividad`, `private.nivel_ventas_en_empresa`, `private.rol_en_empresa`, `private.es_administrador_de`, página `apps/web/src/pages/ventas/transportes/list.tsx` (Terminales), `FiltroEmpresa`, ruta `/ventas/transportes` y menú «Transportes». `envios_moto` no existe en el grafo ni en migraciones: se crea.
- **Permisos**: lectura con `ventas` en `lectura`/`edicion`; registro/edición con `edicion` y rol efectivo `operador`/`administrador`; rendición solo `administrador` (o superadmin). `rendido`/`rendido_en` solo por `rendir_envios_moto`.
- **Pruebas**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web`), `pnpm lint`, `pnpm build`, `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm ui:empresas:check`, `pnpm docs:check`.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización; escritura solo por RPC; `anon` sin acceso; pgTAP de aislamiento de `envios_moto`. |
| II Spec primero | Spec con FR/SC, flujos, decisiones de producto y matriz pantalla↔criterios. |
| III Idempotencia/auditoría | Rendir idempotente; eventos en `registro_actividad`; bloqueo optimista; sin efectos duplicados. |
| IV Despliegues | Solo `refine` y `supabase`. |
| V Simplicidad | Una tabla, sin infraestructura nueva ni tabla de mensajeros. |
| VI Panel operable | Misma ruta y entrada de menú; pestaña con `?pestana=motos`; estados del kit; 320/768/1440 px; sin ids técnicos visibles. |
| VII Esquemas | `dominio.envios_moto` (negocio de ventas). Re-verificar en tareas, implementación y PR. |
| VIII Empresa activa | FR-007 y FR-025; fila en la matriz; tests SC-004 y SC-006. |

## Project Structure

- `supabase/migrations/20270222200100_envios_moto.sql` (tabla, índice por mensajero y RLS), `supabase/migrations/20270222200200_envios_moto_rpc.sql` (registro, edición, elegibles, listado), `supabase/migrations/20270222300100_rendir_envios_moto.sql` (rendición y resumen), `20270222300200_exportacion_total_envios_moto.sql` (la tabla entra en la exportación total) y `20270223100000_envios_moto_lectura_por_empresa.sql` (RLS de lectura por tienda y `puedo_registrar_envios_moto`).
- `supabase/tests/database/ventas_motos_registro.test.sql`, `ventas_motos_rendicion.test.sql`.
- `apps/web/src/lib/ventas/enviosMoto.ts` (tipos y llamadas), `apps/web/src/pages/ventas/transportes/` (control segmentado y pestaña Motos), `apps/web/src/components/ventas/EnvioMotoDialog.tsx` y `RendicionMotosDialog.tsx`.
- `docs/ventas-motos.md` (cierre).

## Orden

F-VTA-24 (tabla, registro y listado) primero; F-VTA-25 (rendición y tarjeta) después porque comparte tabla y página. Cierre al final.
