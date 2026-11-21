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
| `specs/20270507170000-retencion-y-supresion-consultas-tienda/spec.md` | modified | DER completo del grafo afectado (leyenda + `erDiagram`; el DER de la spec da OK) |
| `specs/20270507170000-retencion-y-supresion-consultas-tienda/plan.md` | modified | referencia al nombre nuevo de la migración |
| `docs/consultas.md` | modified | sección de retención con purga y supresión, sin «seguimiento trazado» |
| `docs/producto/consultas.md` | modified | el manual ya no dice que los pedidos no se borran solos |
| `docs/tienda-compra-y-cuentas.md` | modified | retención, I-5 y seguimientos alineados con lo hecho |
| `docs/seguridad-tienda-compra-y-cuentas.md` | modified | MSF-944 pasa a «hecho» |
| `docs/tiendas-online.md` | modified | la tienda pública documenta la retención y la supresión (MSF-944) junto a la lista de pedido y el presupuesto |
| `supabase/migrations/20270507200101_retencion_y_supresion_consultas_tienda.sql` | modified (2ª vuelta) | la supresión filtra la cola de avisos **por organización**: antes, la rama de «copia suelta» (aviso sin consulta atada) alcanzaba avisos de otra organización con el mismo contacto y los borraba o les sacaba las claves personales (FR-015, Principio I) |
| `supabase/tests/database/consultas_retencion.test.sql` | modified (2ª vuelta) | `plan(79)`: avisos de la organización dos con el mismo contacto de la titular (no se borran ni pierden datos) y la regla D-25 vigilada sobre la **emisión real** (`private.emitir_aviso_consulta`), no sobre filas insertadas a mano |
| `docs/tecnico/consultas.md` | modified (2ª vuelta) | §Retención con la política de MSF-944 (purga y supresión), §Verificación con el pgTAP nuevo y el flow, y §Reversión con la migración de la historia |
| `docs/consultas.md` | modified (2ª vuelta) | «Riesgos aceptados» (3) ya no dice que los datos personales no tienen política de retención |
| `specs/20270507170000-retencion-y-supresion-consultas-tienda/spec.md` | modified (2ª vuelta) | alcance de entrega: `refine` (la etiqueta del evento nuevo en la actividad del panel) |
| `specs/20270507170000-retencion-y-supresion-consultas-tienda/plan.md` | modified (2ª vuelta) | lo mismo: el alcance ya no dice «Sin `refine`» |
| `specs/20270507170000-retencion-y-supresion-consultas-tienda/tasks/MSF-944.md` | added (2ª vuelta) | marcas `[x]` de T001 a T009 (las de `tasks.md` las escribe el runner: es la spec compartida de la épica) |

## Tests Added or Updated

- `supabase/tests/database/consultas_retencion.test.sql` — purga/supresión/permisos/idempotencia.
- `supabase/tests/database/tienda_presupuesto_cliente.test.sql` — la comparación excluye `suprimido_en`.
- `infra/kestra/validar-purgar-consultas-tienda.test.mjs` — flow y variable de entorno.

## Segunda vuelta (revisión de QA y de seguridad del PR #1132)

La revisión pidió cinco correcciones sobre lo entregado. Todas están en este commit:

1. **Aislamiento de la cola de avisos en la supresión** (`supabase/migrations/20270507200101…sql`):
   las dos sentencias que limpian `public.avisos_pendientes` ahora filtran por
   `a.organizacion_id = p_organizacion`. Antes, la rama de «copia suelta» (aviso sin consulta atada,
   reconocido por el contacto del payload) alcanzaba los avisos de otra organización: una persona que
   es cliente de dos organizaciones veía cómo la supresión de una borraba los avisos `pendiente`/
   `fallido` de la otra y le sacaba `Nombre`, `Contacto` y `Mensaje` a los `enviado`. Contradecía
   FR-015 («nunca toca datos de otra») y el aislamiento multi-tenant.
2. **La regla D-25/FR-005 vigilada de verdad**: el pgTAP ahora llama a `private.emitir_aviso_consulta`
   y comprueba sobre el aviso **realmente emitido** que queda atado a su consulta y que la clave
   interna `ConsultaId` no viaja en el payload del correo; además comprueba que los avisos de otros
   tipos no quedan atados. Antes la regla solo se miraba sobre filas insertadas a mano.
3. **Las marcas de las tareas**: `specs/…/tasks/MSF-944.md` con T001 a T009 en `[x]` y su evidencia.
   `tasks.md` no lleva las marcas (es la spec compartida de la épica: sus marcas las escribe el runner).
4. **`docs/tecnico/consultas.md`**: su §Retención seguía diciendo que no hay política definida y que no
   se borra ni expira nada, y su §Verificación no listaba el pgTAP nuevo ni el flow.
5. **`docs/consultas.md`**: «Riesgos aceptados» (3) seguía diciendo que los datos personales del
   visitante no tienen política de retención, en el mismo archivo que ya la tiene.

## Tercera vuelta (devolución del Revisor del PR #1132, SHA `578048c5a9`)

La devolución pidió tres correcciones, las tres sobre la documentación (el código de la capacidad no
cambia): sincronizar el `tasks.md` de la spec con el `spec.md` y el `plan.md`, y no afirmar como «en
verde» unos guards que no lo están. Las tres están en este commit:

1. **Alcance de entrega desincronizado** (`specs/…/tasks.md`): el encabezado seguía declarando
   `supabase`, `kestra` mientras `spec.md` y `plan.md` ya declaran `supabase`, `kestra`, `refine` (la
   etiqueta del evento nuevo en la actividad del panel). Los tres archivos ahora declaran lo mismo.
2. **T001 nombraba una migración que no existe** (`specs/…/tasks.md`): seguía diciendo
   `supabase/migrations/20270507170001_retencion_y_supresion_consultas_tienda.sql`; el archivo real es
   `20270507200101_retencion_y_supresion_consultas_tienda.sql` (el renumerado con `git mv` del commit
   `f7b4ce978`). La tarea cita ahora el archivo que existe.
3. **Evidencia que no era cierta**: `pnpm der:check` y `pnpm calidad:code` se daban por «en verde».
   Medidos en este commit: `pnpm der:check` (que revisa el repo entero) sale con **1** por 141 specs sin
   DER válido, y ninguna es de MSF-944 —las 141 están igual en `origin/dokploy`—; el DER de esta spec
   da `DER OK (1 spec/s)` con el comando acotado a la spec. `pnpm calidad:code` sale con **0** con las
   dependencias del workspace instaladas; sin ellas, knip no resuelve `@playwright/test` y reporta como
   exports sin uso los de `apps/web/e2e/soporte/fixtures.ts` (exit 1): es un artefacto del entorno,
   porque esta historia no toca `apps/web/e2e/` ni `knip.json` (solo agrega una etiqueta en
   `apps/web/src/lib/actividad.ts`). Los archivos de la spec y del informe (`tasks.md`,
   `tasks/MSF-944.md`, `fix.md`, `test.md`) dicen ahora exactamente qué comando se corrió y qué salió.

## Local Verification

- `pnpm lint` → OK (solo warnings preexistentes de React en pantallas).
- `pnpm build` → OK.
- `pnpm docs:check` → OK (`Documentación de cambios: OK`, `Migraciones OK: 772 archivo(s), 1 nuevo(s)`
  y `Trampas conocidas: OK (1 migración(es), 2 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy)`).
- `node scripts/verificar-der.mjs specs/20270507170000-retencion-y-supresion-consultas-tienda/spec.md`
  → `DER OK (1 spec/s)`. El `pnpm der:check` **sin argumentos** revisa todo el repo y sale con **1**:
  `141 spec(s) sin DER válido`, y ninguna es de MSF-944 (las 141 existen igual en `origin/dokploy`: es
  una condición previa del repo, no de esta historia).
- `pnpm test:kestra:purgar-consultas-tienda` → 4/4.
- `pnpm calidad:code` → **exit 0** con las dependencias del workspace instaladas (oxlint, knip, jscpd,
  dependency-cruiser, syncpack; gitleaks saltado por falta de Docker). Sin esas dependencias, knip no
  resuelve `@playwright/test` y reporta como exports sin uso los de `apps/web/e2e/soporte/fixtures.ts`
  (exit 1): es un artefacto del entorno —esta historia no toca `apps/web/e2e/` ni `knip.json`, solo
  agrega una etiqueta en `apps/web/src/lib/actividad.ts`—, y con las dependencias instaladas el mismo
  comando da verde. Lo confirma el job `quality` del CI de este SHA: corre `pnpm calidad` (con
  gitleaks) y da verde.
- `node scripts/verificar-migraciones.mjs --base origin/dokploy` → 772 archivo(s), 1 nuevo(s), sin
  reutilizadas.
- `supabase test db` (pgTAP) → no corre en este entorno (sin acceso al socket de Docker ni CLI de
  Supabase); la evidencia de base es la del CI.

## Verificación en CI

- Job `database` (corrida `44674523588`, commit `98eaa75bd`): `consultas_retencion.test.sql` **ok**
  (79/79) y el resto de los 410 archivos de la base sin un solo `not ok` (15 178 pruebas).
- Mutantes (FEAT-236): el commit `ccef18a1e` mutó el SQL a propósito (M1 `estado <> 'en_curso'` →
  `estado is not null`; M2 FK de la cola de `on delete cascade` → `on delete set null`; M3 el evento
  de la supresión copia el contacto) y el pgTAP mató los tres: 7 de 72 aserciones cayeron
  (16, 18, 25, 38, 40, 44 y 62). El commit siguiente revierte la mutación. Detalle en `test.md`.
- Segunda vuelta: los mutantes M4 a M7 (el filtro por organización de la cola y la clave interna
  `ConsultaId`) los matan las aserciones nuevas, una por regla; la tabla está en `test.md`.

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
- **Deuda del repo, no de MSF-944**: el `pnpm der:check` de todo el repo sale con 1 por 141 specs sin
  DER válido (las 141 existen igual en `origin/dokploy`; esta historia no las toca y la spec de MSF-944
  sí tiene DER y pasa). Corregirlo es una historia de higiene de specs aparte, no de esta.
