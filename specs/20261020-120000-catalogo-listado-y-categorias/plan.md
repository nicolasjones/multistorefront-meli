# Implementation Plan: Catálogo · Catálogo listado y categorías

**Spec**: `spec.md` · **Épica**: MSF-160 · **Rama**: `epic/MSF-160-catalogo-catalogo-listado-y-categorias` · **Delivery scope**: `refine`, `supabase`

## Resumen

Reemplazar la grilla mínima `/productos` por un listado con búsqueda, filtros, orden y paginación en servidor sobre `public.v_productos_listado`; agregar la relación `producto_empresa` y su sección en el formulario; y crear el árbol de categorías (2 niveles, arrastrar y soltar, visibilidad por tienda). Tres historias, cada una con su migración aditiva; las tres tocan `v_productos_listado` y `FormularioProducto`, por eso se ejecutan **en serie** (01 → 07 → 08).

## Technical Context

- **Stack**: Refine + MUI (`apps/web`), Supabase self-hosted (migraciones, RPC `security invoker`, pgTAP), Vitest. Sin Cloud, sin dependencias nuevas (arrastrar y soltar con HTML5 nativo).
- **Permisos**: `private.nivel_seccion('productos')` y `('categorias')` en pantalla y RLS; nunca `puede_escribir()`.
- **Actividad**: `private.registrar_actividad(tipo, detalle, empresa_id)`; eventos en `spec.md` FR-014 y FR-023.
- **Filtro por tienda**: `hooks/useFiltroPorEmpresaActiva`.
- **Búsqueda**: `ilike` con comodines escapados + índice GIN `gin_trgm_ops` sobre `lower(nombre)` y `lower(sku)` (pg_trgm ya habilitada, `20261016160000`).

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización en `producto_empresa`, `categorias`, `categorias_empresa`; vista `security_invoker`; FKs compuestas con `organizacion_id`. pgTAP por historia. |
| II Spec antes | Esta spec; FR/SC con dueño único. |
| IV Despliegues | Solo `apps/web` y `supabase/`. |
| V Simplicidad | Sin librería de drag & drop, sin infraestructura nueva. |
| VI Panel operable | Menú Catálogo → Productos (existente) y Catálogo → Categorías (`/categorias`, ícono `Category`, sección `categorias`, audiencia organización, carga diferida); kit de estados; teclado; 320/768/1440 px; sin ids técnicos visibles. |
| VII Esquemas | Ver tabla; **re-verificar en cada PR** que todo objeto nuevo está en `dominio` (tablas) y que solo la vista está en `public`. |
| VIII Documentación | `docs/catalogo.md` actualizado en cada historia; el cierre consolida. |

## Esquema (re-verificación Principio VII)

| Objeto | Esquema | Migración (historia) |
|---|---|---|
| `v_productos_listado` (vista) | `public` | `20261020120000_catalogo_listado_vista.sql` (F-CAT-01); se amplía con `create or replace` agregando columnas **al final** en F-CAT-07 y F-CAT-08 |
| índices trigram de búsqueda sobre `dominio.productos` | `dominio` | `20261020120100_catalogo_listado_indices.sql` (F-CAT-01) |
| `producto_empresa` | `dominio` | `20261020130000_catalogo_producto_empresa.sql` (F-CAT-07) |
| RPC `definir_empresas_producto`, trigger de actividad | `public` / `private` | `20261020130100_catalogo_producto_empresa_rpc.sql` (F-CAT-07) |
| vista con `empresa_ids` | `public` (vista) | `20261020130200_catalogo_listado_visible_en.sql` (F-CAT-07; incluye todas las columnas previas) |
| `categorias`, `categorias_empresa` | `dominio` | `20261020140000_catalogo_categorias.sql` (F-CAT-08) |
| RPC `guardar_categoria`, `reordenar_categorias`, `eliminar_categoria`, triggers de actividad | `public` / `private` | `20261020140100_catalogo_categorias_rpc.sql` (F-CAT-08) |
| `productos.categoria_id`, RPC `asignar_categoria_producto`, vista con categoría | `dominio` / `public` | `20261020140200_catalogo_productos_categoria.sql` (F-CAT-08; incluye todas las columnas previas de la vista) |

Reversión (migración posterior, documentada en el encabezado de cada archivo): `drop function …`, `drop trigger …`, `drop table dominio.categorias_empresa, dominio.categorias` (solo mientras no haya datos productivos), `alter table dominio.productos drop column categoria_id`, y `create or replace view` a la versión previa. No se destruye nada en el mismo PR que lo crea. Las historias 07 y 08 repiten la definición completa de la vista, de modo que el orden de aplicación por timestamp es seguro. Verificar que `on delete set null (categoria_id)` esté soportado por la versión de Postgres self-hosted; si no, `eliminar_categoria` hace el `update` explícito.

## Estructura de código

```text
supabase/migrations/20261020*_catalogo_*.sql
supabase/tests/database/catalogo_listado.test.sql
supabase/tests/database/catalogo_producto_empresa.test.sql
supabase/tests/database/catalogo_categorias.test.sql
apps/web/src/lib/productosListado.ts          # consulta, filtros, escape de comodines (F-CAT-01)
apps/web/src/pages/productos/list.tsx         # reemplaza la grilla mínima
apps/web/src/components/productos/FiltrosListado.tsx
apps/web/src/components/productos/EmpresasProducto.tsx   # F-CAT-07
apps/web/src/components/productos/SelectorCategoria.tsx  # F-CAT-08
apps/web/src/lib/categorias.ts                # árbol, validaciones, tipos
apps/web/src/pages/categorias/list.tsx        # árbol + diálogos (F-CAT-08)
apps/web/src/components/categorias/{ArbolCategorias,FormularioCategoria,EliminarCategoriaDialogo}.tsx
docs/catalogo.md, docs/actividad.md, docs/roadmap-template.md
```

## Decisiones técnicas

- **Vista, no tabla**: `v_productos_listado` combina `productos`, imagen principal (`min(posicion)` de `producto_imagenes`) y, luego, empresas y categoría. Sin costo (Decisión 5); MSF-179 la amplía.
- **Paginación**: `range` + `count: 'exact'`; filtros en `where`; orden con `order(col).order('id')`.
- **Empresas en la vista**: arreglo de `empresa_id` (`array_agg`) para chips y filtro `ov`.
- **Árbol de categorías**: una sola consulta plana y armado en cliente (2 niveles); conteo de productos por categoría con una RPC/vista de conteos agrupados dentro de la migración de F-CAT-08.
- **Reordenar**: `reordenar_categorias(p_orden jsonb)` recibe `[{id, padre_id, posicion}]`, toma `pg_advisory_xact_lock` por organización, valida 2 niveles y renumera en una transacción.
- **Eliminar**: `eliminar_categoria(p_id)`: sube hijos a raíz (rechaza choque de nombres), deja `categoria_id = null` en productos, elimina la categoría y emite el evento.

## Riesgos

- `producto_empresa`/`categorias_empresa` no existían aunque MSF-456/MSF-138 los daban por entregados: se crean acá (anotado en spec y PR).
- Tres migraciones reemplazan la misma vista: mitigado repitiendo la definición completa y serializando las historias.
- Rendimiento de la búsqueda: índice trigram; medir con 10 000 filas (SC-001).
- Cambio de contrato de `/productos` (reemplaza la grilla mínima): mantiene ruta, permisos y acciones F-CAT-06; los tests de `list.test.tsx` se actualizan.
