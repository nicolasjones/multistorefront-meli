# Tasks: Retención y supresión de consultas, ítems y presupuestos de la tienda (MSF-944)

**Input**: `specs/20270507170000-retencion-y-supresion-consultas-tienda/` (spec.md, plan.md)

**Alcance de entrega**: `supabase`, `kestra`

**Origen**: seguimiento de MSF-176 (T063 y T072; decisión D-20 de esa épica). Assessment de bug:
`.specify/bugs/msf-944/assessment.md`.

## Fase 1 — Base de datos

- [ ] T001 Migración `supabase/migrations/20270507170001_retencion_y_supresion_consultas_tienda.sql`
  (aditiva, con reversión documentada en el encabezado):
  `dominio.consultas.suprimido_en` y `dominio.presupuestos_tienda.suprimido_en` (nullable);
  `public.avisos_pendientes.consulta_id` (FK a `dominio.consultas (id) on delete cascade`) e índices
  de apoyo. — **Evidencia**: la migración aplica y `pnpm der:check` da OK.
- [ ] T002 [P] `private.emitir_aviso(text, uuid, jsonb, uuid)` (misma firma): lee la clave interna
  `ConsultaId` del payload, la valida con regex, la guarda en `avisos_pendientes.consulta_id` y la
  saca del payload (el correo no cambia); `private.emitir_aviso_consulta(uuid)` suma la clave.
  — **Evidencia**: pgTAP: el aviso de una consulta lleva `consulta_id` y el payload **no** trae la
  clave; los avisos de otros tipos no se ven afectados.
- [ ] T003 `private.purgar_consultas_tienda(p_retencion_dias integer default 180)`: valida el plazo
  (`22023`), exige el rol de orquestación (`42501`), borra las consultas `estado <> 'en_curso'` que
  superaron el plazo (ítems y avisos en cascada), vacía la `nota` de los presupuestos viejos sin
  tocar el comprobante, deja el evento `sistema.depurada` por organización y es idempotente.
  — **Evidencia**: pgTAP de la política de purga.
- [ ] T004 `private.suprimir_titular_tienda(p_organizacion uuid, p_contacto text)`: exige rol
  técnico (`42501`), anonimiza las consultas del titular y borra sus ítems, vacía la nota de sus
  presupuestos, limpia la cola de avisos, deja el evento `tienda.titular_suprimido` (nuevo tipo)
  y no toca el comprobante fiscal. — **Evidencia**: pgTAP de la supresión.
- [ ] T005 pgTAP `supabase/tests/database/consultas_retencion.test.sql`: privilegios, política de
  purga, cascadas, idempotencia, plazo inválido, supresión, aislamiento por organización, `42501` y
  evento sin datos personales. Con **mutantes** que comprueban que los tests vigilan cada regla.
  — **Evidencia**: pgTAP verde.

## Fase 2 — Orquestación

- [ ] T006 Flow `infra/kestra/flows/purgar-consultas-tienda.yml` (cron diario, rol
  `kestra_orquestacion`, `TIENDA_CONSULTAS_RETENCION_DIAS` con 180 por defecto, subflow de aviso de
  fallo), la variable en `infra/kestra/.env.example` y en `infra/kestra/compose.yaml`, y su
  contrato estático `infra/kestra/validar-purgar-consultas-tienda.test.mjs` en `pnpm test`.
  — **Evidencia**: `pnpm test:kestra:purgar-consultas-tienda` en verde.

## Fase 3 — Documentación

- [ ] T007 Docs: `docs/consultas.md` (la política de retención, el plazo, qué se guarda, quién lo ve
  y el procedimiento de supresión paso a paso), `docs/tienda-compra-y-cuentas.md` (I-5),
  `docs/seguridad-tienda-compra-y-cuentas.md` (MSF-944 deja de ser seguimiento abierto),
  `docs/producto/consultas.md` (el manual deja de decir «no se borran solos») y
  `docs/tiendas-online.md`. — **Evidencia**: `pnpm docs:check` en OK.
- [ ] T008 Informe de bug: `.specify/bugs/msf-944/fix.md` (qué se cambió) y
  `.specify/bugs/msf-944/test.md` (verificación). — **Evidencia**: los dos archivos existen.

## Fase 4 — Cierre

- [ ] T009 Guards: `pnpm lint`, `pnpm build`, `pnpm test:kestra:purgar-consultas-tienda`,
  `pnpm der:check`, `pnpm docs:check`, `node scripts/verificar-migraciones.mjs --base origin/dokploy`
  y el pgTAP nuevo. — **Evidencia**: la salida de cada comando en el PR.

> Notas de desvío que se agreguen acá van cortas, con `ver commit <hash>` (CLAUDE.md).
