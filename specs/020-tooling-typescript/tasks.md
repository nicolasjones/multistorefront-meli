# Tareas: Tooling Node sin Shell propio

## Fase 1 — Inventario y comandos públicos

- [X] T001 Inventariar scripts propios y excepciones Docker/terceros en `docs/adoptar-tooling-typescript.md`.
- [X] T002 [P] Implementar relevo Node para render/publicación de flows en `infra/kestra/*.mjs`.
- [X] T003 [P] Implementar relevo Node para reset CI y despliegue VPS en `scripts/*.mjs`.
- [X] T004 Actualizar `package.json`, CI y documentación de comandos públicos.

**Checkpoint**: ningún comando público propio requiere Shell o PowerShell.

## Fase 2 — Validadores y aprovisionamiento

- [X] T005 [US1] Migrar aprovisionamiento IA y su prueba a `infra/ia/*.mjs`.
- [X] T006 [US1] Migrar validadores Kestra/secretos a `infra/kestra/*.mjs`.
- [X] T007 [US1] Añadir pruebas Node de validación, sanitización y códigos de salida en `scripts/*.test.mjs`.

**Checkpoint**: los relevos validan entradas sin registrar secretos.

## Fase 3 — Imágenes y fixtures

- [X] T008 [US2] Migrar lógica propia de fixtures/entrypoints a Node o documentar excepción técnica en `infra/**/fixtures/`.
- [X] T009 [US2] Retirar los archivos propios `.ps1`, `.sh`, `.bash`, `.cmd` y `.bat` sólo después de los relevos.
- [X] T010 [US2] Verificar que Dockerfiles y Compose no referencian archivos retirados.

**Checkpoint**: no quedan scripts operativos propios con extensiones Shell/PowerShell.

## Fase 4 — Adopción y validación

- [X] T011 [US3] Documentar adopción incremental en `docs/adoptar-tooling-typescript.md`.
- [X] T012 Ejecutar `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test` y relevos operativos aplicables.

## Dependencias

Fase 1 → Fase 2 → Fase 3 → Fase 4. Ningún producto derivado retira su tooling
antes de que el contrato común correspondiente esté validado.
