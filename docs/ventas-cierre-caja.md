# Ventas · Cierre de caja diario (F-VTA-33, MSF-349)

Épica MSF-193 · spec `specs/20261027-100000-ventas-mejoras` (FR-020…FR-026, SC-003, CA-VTA-33-1).

## Qué hace

Un Administrador cierra la caja de una tienda para un día: se resumen los cobros de
`dominio.cobros_comprobante` (por `registrado_en::date`) **por forma de pago y cuenta de cobro**, y a
partir de ahí no se puede registrar ni modificar ningún cobro de ese día hasta **reabrir** la caja.

## Piezas

| Pieza | Dónde | Esquema |
|---|---|---|
| Tablas `cierres_caja` y `cierres_caja_detalle` (RLS por organización + empresa accesible + sección `ventas`; sin escritura directa; `anon` sin privilegios) | `20270115100000_cierres_caja.sql` | `dominio` (regla de negocio del producto) |
| RPC `cerrar_caja`, `reabrir_caja` (Administrador), `listar_cierres_caja` (lectura `ventas`), `private.caja_cerrada`, `private.candado_caja` | `20270115100100_cierres_caja_rpc.sql` | `public` (RPC de la app) / `private` (helpers) |
| Disparador `cobros_comprobante_caja_cerrada` (errcode `55000`) | `20270115100200_bloqueo_cobros_cerrados.sql` | sobre `dominio.cobros_comprobante` (MSF-195, sin alterar columnas ni políticas) |
| Pantalla `/ventas/cierre-caja` (menú Ventas → «Cierre de caja») | `apps/web/src/pages/ventas/cierre-caja.tsx`, `lib/cierreCaja.ts`, `components/ventas/CerrarCajaDialog.tsx` | — |

## Reglas

- Un cierre por (organización, empresa, fecha). Estados: `cerrada` → `reabierta` → `cerrada` (reutiliza
  la fila y rehace el detalle). «Abierta» es la ausencia de cierre.
- `cerrar_caja` y `reabrir_caja` son idempotentes; no se cierra un día futuro.
- El bloqueo vale para toda escritura sobre los cobros (incluida `registrar_cobro` y la conciliación).
  Cerrar y cobrar toman el mismo candado transaccional (`pg_advisory_xact_lock`), así un cobro no se
  cuela entre el resumen y el cierre.
- Eventos `caja.cerrada` / `caja.reabierta` en el historial de actividad, en la misma transacción.
- El «día» de un cobro y el «hoy» (límite de día futuro) se calculan en la zona horaria de la
  organización (`organizaciones.zona_horaria`, F-ORG-03) con `private.dia_caja` / `private.hoy_caja`;
  resumen, disparador y validación usan el mismo helper, no la zona de la sesión de la base.
  «Cerrar caja» de la pantalla cierra el día de hoy en la zona de la organización.
- Principio VIII: la pantalla sigue la empresa activa; al cambiarla recarga, vuelve a la página 1 y
  descarta el diálogo abierto. «Cerrar caja» exige una empresa activa concreta.

## Reversión

Migraciones aditivas; el encabezado de cada una trae el `drop` (primero el disparador, después las
funciones y las tablas). Exportar antes los cierres si ya hay datos.

## Pruebas

pgTAP `supabase/tests/database/ventas_cierre_caja.test.sql` (`pnpm test:db`), Vitest
`apps/web/src/pages/ventas/cierre-caja.test.tsx`, E2E `apps/web/e2e/ventas-cierre-caja.e2e.ts`
(`[MSF-349:T021] [F-VTA-33#1]`).
