# Implementation Plan: Tiendas · Seguimiento MSF-846 parte A

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `supabase`, `refine`.

## Enfoque técnico

- Búsqueda: diagnóstico con tiempos en dev (solo lectura): coincidencias por texto en ~125 ms; `precio_vigente_empresa` para los 2.204 productos ~15 s con el servidor cargado. CTE `coincidencias` y `prod` materializados; precio por escalar bajo `CASE` (solo con precio máximo u orden por precio); disponibilidad solo con «solo con stock»; el resto en un `lateral` sobre la página de 24. Sin índices nuevos.
- Vista previa: CTEs `efectivos` materializado → `arbol` recursivo → `img_producto` → `imagen` (copia de la lógica de `20270303400000`) y `left join` por id.
- Relacionados: CTE `efectivos` de la tienda; `manuales` (join con `producto_relacionados` por orden y organización) y `relleno` (regla por categoría sin repetir), `union all` ordenado por grupo/orden y `limit 4`.
- Front: `leerVistaPrevia` conserva `imagen` de cada categoría; `fuenteDesdeVistaPrevia` ya la pasa a `CategoriasInicio`.

## Riesgos

- El orden por precio sobre todas las coincidencias sigue costando ~6 ms por producto (2,5 s para 389 coincidencias en dev cargado): no es el caso común; seguimiento si hiciera falta (precio por lote).
- Reversión: migración posterior que restaura los cuerpos de `20270221100005`, `20270205110100` y `20270212100003`.
