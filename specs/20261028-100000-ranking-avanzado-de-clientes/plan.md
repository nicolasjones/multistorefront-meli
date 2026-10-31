# Implementation Plan: Clientes y proveedores · Ranking avanzado de clientes

**Spec**: `specs/20261028-100000-ranking-avanzado-de-clientes/spec.md` · **Contratos**: `contracts/ranking-avanzado-de-clientes.md`
**Delivery scope**: `refine`, `supabase`

## Enfoque

Extender lo ya entregado por MSF-126 sin tocarlo: tres RPC nuevas (`ranking_clientes_comparado`, `ranking_clientes_por_dimension`, `clientes_inactivos`) que reutilizan el predicado `private.comprobante_cuenta_como_facturado`, el signo de notas de crédito y el filtro por tienda, y la UI sobre `RankingClientes.tsx` / `list.tsx`. **Consultas propias, sin Superset** (Decisiones abiertas 1). Sin tablas ni columnas nuevas (Principio VII: no hay objeto de datos que ubicar; las funciones viven en `public` como RPC de aplicación y leen `dominio`/`public`; cada migración re-verifica que no crea tablas).

## Verificación de estado actual (grafo y migraciones)

- `public.ranking_clientes(date,date,text,boolean,boolean,integer,integer,uuid)` — `20261212120500_facturado_neto_notas.sql` (firma vigente, con `p_empresa_id`).
- `private.comprobante_cuenta_como_facturado` y `private.signo_comprobante` — misma migración.
- `dominio.comprobantes_venta` (`20261018100000`, con `empresa_id` desde `20261203100100`), `dominio.comprobantes_venta_lineas` (`20261203200100`: `producto_id`, `subtotal_sin_iva`, `iva`), `dominio.productos.categoria_id` (`20261020140200`), `dominio.categorias` con `padre` y máximo 2 niveles (`20261020140001`).
- `public.clientes.provincia`, `archivado_en`, `es_consumidor_final`, `clientes_empresas` — existentes.
- Front: `apps/web/src/components/clientes/RankingClientes.tsx`, `hooks/useRankingClientes.ts` (`argumentosRanking`), `lib/periodosRanking.ts`, `pages/clientes/list.tsx` (solapas con `lazy`), `hooks/useCategorias.ts`.
- Pendiente de verificar al implementar: filtrado de líneas de **nota de crédito** (¿tienen líneas propias?) — si no las tienen, el filtro por producto/categoría no las resta y se anota en la spec como límite conocido, sin inventar.

## Decisiones técnicas

1. **Una migración y una función por historia** (autosuficientes; no se encadenan). El cuerpo común (validaciones de rango) se **repite** en cada función en vez de factorizarse en un helper compartido, para no crear una dependencia entre historias; el criterio de negocio sí es compartido (predicado + signo).
2. **Comparación**: `full outer join` de dos agregados por cliente (período actual / de comparación) sobre el mismo conjunto de clientes filtrado; `variacion_porcentaje = null` si la base ≤ 0.
3. **Dimensiones**: con producto o categoría se agrega desde `comprobantes_venta_lineas` (join a `productos`/`categorias`; categoría raíz = ella y sus hijas); sin ellos se reutiliza la agregación por comprobante. Provincia: comparación con `unaccent`/`lower` **solo si la extensión ya está habilitada**; si no, normalización con `translate` sin habilitar extensiones nuevas (verificar al implementar).
4. **Inactivos**: `max(fecha)` por cliente sobre facturas que cuentan, `having max(fecha) < (now() at time zone 'America/Argentina/Buenos_Aires')::date - p_dias`.
5. **UI**: la comparación y los filtros de dimensión viven en `RankingClientes.tsx` (nuevos subcomponentes en archivos propios para mantenerlo chico); «Clientes inactivos» es un componente propio cargado con `lazy` desde una tercera solapa. Estados con `EstadosPagina`, tarjetas con `ContenidoAdaptable`, empresa activa por el `empresaId` ya recibido (patrón de MSF-126/F-CLI-11) y píldoras `FiltroEmpresa` solo donde ya estén; no se agregan `Chip`/`Select` propios para empresas.
6. **Sin Excel** para las vistas nuevas (fuera de alcance, declarado en la matriz).

## Riesgos

- Rendimiento de las agregaciones por línea sobre muchos comprobantes: apoyarse en `comprobantes_venta_lineas_producto_idx` y en `(organizacion_id, cliente_id, fecha desc)`; medir con `explain` en datos de ejemplo grandes y, solo si hace falta, agregar un índice en la misma migración de la historia.
- Conflicto de archivos entre F-CLI-14 y F-CLI-15 (ambas en `RankingClientes.tsx`): por eso van en grupos de ejecución distintos.
- Sin prototipo: riesgo de rework visual; mitigación = seguir el ranking actual y anotar diferencias en el PR.

## Documentación (Principio VIII)

Cada historia deja constancia en `specs/` (tasks marcadas con evidencia); la guía en `docs/clientes.md` y el roadmap se actualizan en la Tarea de cierre.
