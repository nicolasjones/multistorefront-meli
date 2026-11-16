# Bug Fix: etiquetas de evento legibles e importes con formato de moneda

- **Slug**: msf-618
- **Fixed**: 2026-11-16
- **Assessment**: el reporte del tracker (MSF-618, épica MSF-585) — no hay `assessment.md` en esta historia: el
  ticket ya traía el diagnóstico y la devolución del Revisor del PR #638.
- **Status**: applied

## Summary

La columna **Tipo** de Actividad (y el filtro por tipo) muestran el nombre interno de cada evento («Categoria creada»,
«Cuenta_cobro creada», «Stock salida»). Ahora cada tipo que emite la base tiene una etiqueta con tildes, y los importes
del detalle salen con su moneda y separadores («Cobro de $ 859.100,00»).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/lib/actividad.ts` | modified | `ETIQUETA_TIPO_ACTIVIDAD` pasa de 78 a 187 etiquetas (todos los tipos que emiten las migraciones y el frontend) y `formatearDetalleActividad` formatea los importes con la moneda que trae el texto. |
| `apps/web/src/lib/actividad.test.ts` | modified | Etiquetas con tildes (incluidos los tipos que antes caían en el respaldo) e importes con formato de moneda. |
| `apps/web/src/lib/actividad.tipos.test.ts` | added | Recorre las migraciones, arma la lista de tipos que se registran y falla si un tipo no tiene etiqueta, si sobra una o si conserva el formato interno. |
| `apps/web/src/pages/actividad/list.tsx` | modified | La columna **Detalle** (y el `aria-label` del botón «Ver detalle») usa el detalle formateado. |
| `apps/web/src/components/actividad/DetalleActividadDialog.tsx` | modified | El diálogo muestra el detalle formateado. |
| `apps/web/src/lib/exportarActividad.ts` | modified | El CSV usa el mismo texto que la tabla (FR-012): también el detalle con los importes formateados. |
| `apps/web/src/lib/exportarActividadCsv.test.ts` | modified | El CSV sale con los importes en formato de moneda. |
| `supabase/migrations/20270419000201_cobro_actividad_con_moneda.sql` | added | `private.registrar_cobro_interno` escribe la moneda del importe en el detalle del evento («Cobro de ARS 859100 por …»). |
| `supabase/tests/database/cobros_comprobante.test.sql` | modified | El detalle del evento lleva la moneda; se cubre el caso de una cuenta de cobro en dólares. |
| `supabase/seed.sql` | modified | El camino de reserva del seed escribe el detalle con la misma moneda que la función. |
| `infra/runner/restaurar-bin.mjs` | modified | El respaldo «más nuevo» se elige comparando la versión por número, no por texto. |
| `infra/runner/restaurar-bin.test.mjs` | modified | Caso «2.10.0» vs «2.9.0». |
| `docs/actividad.md`, `docs/producto/actividad.md` | modified | Etiquetas, importes y de dónde sale la moneda. |

## Tests Added or Updated

- `apps/web/src/lib/actividad.tipos.test.ts::todo tipo emitido tiene etiqueta propia` — si una migración agrega un tipo
  y nadie lo etiqueta, el test falla (es el hallazgo principal de la devolución).
- `apps/web/src/lib/actividad.tipos.test.ts::el mapa no trae etiquetas de tipos que nadie emite` — no quedan etiquetas
  huérfanas.
- `apps/web/src/lib/actividad.tipos.test.ts::ninguna etiqueta muestra el formato interno` — ninguna etiqueta conserva el
  guion bajo del nombre interno.
- `apps/web/src/lib/actividad.test.ts::los tipos que antes caían en el respaldo salen con tildes y sin guion bajo`.
- `apps/web/src/lib/actividad.test.ts::importes del detalle con formato de moneda` — pesos, dólares, coma decimal,
  importes que ya vienen formateados y números que no son importes.
- `apps/web/src/lib/exportarActividadCsv.test.ts::el detalle sale con los importes en formato de moneda, como en la tabla`.
- `supabase/tests/database/cobros_comprobante.test.sql` — el detalle del evento lleva la moneda del importe; una cuenta
  de cobro en dólares no cambia la unidad del importe (que descuenta el saldo del comprobante, en pesos).
- `infra/runner/restaurar-bin.test.mjs::la versión del respaldo se compara por número, no por texto`.

## Local Verification

- `pnpm --filter @platform/web exec vitest run src/lib/actividad.test.ts src/lib/actividad.tipos.test.ts src/lib/exportarActividadCsv.test.ts src/higieneReferenciasInternas.test.ts` → 4 archivos, 78 tests en verde.
- `node --test infra/runner/restaurar-bin.test.mjs` → 6 tests en verde.
- `pnpm lint`, `pnpm build` y `pnpm docs:check` → en verde (ver el informe de la corrida).
- El pgTAP (`pnpm test:db`) **no se corrió localmente**: este entorno no tiene Docker. Corre en el CI.

## Deviations from Assessment

- La devolución pedía, para el detalle del cobro, «la moneda en el texto» o «un seguimiento con clave». Se hizo lo
  primero: el evento ahora escribe la moneda del importe y la pantalla la muestra, en vez de suponerla.
- **La moneda es la del importe (la del comprobante), no la de la cuenta de cobro.** La cuenta dice dónde entra el
  dinero, no en qué unidad se cobra: el importe descuenta el saldo del comprobante (que no tiene columna de moneda y es
  en pesos, F-PRE-03) y el diálogo «Registrar cobro» propone el importe con ese saldo. Etiquetar con la moneda de la
  cuenta haría que el detalle mintiera, que es justo lo que la devolución señalaba. Hoy la moneda es ARS y queda
  escrita en un solo lugar (la función que arma el detalle) para que el día que el comprobante tenga moneda se lea de
  ahí.

## Follow-ups

- **MSF-985** (Tarea, `Ready For Spec`, dueño nicolas.jones): decidir si las filas «Cambio de empresa activa» siguen
  registrándose. Es un cambio de comportamiento (el evento lo escriben `public.cambiar_empresa_activa` y
  `public.empresa_activa_todas` y lo verifican sus pgTAP), no de formato: por eso no entra en este arreglo. Hasta que se
  decida, la etiqueta del evento sale legible («Cambio de empresa activa»).
- **MSF-604**: la descripción de la pantalla («Historial básico: …») ya no describe todo lo que muestra la lista.
