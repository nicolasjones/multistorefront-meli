# Bug Assessment: «Compra para» ausente en el proveedor (seguimiento MSF-205)

- **Slug**: msf-524 (provisto por el usuario)
- **Created**: 2026-10-19
- **Source**: pasted text — Jira MSF-524 «[Seguimiento MSF-205] «Compra para» en el proveedor» (sin URL; no se consultó Jira)
- **Verdict**: valid (brecha de alcance trazada, no una regresión de código)
- **Severity**: medium

## Report (verbatim or summarized)

Tarea `seguimiento` abierta por T029/FR-020 de la spec `proveedores-y-productos` (épica MSF-205): el prototipo
`design/pantallas/Proveedores.dc.html` muestra «Compra para» (por tienda) en el proveedor y la épica lo dejó
fuera de alcance (spec.md Decisiones 3, línea 181; matriz línea 200; docs/proveedores.md:57).

## Symptom

El proveedor no registra para qué tiendas (empresas) se le compra: ni el diálogo Nuevo/Editar, ni el listado, ni la ficha
tienen el campo/columna «Compra para», que el prototipo (fuente de verdad visual) sí muestra. Esperado: poder marcar
una o más tiendas por proveedor, verlas como chips en el listado y filtrar el listado por tienda.

## Reproduction

1. Abrir Proveedores → «Nuevo proveedor» (o «Editar»): no hay selector «Compra para».
2. Ver el listado: no hay columna «Compra para» ni filtro por tienda.
3. Comparar con `design/pantallas/Proveedores.dc.html` (chips por tienda, `pDispo`/`TSEL`, filtro `tFilt`).

[NEEDS CLARIFICATION: semántica exacta de «Compra para» (¿restringe en qué tienda se puede ingresar mercadería de ese proveedor, o solo informativo?); el prototipo solo la muestra como multi-selección de tiendas.]

## Suspected Code Paths

- `supabase/migrations/20261018190000_proveedores_tabla.sql` — `dominio.proveedores` no tiene relación con tiendas (proveedor es de la organización).
- `supabase/migrations/20261018190100_proveedores_rpc.sql` — `crear_proveedor`/`actualizar_proveedor` sin parámetro de tiendas.
- `supabase/migrations/20261018190300_proveedores_listar.sql` — `listar_proveedores` no devuelve ni filtra por tiendas.
- `apps/web/src/components/proveedores/ProveedorFormDialog.tsx`, `apps/web/src/pages/proveedores/list.tsx`, `show.tsx`, `apps/web/src/lib/proveedores.ts` — UI/lib sin el campo.
- Patrón de referencia ya existente: `supabase/migrations/20261018090000_clientes_empresas.sql` (`clientes_empresas`, `guardar_empresas_de_cliente`), `apps/web/src/hooks/useEmpresasDeCliente.ts`, `apps/web/src/lib/clientes.ts`.
- Docs/spec: `specs/20261018-190000-proveedores-y-productos/spec.md` (matriz línea 200), `docs/proveedores.md:57`, `design/pantallas/Proveedores.inventory.json`.

## Root Cause Hypothesis

No es un defecto de implementación: «Compra para» se excluyó deliberadamente del alcance de MSF-205 (ningún requisito
del documento la pedía) y se trazó este seguimiento. La causa es la ausencia del modelo de datos (relación N:M proveedor↔tienda)
y de su UI. Confianza: alta.

## Proposed Remediation

**Preferred**: replicar el patrón de clientes: tabla `dominio.proveedores_empresas (proveedor_id, empresa_id, organizacion_id, PK compuesta)`
(esquema `dominio`, Principio VII; la relación es del negocio), con FK compuestas/disparador de pertenencia a la organización, RLS por
organización y `nivel_seccion('proveedores')`, índices por FK, y RPC `public.guardar_empresas_de_proveedor(uuid, uuid[])`
(security definer, `revoke ... from public, anon` + `grant ... to authenticated`). Extender `listar_proveedores` con filtro opcional por
tienda y devolver las tiendas (agregado), y exponerlas en la vista/ficha. UI: selector de chips «Compra para» en `ProveedorFormDialog`,
columna con chips y filtro por tienda en el listado, dato en la ficha, según el prototipo. Seguir el flujo Spec Kit (spec con matriz
pantalla↔criterios: mover «Compra para» de «Fuera de alcance» a «En alcance»; correr `pnpm prototipo:inventario`).

**Alternatives**:
- Columna `uuid[]` en `dominio.proveedores`: más simple pero sin integridad referencial ni índices; descartada por consistencia con `clientes_empresas`.

**Files likely to change**:
- `supabase/migrations/<nueva>_proveedores_empresas.sql` (aditiva, con reversión documentada)
- `apps/web/src/components/proveedores/ProveedorFormDialog.tsx`
- `apps/web/src/pages/proveedores/list.tsx`, `show.tsx`
- `apps/web/src/lib/proveedores.ts`, nuevo hook `useEmpresasDeProveedor`
- `docs/proveedores.md`, spec/matriz, `supabase/tests` (pgTAP), tests Vitest de los componentes

**Tests to add or update**:
- pgTAP: RLS por organización/sección, rechazo de empresa de otra organización, `anon` sin ejecución de la RPC nueva, reemplazo atómico.
- Vitest: diálogo guarda tiendas; listado muestra chips y filtra por tienda.

## Risks & Considerations

- Cambiar la firma de `listar_proveedores` rompe a los llamadores (`useProveedoresBasico`, tests): crear la versión nueva o mantener compatibilidad.
- Si «Compra para» debe restringir el ingreso de mercadería (MSF-219), el alcance crece más allá de este seguimiento.
- Migración aditiva únicamente; documentación obligatoria (`pnpm docs:check`, `pnpm matriz:check`).

## Open Questions

- [NEEDS CLARIFICATION: ¿informativo o restrictivo? ¿valor por defecto al crear (todas las tiendas / la tienda activa, como en el prototipo)?]
- [NEEDS CLARIFICATION: ¿el filtro por tienda del listado entra en este seguimiento?]
