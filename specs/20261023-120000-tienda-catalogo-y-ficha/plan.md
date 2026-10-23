# Implementation Plan: Tiendas online · Tienda catálogo y ficha

**Branch**: `epic/MSF-167-tiendas-online-tienda-catalogo-y-ficha` | **Date**: 2026-10-23 | **Spec**: `specs/20261023-120000-tienda-catalogo-y-ficha/spec.md`

**Delivery scope**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

El visitante de la tienda de una empresa (resuelta por dominio desde MSF-147) navega categorías, filtra y ordena el catálogo de a 24, abre la ficha de un producto y ve «Disponible» / «Sin stock», con el precio final en pesos de la empresa y sin datos internos. Todo se sirve con **funciones de lectura anónima** (`publico`, sin tablas) que reutilizan la visibilidad efectiva de MSF-147, las fórmulas de Precios (MSF-114) y el stock único (MSF-231). Cuatro historias, cada una con su propia migración aditiva y sus archivos de front.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI). Front público en `apps/web/src/pages/tienda-publica/`: ya existe `index.tsx` (resolución por `Host`), `PaginaTienda.tsx` (secciones por glob), `VolvemosPronto.tsx` y `lib/tienda.ts` / `lib/tiendaCatalogo.ts`. Se agrega `rutas/*.tsx` (enrutador por archivo), `layout/` (encabezado, menú, pie de categorías), `secciones-catalogo/*.tsx` y componentes `catalogo/`, `ficha/`, `disponibilidad/`. Ninguna historia edita un archivo que otra también edite.
- **Base**: Postgres self-hosted. Sin tablas nuevas; funciones en `publico` (lectura anónima) y `private` (lógica interna). Verificado en el repo: existen `private.catalogo_tienda_efectivo`, `private.normalizar_host`, `private.a_pesos`, `aplicar_regla_precio`, `aplicar_iva`, `alicuota_producto`, `precio_para`, `private.productos_con_stock`, `dominio.existencias`, `dominio.producto_imagenes` (bucket privado `productos-imagenes`), `dominio.productos.compatible_con`. **No existen** `dominio.categorias.slug` ni función pública de precio final: se crea (precio) o se evita (slug, D10).
- **Estado del código verificado**: `publico.catalogo_visible_por_dominio` (MSF-147) devuelve `precio_lista` y un indicador `tiene_imagen`; se conserva sin cambios.
- **Testing**: pgTAP (`supabase/tests/database/`), Vitest + axe para componentes, Playwright E2E (`apps/web/e2e/`) con los dos dominios del seed. `pnpm test` requiere `pnpm dev:supabase`.
- **Rendimiento**: carga diferida por ruta, imágenes con `loading="lazy"`, una sola llamada RPC por página.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Sin tablas nuevas; `anon` solo ejecuta funciones de `publico`; cada función filtra por el `host` y `empresa.activa`; sin service-role en el navegador. La política de storage para `anon` está acotada por `private.imagen_publica`. |
| II Especificar primero | Esta spec; cada FR/SC tiene una tarea dueña y una verificación. |
| III Idempotencia/auditoría | Solo lecturas (idempotentes); no hay escritura ni evento que auditar. |
| IV Despliegues independientes | Sin Compose nuevo; solo `refine` y `supabase`. |
| V Simplicidad | Sin infraestructura nueva. |
| VI Panel operable | Es front público: estados del kit, teclado, lector de pantalla, 320/768/1440, carga diferida por ruta. |
| VII Esquemas | Sin tablas; funciones en `publico`/`private` según su naturaleza. pgTAP: `publico` sin tablas y `anon` solo ejecuta funciones de `publico`. Re-verificado aquí: coincide con la spec. |
| VIII Empresa activa | No aplica (público anónimo, sin selector); la tienda se resuelve por `Host`. Declarado en la matriz y verificado con el E2E de dos tiendas. |
| Documentación | `docs/tiendas-online.md` (secciones nuevas) en el cierre. |

Regla del proyecto «anon solo ejecuta las RPC de acceso»: se respeta (las funciones públicas viven en `publico`, no en `public`).

## Estructura de migraciones (una por historia, aditivas)

| Historia | Migración | Contenido | Reversión |
|---|---|---|---|
| F-TDA-11 | `20261023120000_tienda_categorias_publicas.sql` | `publico.categorias_por_dominio` + grants | `drop function publico.categorias_por_dominio(text)` |
| F-TDA-18 | `20261023120100_tienda_disponibilidad_publica.sql` | `private.disponible_publico` (sin grants a roles de API) | `drop function private.disponible_publico(uuid)` |
| F-TDA-12 | `20261023120200_tienda_catalogo_publico.sql` | `private.precio_final_publico`, `private.imagen_publica`, política `SELECT` de `anon` en `storage.objects`, `publico.catalogo_pagina_por_dominio` | `drop` de las funciones y de la política |
| F-TDA-13 | `20261023120300_tienda_ficha_publica.sql` | `publico.producto_por_dominio` | `drop function publico.producto_por_dominio(text, uuid)` |

Orden lógico de despliegue (el orquestador lo respeta con el Plan de ejecución): F-TDA-18 antes de F-TDA-12/13 (usan `disponible_publico`) y F-TDA-12 antes de F-TDA-13 (usa `precio_final_publico` e imágenes). Cada migración es autosuficiente en su propio contenido; las funciones que llaman a otra historia se escriben en `plpgsql` (resolución en tiempo de ejecución).

## Contratos

Ver `contracts/tienda-publica.md` (firmas de las tres funciones públicas, las tres internas y las rutas del front). Todo nuevo, aditivo y sin `BREAKING`.

## Frontend

- **F-TDA-11**: `rutas/` (enrutador por glob, carga diferida), `layout/LayoutTienda` (encabezado con marca de MSF-147, menú de categorías, pie «Categorías»), `rutas/categoria.tsx` (migas, título y 404), `PaginaNoEncontrada` y hook `useCategoriasTienda` (cliente de `categorias_por_dominio`).
- **F-TDA-18**: `disponibilidad/EtiquetaDisponibilidad.tsx` (texto «Disponible» / «Sin stock», accesible).
- **F-TDA-12**: `lib/tiendaListado.ts` (cliente RPC + normalización de la query), `catalogo/` (panel de filtros, orden, tarjeta, vacío, paginación), `rutas/catalogo.tsx`, `secciones-catalogo/ListadoProductos.tsx` (también para la categoría), `lib/imagenProducto.ts` (`urlImagenProducto`, D1).
- **F-TDA-13**: `ficha/` (galería, ampliación, bloque de datos, compatibilidad), `lib/tiendaFicha.ts`, `rutas/producto.tsx`.
- Estados de carga/vacío/error del kit; teclado y lector de pantalla; 320/768/1440.

## Verificación

- **pgTAP**: un archivo por historia (`tienda_categorias_publicas`, `tienda_disponibilidad_publica`, `tienda_catalogo_publico`, `tienda_ficha_publica`) en `supabase/tests/database/`: aislamiento entre dos tiendas, `null` idéntico, lista blanca de campos, paridad de precio y disponibilidad, política de imágenes.
- **Vitest + axe**: componentes y páginas de cada historia.
- **E2E (Playwright)** con las dos tiendas del seed: un archivo por historia (`tienda-categorias`, `tienda-catalogo`, `tienda-ficha`, `tienda-disponibilidad`).
- **Rendimiento**: medición en celular del catálogo y la ficha (cierre).
- Cierre: `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`, `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check`.

## Riesgos

- **D1 (imágenes)**: la política de `anon` sobre el bucket privado es un supuesto; si se elige URL pública o firmada cambia una migración y un ayudante.
- **Precio**: duplica la composición de fórmulas de `precio_para` (sin guardia de sesión); el pgTAP de paridad evita la deriva.
- **Rendimiento**: `catalogo_pagina_por_dominio` calcula precio final para filtrar/ordenar por precio; se mide con el seed y se revisa índice/materialización solo si la medición lo exige.
