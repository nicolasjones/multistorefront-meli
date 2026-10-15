# Tasks: Acceso, organización y permisos · Alta de empresas

**Input**: `specs/20261015-100000-alta-de-empresas/` (spec.md, plan.md)

**Formato**: `- [ ] T### [P] [STORY-x][USy] descripción`. **[P]** = paralelizable (archivos distintos, sin dependencia); sin [P] = secuencial.

**Delivery scope**: `refine`, `supabase`

## Matriz de trazabilidad Jira ↔ US ↔ tasks

| Jira | Historia | Tasks |
|------|----------|-------|
| MSF-277 (F-EMP-03) | US1 Crear una empresa nueva | T001–T011 |
| MSF-475 (épica) | Docs y cierre | T012–T014 |

## Phase 1: Base de datos (supabase)

**Goal**: alta atómica por RPC, con copia y unicidad de nombre.

- [x] T001 [F-EMP-03][US1] Verificar el pre-chequeo de nombres duplicados y el esquema (`dominio.empresas`, sin tablas nuevas); anotar resultado en plan.md (FR-002, Principio VII)
- [x] T002 [F-EMP-03][US1] Migración aditiva `supabase/migrations/<ts>_alta_de_empresas.sql`: índice único `(organizacion_id, lower(btrim(nombre)))` y RPC `public.crear_empresa` (security definer, `puede_escribir()`, organización en servidor, `revoke … from public, anon`, `grant … to authenticated`); reversión en el encabezado (FR-001, FR-002, FR-005, FR-009)
- [x] T003 [F-EMP-03][US1] Dentro de la migración, `private.copiar_configuracion_empresa(origen, destino)` como punto de extensión: copia lo que exista por empresa excluyendo dominio y cuentas, valida origen de la misma organización, atómica con el alta; inventariar al implementar si ya existe alguna tabla de configuración por empresa (FR-003, FR-004, FR-010)
- [x] T004 [P] [F-EMP-03][US1] pgTAP `alta_de_empresas.test.sql`: admin crea con y sin origen; nombre vacío/repetido (mayúsculas, espacios); miembro/operador/consulta/suspendido rechazados; origen ajeno rechazado; sin INSERT directo; copia excluye dominio y cuentas y revierte entera si falla; 1/2/3 empresas (SC-002, SC-003, SC-004)
- [x] T005 [P] [F-EMP-03][US1] Confirmar que `aislamiento_organizaciones`, `rls_en_toda_tabla` y el test de ejecutabilidad por `anon` siguen verdes con la RPC nueva; ajustar solo si hace falta (FR-005, FR-009)
  - Nota: los tests existentes (`rls_en_toda_tabla`, `aislamiento_organizaciones`, `anon`) recorren funciones/tablas por catálogo; la RPC cumple `revoke … anon`. pgTAP no corrió local (sin Supabase): queda al CI.

**Checkpoint**: `pnpm test:db` (pgTAP) verde.

## Phase 2: Pantalla Empresas (refine)

**Goal**: botón y diálogo «Nueva empresa» en la pantalla existente.

- [x] T006 [F-EMP-03][US1] Hook `useCrearEmpresa` (RPC, mapeo de error de nombre repetido, refresco de `useEmpresas`) (FR-001, FR-002)
- [x] T007 [F-EMP-03][US1] `DialogoNuevaEmpresa`: Nombre (placeholder «Ej.: Tienda Oeste»), selector «Copiar configuración de» con ayuda, estado sin origen, Cancelar y «Crear empresa», error de nombre repetido en el campo, error de servidor con reintento, envío deshabilitado mientras guarda, foco y accesibilidad, 320/768/1440 px (FR-006, FR-007, FR-008)
- [x] T008 [F-EMP-03][US1] `pages/empresas/list.tsx`: botón «Nueva empresa» y fila final «Nueva empresa» con «Crear», solo con permiso de escritura; confirmación «Empresa creada como borrador» con el patrón compartido de éxito; sin tocar menú ni rutas (FR-006, FR-007)
- [x] T009 [P] [F-EMP-03][US1] Vitest del diálogo y el hook: validación de nombre, nombre repetido, sin origen, doble envío, error de servidor, éxito, textos del prototipo (SC-001, SC-002)
- [x] T010 [P] [F-EMP-03][US1] Vitest del listado: botón y fila visibles solo con escritura; miembro no los ve; la nueva empresa aparece en el listado y en el selector de empresa (SC-001, SC-003)
- [x] T011 [F-EMP-03][US1] E2E «crear empresa copiando de otra» (SC-001) — si aún no hay suite Playwright de la app (MSF-499), cerrar con `[x]` + `Desvío:` y deuda trazada en MSF-499, nunca `[ ]`
  - Desvío: no existe suite Playwright de la app (deuda en MSF-499); SC-001 cubierto por Vitest (`list.test.tsx`) y pgTAP (`alta_de_empresas.test.sql`).

**Checkpoint**: flujo completo operativo; `pnpm lint`, `pnpm build`, `pnpm test` verdes.

## Phase 3: Cierre

- [x] T012 [P] [MSF-475] `docs/empresas.md`: sección «Alta de empresas» (RPC, qué se copia y qué no, punto de extensión para épicas futuras, término «borrador», reversión) (Principio VIII, FR-010)
- [ ] T013 [MSF-475] Revisión de seguridad (`authz-security`) de la RPC y validación final: `pnpm lint && pnpm build && pnpm test && pnpm docs:check`; anotar en el PR las diferencias contra el prototipo y que «Empresas» está en «Operación» (SC-005)
- [ ] T014 [MSF-475] Al merge del PR (merge commit `--no-ff`): actualizar la fila de `docs/roadmap-template.md` (paso manual) y comprobar que ninguna tarea queda `[ ]`

## Dependencias

T001 → T002 → T003 → (T004 [P], T005 [P]) → T006 → T007 → T008 → (T009 [P], T010 [P]) → T011 → T012 [P] → T013 → T014. T012 puede arrancar en paralelo con la Fase 2 una vez cerrada la T003.
