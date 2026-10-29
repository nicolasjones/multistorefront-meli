# Bug Assessment: Ficha del proveedor sin «Último ingreso» ni «Costo»

- **Slug**: msf-528
- **Created**: 2026-10-19
- **Source**: pasted text (Jira MSF-528, seguimiento de MSF-205; sin URL)
- **Verdict**: valid (brecha prototipo↔implementación declarada, no regresión)
- **Severity**: low

## Report (verbatim or summarized)

"[Seguimiento MSF-205] Último ingreso y Costo en la ficha del proveedor". Seguimiento trazado por FR-020 / T029 de `specs/20261018-190000-proveedores-y-productos`.

## Symptom

La tabla «Productos» de la ficha del proveedor muestra solo `Producto`, `Código del proveedor` y `Ver producto`. El prototipo (`design/pantallas/ProveedorFicha.dc.html`) también muestra las columnas `Costo` y `Último ingreso` (y «último ingreso» en el subtítulo y la tarjeta «Últimos ingresos de mercadería»).

## Reproduction

1. Abrir `/proveedores/:id` de un proveedor con productos asignados.
2. Mirar la sección «Productos»: faltan `Costo` y `Último ingreso`.

## Suspected Code Paths

- `apps/web/src/components/proveedores/ProductosDelProveedor.tsx:12` — `columnas` solo define Producto / Código / Acciones.
- `apps/web/src/hooks/useProductosDeProveedor.ts:5` — tipo `ProductoDeProveedor` sin costo ni último ingreso.
- `supabase/migrations/20261021162300_productos_de_proveedor.sql` — RPC `public.productos_de_proveedor` devuelve solo id, nombre, codigo_proveedor, activo, total_filas.
- `supabase/migrations/20261017120100_catalogo_productos_y_costos.sql:110` — `dominio.producto_costos` (costo; RLS exige sección `rentabilidad` en lectura/edición; el Operador no ve filas).
- `specs/20261018-190000-proveedores-y-productos/spec.md:224-225` — matriz: ambas columnas «Fuera de alcance» (costo → MSF-179; último ingreso → MSF-219).
- `design/pantallas/ProveedorFicha.dc.html` — fuente de verdad visual.

## Root Cause Hypothesis

Omisión deliberada de alcance: la spec dejó ambas columnas fuera (matriz pantalla↔criterios) y las trazó como seguimiento. **Costo** ya tiene fuente de datos (`dominio.producto_costos`), por lo que es implementable ya. **Último ingreso** depende del ingreso de mercadería (MSF-219): no existe tabla de ingresos en `supabase/migrations` (búsqueda sin resultados), así que no hay de dónde calcularlo. Confianza: alta.

## Proposed Remediation

**Preferred** (en dos partes, nueva spec/bug-fix acotado):
1. *Costo*: extender `productos_de_proveedor` con migración nueva (cambia el `returns table` → `drop function` + `create`, con `revoke ... from public, anon` y `grant ... to authenticated`) haciendo `left join dominio.producto_costos` y devolviendo `costo` solo si `private.nivel_seccion('rentabilidad')` es lectura/edición (null si no, sin romper la ficha para quien no tiene Rentabilidad). En UI agregar columna `Costo` alineada a la derecha, con `—` cuando es null/oculto; ocultar la columna si el rol no ve rentabilidad.
2. *Último ingreso*: bloqueado por MSF-219. Al entregarse la tabla de ingresos, agregar `ultimo_ingreso` (max fecha por producto+proveedor) a la misma RPC y la columna. Hasta entonces, mantener fuera de alcance y no mostrar un valor inventado.

**Alternatives**:
- Entregar ambas en un solo cambio posponiendo todo hasta MSF-219: más simple, pero deja Costo sin necesidad.
- Consultar `producto_costos` desde el cliente en vez de la RPC: más viajes y duplica la lógica de permisos.

**Files likely to change**:
- `supabase/migrations/<nueva>_productos_de_proveedor_costo.sql`
- `apps/web/src/hooks/useProductosDeProveedor.ts`
- `apps/web/src/components/proveedores/ProductosDelProveedor.tsx`
- `specs/20261018-190000-proveedores-y-productos/spec.md` (matriz) y `docs/` correspondiente

**Tests to add or update**:
- pgTAP: la RPC devuelve costo con rol con Rentabilidad y null sin ella; anon sin ejecución; otra organización no filtra costos.
- Vitest `ProductosDelProveedor`: columna Costo con formato y `—`; oculta sin permiso.
- `pnpm matriz:check` / `pnpm prototipo:check` al día.

## Risks & Considerations

- Cambio de firma de RPC: requiere drop + create y camino de reversión documentado (migraciones aditivas).
- Fuga de costo a roles sin Rentabilidad si el join no respeta el nivel de sección (el costo está aislado a propósito).
- Moneda/formato del costo: el prototipo usa `money()`; confirmar moneda de `producto_costos` (no tiene columna de moneda).
- Último ingreso depende de MSF-219; no inventar datos.

## Open Questions

- [NEEDS CLARIFICATION: ¿se acepta entregar solo Costo ahora y Último ingreso con MSF-219, o se espera a ambos?]
- [NEEDS CLARIFICATION: ¿la tarjeta «Últimos ingresos de mercadería» y el subtítulo «último ingreso» también entran en este seguimiento?]
