# Bug Fix: Retención y supresión de consultas, ítems y presupuestos de la tienda (MSF-944)

- **Slug**: msf-944
- **Fixed**: 2026-11-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se construyó la capacidad que faltaba (D-20 de la épica MSF-176): una purga por retención de las
consultas de la tienda, sus ítems y las copias de sus avisos, el vaciado de la nota de los
presupuestos vencidos y una supresión a pedido del titular. La purga la dispara un flow diario de
Kestra con plazo por entorno; la supresión es un procedimiento del equipo técnico. Todo es aditivo y
el comprobante fiscal no se toca.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270507200101_retencion_y_supresion_consultas_tienda.sql` | added | renombrada con `git mv` a `20270507200101` (la base de `origin/dokploy` llega a `20270507200100`): `public.avisos_pendientes.consulta_id` + FK en cascada, `suprimido_en` en consultas y presupuestos, `private.purgar_consultas_tienda(integer)`, `private.suprimir_titular_tienda(uuid, text)`, `private.coincide_contacto(text, text)` y `ConsultaId` fuera del payload del aviso |
| `supabase/tests/database/consultas_retencion.test.sql` | added | pgTAP `plan(72)`: purga por plazo sin tocar «En curso», borrado de ítems y avisos, presupuestos vencidos sin tocar el comprobante, supresión que anonimiza y limpia la cola, aislamiento por organización, `42501` para `authenticated`, idempotencia |
| `supabase/tests/database/tienda_presupuesto_cliente.test.sql` | modified | la comparación de la fila del vínculo excluye `suprimido_en` (columna nueva) |
| `infra/kestra/flows/purgar-consultas-tienda.yml` | added | flow `purgar-consultas-tienda` (namespace `producto.ventas`, cron `45 4 * * *`, rol `kestra_orquestacion`, tarea con `timeout: PT10M`), llama a `private.purgar_consultas_tienda`; un fallo avisa por `aviso-fallo-api` y no se traga el error |
| `apps/web/src/lib/actividad.ts` | modified | etiqueta del tipo nuevo `tienda.titular_suprimido` en la actividad |
| `infra/kestra/validar-purgar-consultas-tienda.test.mjs` | added | contrato estático: Schedule, función y rol, subflow de error, variable en Compose y `.env.example` |
| `infra/kestra/compose.yaml` | modified | `ENV_TIENDA_CONSULTAS_RETENCION_DIAS` (180 por defecto) para Kestra |
| `infra/kestra/.env.example` | modified | `TIENDA_CONSULTAS_RETENCION_DIAS=180` |
| `package.json` | modified | `test:kestra:purgar-consultas-tienda` y entrada en la cadena `test` |
| `specs/20270507170000-retencion-y-supresion-consultas-tienda/spec.md` | modified | DER completo del grafo afectado (leyenda + `erDiagram`, `pnpm der:check` OK) |
| `specs/20270507170000-retencion-y-supresion-consultas-tienda/plan.md` | modified | referencia al nombre nuevo de la migración |
| `docs/consultas.md` | modified | sección de retención con purga y supresión, sin «seguimiento trazado» |
| `docs/producto/consultas.md` | modified | el manual ya no dice que los pedidos no se borran solos |
| `docs/tienda-compra-y-cuentas.md` | modified | retención, I-5 y seguimientos alineados con lo hecho |
| `docs/seguridad-tienda-compra-y-cuentas.md` | modified | MSF-944 pasa a «hecho» |

## Tests Added or Updated

- `supabase/tests/database/consultas_retencion.test.sql` — purga/supresión/permisos/idempotencia.
- `supabase/tests/database/tienda_presupuesto_cliente.test.sql` — la comparación excluye `suprimido_en`.
- `infra/kestra/validar-purgar-consultas-tienda.test.mjs` — flow y variable de entorno.

## Local Verification

- `pnpm lint` → OK (solo warnings preexistentes de React en pantallas).
- `pnpm build` → OK.
- `pnpm docs:check` → OK (incluye `verificar-migraciones` contra `origin/dokploy`: 1 migración nueva).
- `pnpm der:check` → OK.
- `pnpm test:kestra:purgar-consultas-tienda` → 4/4.
- `supabase test db` (pgTAP) → no corre en este entorno (sin acceso al socket de Docker ni CLI de Supabase); queda para el CI, job `database`.

## Deviations from Assessment

- La migración se creó con versión `20270507200101` (por encima del máximo de `origin/dokploy`,
  `20270507200100`) en lugar de `20270507170001`: un renumerado obligatorio por el guard de
  migraciones, hecho con `git mv` y sin tocar el SQL.
- Se agregó el flow de Kestra y su prueba estática (pedido de la revisión), que el assessment
  listaba como «reutilizar los precedentes» pero no como archivo concreto.

## Follow-ups

- Ejecutar `supabase test db` en CI; si el job `database` falla, ajustar el pgTAP nuevo.
- Nada que borrar a mano: la primera pasada de la purga limpia las copias de avisos sueltas
  anteriores a esta migración.
