# Implementation Plan: Catálogo · Catálogo alta y edición

**Spec**: `spec.md` · **Rama**: `epic/MSF-456-catalogo-catalogo-alta-y-edicion` · **Delivery scope**: `refine`, `supabase`

## Summary

Tres tablas nuevas en `dominio` (`productos`, `producto_costos`, `producto_imagenes`), un bucket privado de Storage, RPC de escritura con `security invoker` (rige RLS), disparadores de Actividad y las pantallas de alta, edición y una grilla mínima en `apps/web`. Cada historia trae su propia migración aditiva.

## Technical Context

- Frontend: Refine + MUI en `apps/web`, patrón de `pages/clientes` (lista/alta/edición), kit de panel y sistema de diseño (`docs/sistema-de-diseno.md`); `usePuedeAccion` / `useNivelSeccion` para presentar; la autoridad es RLS.
- Base: Supabase self-hosted; permisos por `private.nivel_seccion(...)` (`docs/permisos-por-rol.md`); Actividad por `private.registrar_actividad` desde disparadores `security definer` (patrón `registrar_actividad_cliente`, `docs/actividad.md`).
- Storage: mismo patrón que `logos-organizacion` (prefijo `<organizacion_id>/`).
- Pruebas: pgTAP (`supabase/tests/database`), Vitest, Playwright (`apps/web/e2e`).

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por `organizacion_id` en las tres tablas y en Storage; sin service-role en el navegador. |
| II Spec antes | Esta spec; tareas referencian FR/SC. |
| VI Panel | Destino «Productos» con ícono en Catálogo, carga diferida, rutas `/productos`, `/productos/create`, `/productos/:id/edit`; sin ids técnicos visibles; teclado/lector; 320/768/1440. |
| VII Esquemas | `productos`, `producto_costos`, `producto_imagenes` → `dominio` (entidades del negocio). Bucket y políticas de `storage.objects` → plataforma. Re-verificar en cada etapa (T023). |
| VIII Docs | `docs/catalogo.md` y actualización de permisos/aislamiento/actividad. |

## Diseño de datos

- **`dominio.productos`**: `id`, `organizacion_id`, `nombre`, `sku` (recortado; si llega vacío lo autogenera M3 como `PRD-` + 8 hex en mayúsculas), `descripcion`, `compatible_con text[]`, `moneda` (`USD`|`ARS`), `precio_lista numeric(14,2) > 0`, `activo boolean default true`, `creado_en`, `updated_at`. Índice único parcial `(organizacion_id, lower(btrim(sku))) where sku is not null` (M3, F-CAT-03).
- **`dominio.producto_costos`**: `producto_id` PK/FK, `organizacion_id`, `costo numeric(14,2) >= 0`, `updated_at`. RLS por sección `rentabilidad`.
- **`dominio.producto_imagenes`**: `id`, `producto_id`, `organizacion_id`, `posicion 1..4`, `ruta` (Storage), `creado_en`; único `(producto_id, posicion)`; disparador que rechaza una quinta.
- Grants por columna: el llamador no fija `organizacion_id`; `anon` sin privilegios; sin DELETE en `productos`/`producto_costos`.
- RPC (grant `authenticated`, `revoke … public, anon`): `crear_producto` (M2), `actualizar_producto` (M4, bloqueo optimista por `updated_at`, rechaza costo sin acceso), `cambiar_estado_producto` (M6).
- Actividad: `producto.creado` (M2), `producto.editado` (M4), `producto.imagen_agregada|eliminada` (M5), `producto.activado|desactivado` (M6); detalle «<nombre> (SKU …)», **sin costo**.

### Migraciones (aditivas, cada una con reversión en el encabezado)

| Mig. | Historia | Contenido |
|---|---|---|
| M1 | F-CAT-02 | `productos`, `producto_costos`, RLS, grants |
| M2 | F-CAT-02 | `crear_producto` + disparador `producto.creado` |
| M3 | F-CAT-03 | índice único de SKU + recorte + disparador `BEFORE INSERT OR UPDATE` que autogenera el SKU vacío (reintenta ante colisión) |
| M4 | F-CAT-04 | `actualizar_producto` + disparador `producto.editado` |
| M5 | F-CAT-05 | `producto_imagenes`, bucket, políticas, tope 4, eventos |
| M6 | F-CAT-06 | `cambiar_estado_producto` + disparador de estado |

Reversión: `drop` de funciones/disparadores/políticas de cada migración en una migración posterior (no en el mismo PR); las tablas se pierden solo si se eliminan, exportar antes. Como M3–M6 no alteran tablas de otra historia, no se encadenan; M1 es el único prerrequisito (dependencia de historia, no de tarea).

## Diseño de frontend

`pages/productos/` (`create.tsx`, `edit.tsx`, `list.tsx` mínima), componentes `FormularioProducto`, `ImagenesProducto`, `lib/productos.ts` (validación y errores), recurso en `SECCION_POR_RECURSO`, destino en `destinosPanel.ts` con `seccionPermiso: 'productos'` y rutas en `RequiereAccesoSeccion` (`App.guard.test.ts` lo verifica). Costo visible según `rentabilidad`. Diferencias con el prototipo (se anotan en el PR): sin stock inicial, variantes, relacionados, escalas, proveedor, código de barras, video ni categoría (el campo queda para MSF-160). El campo SKU muestra «Se genera sola si lo dejás vacío» (el prototipo ya lo dice).

## Seguridad y concurrencia

RLS como autoridad; costo separado por fila; Actividad sin costo; SKU único por índice (dos altas simultáneas con el mismo SKU → una gana, `23505`; SKU vacío → autogenerado distinto en cada una); edición con `updated_at`; imágenes validadas en cliente y servidor (tipo, tamaño, cantidad); URLs firmadas de corta vida.

## Pruebas

pgTAP por historia (aislamiento entre dos organizaciones, permisos por rol, unicidad con concurrencia, imágenes y Storage); Vitest por pantalla; E2E de punta a punta (T025). `rls_en_toda_tabla` debe seguir verde con las tres tablas en `dominio`.

## Documentación

`docs/catalogo.md` (modelo, permisos, costo, SKU, imágenes, reversión), `docs/permisos-por-rol.md`, `docs/aislamiento-por-organizacion.md`, `docs/actividad.md` (eventos `producto.*`), `docs/roadmap-template.md` al cierre.

## Re-verificación de esquemas (T023, Principio VII)

Revisada contra spec, este plan y las migraciones `20261017120100`–`20261017120600`:

| Objeto | Esquema declarado | Esquema en la migración | RLS |
|---|---|---|---|
| `productos` | `dominio` | `dominio.productos` (M1) | habilitada (M1) |
| `producto_costos` | `dominio` | `dominio.producto_costos` (M1) | habilitada (M1) |
| `producto_imagenes` | `dominio` | `dominio.producto_imagenes` (M5) | habilitada (M5) |
| Bucket `productos-imagenes` y políticas `productos_imagenes_*` | plataforma (`storage`) | `storage.buckets` / `storage.objects` (M5) | políticas por prefijo `<organizacion_id>/` |

Resultado: coinciden; ninguna tabla del catálogo quedó en `public`. Las RPC (`crear_producto`, `actualizar_producto`,
`cambiar_estado_producto`) viven en `public` por ser la superficie de la API, con `revoke … public, anon` y `grant … authenticated`.
`rls_en_toda_tabla` recorre `public` y `dominio`.
