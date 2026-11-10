# Tasks: Clientes y proveedores · Cuenta corriente y saldo del cliente

**Input**: `specs/20261109-100000-cuenta-corriente-y-saldo-cliente/` (spec.md, plan.md). Sin
`contracts/` (la RPC nueva no cambia contratos existentes).

**Formato**: `- [ ] T### [F-CLI-19][US1] descripción`. Sin `[P]`: las tareas van en orden.

**Delivery scope**: `refine`, `supabase`.

**Épica**: MSF-450. Su tarea de épica para esta historia es **T001** («cuando pase a un hito:
redactar requisitos, pantalla (saldo en la ficha de `ClienteFicha`) y matriz de la cuenta
corriente»): esta spec y estas tareas son esa redacción, y las tareas de acá la implementan.

## Fase 1 — Base de datos

- [ ] T001 [F-CLI-19][US1] Migración aditiva `20270221100000_cuenta_corriente_cliente.sql` con `public.cuenta_corriente_cliente(p_cliente_id uuid)`: saldo total, cantidad de comprobantes y las filas de los comprobantes con saldo (total, cobrado, saldo); `security definer`, `search_path = ''`, organización de la sesión, sección `clientes`, `revoke`/`grant` correctos y reversión documentada en el encabezado. **FR-001, FR-002, FR-003, FR-004, FR-008** — Verificación: pgTAP `supabase/tests/database/cuenta_corriente_cliente.test.sql` + `pnpm test:db:validar-aditivas`.
- [ ] T002 [F-CLI-19][US1] pgTAP de la cuenta corriente: saldo con cobro parcial, total y cobro que supera el total (saldo 0), presupuesto/anulada/borrador/nota de crédito fuera, factura en `deuda` con su total completo, cliente sin deuda, cliente de otra organización, sección `clientes` en `ninguno` y `anon` sin ejecución. **FR-001, FR-002, FR-003, FR-004, SC-001, SC-002** — Verificación: `pnpm test:db` (con `pnpm dev:supabase`).

**Checkpoint**: sin la base no hay pantalla (el saldo sale de la RPC).

## Fase 2 — Pantalla

- [ ] T003 [F-CLI-19][US1] Hook `useCuentaCorrienteCliente` y vista en `pages/clientes` (componente `ComprasCliente`): «Saldo deudor» en la tarjeta «Resumen comercial» y tabla «Cuenta corriente» (Comprobante, Fecha, Estado, Total, Cobrado, Saldo) con carga, vacío y error con «Reintentar». **FR-005, FR-006** — Verificación: Vitest `apps/web/src/components/clientes/ComprasCliente.test.tsx`.
- [ ] T004 [F-CLI-19][US1] Prototipo: tarjeta «Cuenta corriente» en `design/pantallas/ClienteFicha.dc.html` y en su copia `design/pantallas/ClienteFicha/ClienteFicha.dc.html`; inventarios regenerados; matriz de la spec al día. **FR-005** — Verificación: `pnpm prototipo:inventario && pnpm prototipo:check`.
- [ ] T005 [F-CLI-19][US1] E2E con la evidencia de la historia: rótulo `[MSF-451:T001]`, fixture `apps/web/e2e/fixture.ts` y el stack local (usuario de ejemplo del seed). **FR-005, SC-003** — Verificación: `pnpm --filter @platform/web test:e2e` (o el pipeline de evidencia).

## Fase 3 — Cierre

- [ ] T006 [F-CLI-19][US1] Documentación: `docs/clientes.md` describe la cuenta corriente y el «Saldo deudor» de la ficha, y por qué las notas de crédito no restan. **FR-009** — Verificación: `pnpm docs:check`.
- [ ] T007 [F-CLI-19][US1] Gates: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check` verdes; revisión de seguridad del diff (RLS, `anon`, aislamiento por organización) y del texto al usuario. **SC-004, SC-005** — Verificación: `pnpm lint && pnpm build && pnpm test && pnpm prototipo:check && pnpm matriz:check && pnpm docs:check`.

---

## Plan de ejecución

| Tarea | Depende de | Fase |
|---|---|---|
| T001 | — | 1 |
| T002 | T001 | 1 |
| T003 | T001 | 2 |
| T004 | T003 | 2 |
| T005 | T003, T004 | 2 |
| T006 | T003 | 3 |
| T007 | T002, T005, T006 | 3 |
