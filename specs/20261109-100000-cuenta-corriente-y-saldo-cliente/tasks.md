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
  Hecho: pgTAP de 25 aserciones (incluye usuario de una sola tienda y cobrada sin cobro). Después se amplió a 46 aserciones (centavos, cada estado vivo, tienda desactivada, persona sin tiendas, superadmin y notas de crédito); lo valida el job `database` del CI.

**Checkpoint**: sin la base no hay pantalla (el saldo sale de la RPC).

## Fase 2 — Pantalla

- [x] T003 [F-CLI-19][US1] Hook `useCuentaCorrienteCliente` y vista en `pages/clientes` (componente `ComprasCliente`): «Saldo deudor» en la tarjeta «Resumen comercial» y tabla «Cuenta corriente» (Comprobante, Fecha, Estado, Total, Cobrado, Saldo) con carga, vacío y error con «Reintentar». **FR-005, FR-006** — Verificación: Vitest `apps/web/src/components/clientes/ComprasCliente.test.tsx`.
  Hecho: Vitest de ComprasCliente y del hook (15 archivos, 169 tests verdes en local).
- [x] T004 [F-CLI-19][US1] Prototipo: tarjeta «Cuenta corriente» en `design/pantallas/ClienteFicha.dc.html` y en su copia `design/pantallas/ClienteFicha/ClienteFicha.dc.html`; inventarios regenerados; matriz de la spec al día. **FR-005** — Verificación: `pnpm prototipo:inventario && pnpm prototipo:check`.
  Hecho: `verificar-inventario-prototipo` OK (120 pantallas al día).
- [x] T005 [F-CLI-19][US1] E2E con la evidencia de la historia: rótulo `[MSF-451:T001]`, fixture `apps/web/e2e/fixture.ts` y el stack local (usuario de ejemplo del seed). **FR-005, SC-003** — Verificación: `pnpm --filter @platform/web test:e2e` (o el pipeline de evidencia).
  Hecho: E2E escrito. Desvío: **el CI no lo corre** (el job `application` ejecuta solo `acceso-publico.e2e.ts` y este archivo se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`); se corre a mano con el stack local.

## Fase 3 — Cierre

- [x] T006 [F-CLI-19][US1] Documentación: `docs/clientes.md` describe la cuenta corriente y el «Saldo deudor» de la ficha, y cómo restan las notas de crédito (desde el 2026-11-11, T008). **FR-009** — Verificación: `pnpm docs:check`.
  Hecho: `docs/clientes.md` actualizado; `verificar-documentacion-cambios` OK.
- [x] T007 [F-CLI-19][US1] Gates: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check` verdes; revisión de seguridad del diff (RLS, `anon`, aislamiento por organización) y del texto al usuario. **SC-004, SC-005** — Verificación: `pnpm lint && pnpm build && pnpm test && pnpm prototipo:check && pnpm matriz:check && pnpm docs:check`.
  Hecho: guards, `tsc -b`, `vite build` y Vitest en local; revisión de seguridad por agente independiente: aprobada. Desvío: `pnpm test` completo y pgTAP los valida el CI; el E2E no corre en el CI.

## Fase 4 — Ampliación (2026-11-11, MSF-450)

Origen: decisión de Nicolás (las notas de crédito restan) y hallazgos de las revisiones independientes. Ver *Ampliación (2026-11-11)* en `spec.md`.

- [x] T008 [F-CLI-19][US1] Las notas de crédito restan de la cuenta corriente: migración `20270227110000_cuenta_corriente_notas_de_credito.sql` (recrea la RPC con la columna `notas_credito`), columna «Notas de crédito» en la ficha, pgTAP y Vitest. **FR-010** — Verificación: pgTAP `cuenta_corriente_cliente.test.sql` + Vitest `ComprasCliente.test.tsx`.
  Hecho: PR #848 (`a568c3f8`).
- [x] T009 [F-CLI-19][US1] Qué nota cuenta sale de `private.comprobante_cuenta_como_facturado`, la misma regla que ranking y facturado neto: `20270227130000_cuenta_corriente_estados_nc_compartidos.sql`. **FR-010** — Verificación: pgTAP.
  Hecho: PR #850 (`b9fa97c9`), sin cambio de comportamiento.
- [x] T010 [F-CLI-19][US1] `private.saldo_comprobante` y `public.saldo_comprobante` restan las notas (drop + create con `notas_credito`); tope de `registrar_cobro` y contrarreembolso por el saldo neto; `grant execute` del predicado a `authenticated`: `20270227140000_saldo_comprobante_resta_notas_credito.sql`. **FR-010, FR-011, FR-012** — Verificación: pgTAP `cuenta_corriente_cliente`, `cobros_comprobante` y `contrarreembolsos`.
  Hecho: PR #851 (`58176e0d`, menores en `492a268b`). **Cambia el comportamiento de Ventas**; aprobado retroactivamente por Nicolás el 2026-11-12.
- [x] T011 [F-CLI-19][US1] Disparador `comprobantes_venta_nota_credito_efectos` y `private.sincronizar_efectos_nota_credito`: la factura pasa a «Cobrado» si el saldo neto llega a 0 con cobros; los contrarreembolsos pendientes se ajustan; anular una nota no reabre: `20270227150000_notas_credito_sincronizan_estado_y_contrarreembolso.sql`. **FR-012, FR-013, FR-014, FR-015** — Verificación: pgTAP.
  Hecho: PR #852 (`82946ebe`, menores en `18fbeb46`). **Cambia el comportamiento de Ventas**; aprobado retroactivamente por Nicolás el 2026-11-12.
- [x] T012 [F-CLI-19][US1] Documentación y ayuda de la ampliación: `docs/clientes.md` (reversión con 140000 y 150000, «Cómo probarlo»), `docs/cobros-por-comprobante.md`, `docs/cuentas-y-compras-a-proveedores.md`, ayuda en pantalla y `notas.md` con lecciones y pendientes. **FR-009** — Verificación: `pnpm docs:check`.
  Hecho: PR de cierre de la auditoría por roles (`docs/msf-450-roles`).

- [x] T013 [F-CLI-19][US1] Pagos usa el mismo saldo neto que la cuenta corriente (decisión 8 de Nicolás, 2026-11-12): `20270228200000_listar_pagos_saldo_neto.sql` (columna `saldo` y «Solo con saldo») y `20270228200100_resumen_pagos_saldo_neto.sql` (`saldo_pendiente`), misma forma de respuesta; docs y ayuda actualizadas. **FR-010** — Verificación: pgTAP `pagos_saldo_neto.test.sql` (factura 1000, cobro 400 y nota 300 → saldo 300; nota 600 → saldo 0 y fuera de «Solo con saldo»; nota anulada/borrador no resta; aislamiento por tienda y organización; sin saldo a favor), corrida local y en el job `database` del CI.
  Hecho: PR de `fix/pagos-saldo-neto`.
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
| T008 | T001 | 4 |
| T009 | T008 | 4 |
| T010 | T009 | 4 |
| T011 | T010 | 4 |
| T012 | T011 | 4 |
| T013 | T010 | 4 |
