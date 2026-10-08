# Tareas: Despacho confiable de ejecuciones

**Entrada**: artefactos de `specs/019-outbox-ejecuciones/`.  
**Pruebas**: pgTAP obligatorio para tablas, RLS y funciones sensibles; validación de Kestra y recorrido real en la adopción del producto.

## Fase 1 — Base

- [X] T001 Crear migración aditiva y su reversión documentada en `supabase/migrations/20260923170828_outbox_ejecuciones.sql`.
- [X] T002 [P] Crear esqueleto pgTAP en `supabase/tests/database/outbox_ejecuciones.test.sql`.
- [X] T003 [P] Ampliar el contrato de adopción en `docs/adoptar-ciclo-ejecuciones.md`.

**Checkpoint**: archivos versionados y pruebas preparadas, sin modificar aún el inicio de ejecuciones.

## Fase 2 — Fundaciones

- [X] T004 Crear la tabla de outbox, índices, RLS, grants y restricción uno-a-uno en `supabase/migrations/20260923171400_crear_outbox_ejecuciones.sql`.
- [X] T005 Crear la función interna de reclamo vencible en `supabase/migrations/20260923171252_reclamar_despachos_ejecucion.sql`.
- [X] T006 [P] Implementar pgTAP de aislamiento, unicidad y permisos del contrato de reclamo en `supabase/tests/database/outbox_ejecuciones.test.sql`.

**Checkpoint**: una orden no puede verse fuera de su organización ni ser reclamada dos veces.

## Fase 3 — Historia 1: solicitud durable

- [X] T007 [US1] Escribir pruebas de atomicidad de inicio y orden en `supabase/tests/database/outbox_ejecuciones.test.sql`.
- [X] T008 [US1] Extender `iniciar_ejecucion_worker` para crear la orden en la misma transacción en `supabase/migrations/20260923172738_iniciar_ejecucion_outbox.sql`.
- [X] T009 [US1] Publicar el contrato de reclamo mínimo en `specs/019-outbox-ejecuciones/contracts/despacho-outbox.md` y `workers/README.md`.

**Checkpoint**: una solicitud manual persiste una ejecución y una sola orden recuperable.

## Fase 4 — Historia 2: recuperación

- [X] T010 [US2] Escribir pgTAP de reclamo concurrente, vencimiento, liberación y agotamiento en `supabase/tests/database/outbox_ejecuciones.test.sql`.
- [X] T011 [US2] Implementar RPC técnica de reclamar, confirmar, liberar y agotar en `supabase/migrations/<timestamp>_outbox_ejecuciones.sql`.
- [X] T012 [US2] Documentar el uso del contrato en flows de plantilla en `infra/kestra/flows/plantilla-generico.yml` y `infra/kestra/flows/plantilla-dedicado.yml` sin incluir un conector de dominio.

**Checkpoint**: una caída posterior al reclamo no pierde ni duplica la orden.

## Fase 5 — Historia 3: adopción segura

- [X] T013 [US3] Agregar una prueba estática que rechace HTTP saliente desde triggers de ejecuciones en `supabase/tests/database/outbox_ejecuciones.test.sql` o harness equivalente.
- [X] T014 [US3] Registrar la versión/contrato de adopción en `docs/adoptar-ciclo-ejecuciones.md`.
- [X] T015 [US3] Verificar que los ejemplos no incluyen proveedor, credencial, URL ni lógica de producto en `workers/README.md`.

**Checkpoint**: el template ofrece el mecanismo reutilizable sin acoplarse a un producto.

## Fase 6 — Validación

- [X] T016 Ejecutar `pnpm test`, `pnpm lint`, `pnpm build` y `pnpm infra:config` (2026-09-23: lint, build e infra:config pasan; `pnpm test` pasa con 22 archivos/103 pruebas web y 12 archivos/406 pruebas pgTAP).
- [X] T017 Ejecutar la guía `specs/019-outbox-ejecuciones/quickstart.md` y documentar evidencia sanitizada.

## Dependencias

Fase 1 → Fase 2 → US1 → US2 → US3 → Validación. La adopción del producto empieza solo después de US1 y US2 validadas en el template.
