# Bug Assessment: Importar y exportar proveedores (seguimiento de MSF-205)

- **Slug**: msf-526
- **Created**: 2026-10-19
- **Source**: pasted text — "[Seguimiento MSF-205] Importar y exportar proveedores (Jira MSF-526)" (sin URL)
- **Verdict**: likely valid, needs reproduction — no es un defecto de código: es una capacidad del prototipo diferida a propósito (FR-020)
- **Severity**: low

## Report (verbatim or summarized)

Tarea `seguimiento` abierta por T029 de `specs/20261018-190000-proveedores-y-productos/tasks.md` (FR-020): el prototipo `design/pantallas/Proveedores.dc.html` muestra los botones `Importar` / `Exportar`, `Descargar plantilla CSV`, `Importar 14 proveedores` y el diálogo «Importar proveedores», y la épica MSF-205 no los pidió.

## Symptom

La pantalla de Proveedores (`/proveedores`) no tiene botones Importar ni Exportar, aunque el prototipo (fuente de verdad visual) los muestra. Esperado: poder cargar proveedores desde CSV (con plantilla) y descargar el listado.

## Reproduction

1. Abrir `/proveedores` con un usuario con permiso de edición.
2. Observar el encabezado: solo existe `Nuevo proveedor`.
3. Comparar con `design/pantallas/Proveedores.inventory.json` (botones: Importar, Exportar, Descargar plantilla CSV, Importar 14 proveedores; diálogo «Importar proveedores»).

## Suspected Code Paths

- `specs/20261018-190000-proveedores-y-productos/spec.md:204-205` — la matriz pantalla↔criterios declara ambos botones "Fuera de alcance" (importación = MSF-142/MSF-445; Exportar = seguimiento).
- `apps/web/src/pages/proveedores/list.tsx:77,127` — única acción de encabezado: `Nuevo proveedor`.
- `apps/web/src/lib/proveedores.ts` — validación (`validarProveedor`, `aParametrosCrear`), `crearProveedor`; reutilizable para validar filas importadas. CUIT en `apps/web/src/lib/cuit.ts`.
- `supabase/migrations/20261018190100_proveedores_rpc.sql` — `crear_proveedor` (7 args), `authenticated`-only; unicidad de CUIT por organización (incluye desactivados, `MENSAJE_CUIT_REPETIDO`).
- `apps/web/src/lib/exportarClientes.ts` / `exportarRanking.ts` — patrón existente de exportación (lotes, progreso, `ErrorExportacion`, cancelación) a reutilizar para Exportar.
- No existe ningún patrón de importación en el repo (no hay `importar_*` en migraciones ni libs).

## Root Cause Hypothesis

No hay regresión: la funcionalidad nunca se implementó por decisión de alcance (spec.md Decisiones 3 / matriz). Confianza: alta. Es una funcionalidad nueva, no un fix; por la regla del repo corresponde pasar por Spec Kit (`speckit-specify`) o cerrarse como seguimiento, no parchearse como bug.

## Proposed Remediation

**Preferred**: tratarlo como feature nueva (spec propia, alcance `refine` + `supabase`; matriz pantalla↔criterios con los ítems del inventario). 
- Exportar: botón en `list.tsx` que genere CSV/XLSX del listado filtrado reutilizando el patrón de `exportarClientes` (lotes sobre la RPC de listado `20261018190300_proveedores_listar.sql`), respetando RLS y la organización.
- Importar: diálogo con «Descargar plantilla CSV», parseo y validación en cliente con `validarProveedor`/`cuit.ts`, previsualización con conteo («Importar N proveedores») y alta mediante una RPC masiva nueva (migración aditiva, `revoke ... from public, anon` + `grant ... to authenticated`, esquema `public`), con reporte por fila de CUIT repetidos/ inválidos.

**Alternatives**:
- Importar vía llamadas repetidas a `crear_proveedor` desde el cliente: sin migración, pero no atómico y lento para volúmenes grandes.
- Cerrar como absorbido por MSF-142/MSF-445 si la importación de datos ya cubre proveedores (hay que confirmarlo).

**Files likely to change**:
- `apps/web/src/pages/proveedores/list.tsx`
- `apps/web/src/lib/exportarProveedores.ts` (+ test), `apps/web/src/lib/importarProveedores.ts` (+ test)
- `apps/web/src/components/proveedores/ImportarProveedoresDialog.tsx`
- `supabase/migrations/<ts>_importar_proveedores.sql` (+ pgTAP)
- `specs/<nueva>/spec.md` (matriz), `docs/`, `design/pantallas/Proveedores.inventory.json` solo si cambia el prototipo

**Tests to add or update**:
- Vitest: parseo CSV, validación por fila, CUIT duplicado, export con filtros.
- pgTAP: RPC masiva (RLS por organización, `anon` sin ejecución, CUIT repetido).
- Playwright: flujo importar/exportar.

## Risks & Considerations

- Seguridad: la RPC masiva debe respetar RLS/organización y el test pgTAP de `anon`; nunca service-role en el navegador.
- Datos: CUIT único por organización incluye proveedores desactivados; definir si el import omite, falla o reactiva.
- Alcance: solapamiento con MSF-142/MSF-445 (importación de datos) — evitar duplicar.
- Regla "una pantalla por producto" y "el prototipo manda la UI": no inventar campos fuera del inventario (condiciones de compra, «Compra para» siguen fuera).

## Open Questions

- [NEEDS CLARIFICATION: ¿columnas de la plantilla CSV? El prototipo muestra los campos del diálogo (incl. condiciones de compra, hoy fuera de alcance).]
- [NEEDS CLARIFICATION: ¿MSF-142/MSF-445 ya cubren la importación de proveedores?]
- [NEEDS CLARIFICATION: ¿formato de exportación (CSV vs XLSX) y qué hacer con duplicados al importar?]
