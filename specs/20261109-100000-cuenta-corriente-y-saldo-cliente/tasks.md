# Tasks: Clientes y proveedores · Cuenta corriente y saldo del cliente

**Input**: `specs/20261109-100000-cuenta-corriente-y-saldo-cliente/` (spec.md, plan.md). Sin
`contracts/` (la RPC nueva no cambia contratos existentes).

**Formato**: `- [ ] T### [F-CLI-19][US1] descripción`. Sin `[P]`: las tareas van en orden.

**Delivery scope**: `refine`, `supabase`.

**Épica**: MSF-450. Su tarea de épica para esta historia es **T001** («cuando pase a un hito:
redactar requisitos, pantalla (saldo en la ficha de `ClienteFicha`) y matriz de la cuenta
corriente»): esta spec y estas tareas son esa redacción, y las tareas de acá la implementan.

## Fase 1 — Base de datos

- [x] T001 [F-CLI-19][US1] Migración aditiva `20270222100000_cuenta_corriente_cliente.sql` con `public.cuenta_corriente_cliente(p_cliente_id uuid)`: saldo total, cantidad de comprobantes y las filas de los comprobantes con saldo (total, cobrado, saldo); `security definer`, `search_path = ''`, organización de la sesión, sección `clientes`, `revoke`/`grant` correctos y reversión documentada en el encabezado. **FR-001, FR-002, FR-003, FR-004, FR-008** — Verificación: pgTAP `supabase/tests/database/cuenta_corriente_cliente.test.sql` + `pnpm test:db:validar-aditivas`.
  Hecho: migración renumerada a 20270222100000 tras integrar dokploy; la cobrada no es deuda y el saldo respeta las tiendas accesibles (revisión QA/Code, 2.ª ronda).
- [x] T002 [F-CLI-19][US1] pgTAP de la cuenta corriente: saldo con cobro parcial, total y cobro que supera el total (saldo 0), presupuesto/anulada/borrador/nota de crédito fuera, factura en `deuda` con su total completo, cliente sin deuda, cliente de otra organización, sección `clientes` en `ninguno` y `anon` sin ejecución. **FR-001, FR-002, FR-003, FR-004, SC-001, SC-002** — Verificación: `pnpm test:db` (con `pnpm dev:supabase`).
  Hecho: pgTAP de 25 aserciones (incluye usuario de una sola tienda y cobrada sin cobro). Después se amplió a 34 aserciones (centavos, cada estado vivo, tienda desactivada, persona sin tiendas y superadmin) y se corrió en un Supabase local aparte; también lo valida el job `database` del CI.

**Checkpoint**: sin la base no hay pantalla (el saldo sale de la RPC).

## Fase 2 — Pantalla

- [x] T003 [F-CLI-19][US1] Hook `useCuentaCorrienteCliente` y vista en `pages/clientes` (componente `ComprasCliente`): «Saldo deudor» en la tarjeta «Resumen comercial» y tabla «Cuenta corriente» (Comprobante, Fecha, Estado, Total, Cobrado, Saldo) con carga, vacío y error con «Reintentar». **FR-005, FR-006** — Verificación: Vitest `apps/web/src/components/clientes/ComprasCliente.test.tsx`.
  Hecho: Vitest de ComprasCliente y del hook (15 archivos, 169 tests verdes en local).
- [x] T004 [F-CLI-19][US1] Prototipo: tarjeta «Cuenta corriente» en `design/pantallas/ClienteFicha.dc.html` y en su copia `design/pantallas/ClienteFicha/ClienteFicha.dc.html`; inventarios regenerados; matriz de la spec al día. **FR-005** — Verificación: `pnpm prototipo:inventario && pnpm prototipo:check`.
  Hecho: `verificar-inventario-prototipo` OK (120 pantallas al día).
- [x] T005 [F-CLI-19][US1] E2E con la evidencia de la historia: rótulo `[MSF-451:T001]`, fixture `apps/web/e2e/fixture.ts` y el stack local (usuario de ejemplo del seed). **FR-005, SC-003** — Verificación: `pnpm --filter @platform/web test:e2e` (o el pipeline de evidencia).
  Hecho: E2E escrito. Desvío: **el CI no lo corre** (el job `application` ejecuta solo `acceso-publico.e2e.ts` y este archivo se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`); se corre a mano con el stack local.

## Fase 3 — Cierre

- [x] T006 [F-CLI-19][US1] Documentación: `docs/clientes.md` describe la cuenta corriente y el «Saldo deudor» de la ficha, y por qué las notas de crédito no restan. **FR-009** — Verificación: `pnpm docs:check`.
  Hecho: `docs/clientes.md` actualizado; `verificar-documentacion-cambios` OK.
- [x] T007 [F-CLI-19][US1] Gates: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check` verdes; revisión de seguridad del diff (RLS, `anon`, aislamiento por organización) y del texto al usuario. **SC-004, SC-005** — Verificación: `pnpm lint && pnpm build && pnpm test && pnpm prototipo:check && pnpm matriz:check && pnpm docs:check`.
  Hecho: guards, `tsc -b`, `vite build` y Vitest en local; revisión de seguridad por agente independiente: aprobada. Desvío: `pnpm test` completo y pgTAP los valida el CI; el E2E no corre en el CI.

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
