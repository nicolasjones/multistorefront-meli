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
| `docs/tiendas-online.md` | modified | la tienda pública documenta la retención y la supresión (MSF-944) junto a la lista de pedido y el presupuesto |

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
- `pnpm calidad:code` → OK (oxlint, knip, jscpd, dependency-cruiser, syncpack; gitleaks saltado
  por falta de Docker).
- `node scripts/verificar-migraciones.mjs --base origin/dokploy` → 754 archivo(s), 1 nuevo(s), sin
  reutilizadas.
- `supabase test db` (pgTAP) → no corre en este entorno (sin acceso al socket de Docker ni CLI de
  Supabase); la evidencia de base es la del CI.

## Verificación en CI

- Job `database` (corrida `44442683123`, commit `b59408ece`): `consultas_retencion.test.sql` **ok**
  (72/72) y el resto de los 410 archivos de la base sin un solo `not ok` (15 171 pruebas).
- Mutantes (FEAT-236): el commit `ccef18a1e` mutó el SQL a propósito (M1 `estado <> 'en_curso'` →
  `estado is not null`; M2 FK de la cola de `on delete cascade` → `on delete set null`; M3 el evento
  de la supresión copia el contacto) y el pgTAP mató los tres: 7 de 72 aserciones cayeron
  (16, 18, 25, 38, 40, 44 y 62). El commit siguiente revierte la mutación. Detalle en `test.md`.

## Deviations from Assessment

- La migración se creó con versión `20270507200101` (por encima del máximo de `origin/dokploy`,
  `20270507200100`) en lugar de `20270507170001`: un renumerado obligatorio por el guard de
  migraciones, hecho con `git mv` y sin tocar el SQL.
- Se agregó el flow de Kestra y su prueba estática (pedido de la revisión), que el assessment
  listaba como «reutilizar los precedentes» pero no como archivo concreto.

## Follow-ups

- Nada que borrar a mano: la primera pasada de la purga limpia las copias de avisos sueltas
  anteriores a esta migración.
- El plazo legal definitivo lo define el negocio (D-21): hoy el valor inicial es 180 días y se
  cambia por `TIENDA_CONSULTAS_RETENCION_DIAS`.
