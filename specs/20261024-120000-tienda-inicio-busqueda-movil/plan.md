# Implementation Plan: Tiendas online · Tienda inicio búsqueda móvil

**Branch**: `epic/MSF-191-tiendas-online-tienda-inicio-busqueda-mo` | **Date**: 2026-10-24 | **Spec**: `specs/20261024-120000-tienda-inicio-busqueda-movil/spec.md`

**Delivery scope**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Sobre el front público de la tienda (MSF-147/MSF-167) se completan tres cosas: la **home** (banner, categorías con conteo, destacados con precio final y disponibilidad, estado «Catálogo en preparación»), el **buscador** del encabezado (sugerencias de hasta 6 mientras se escribe, tolerante a tildes, mayúsculas y errores de tipeo con `unaccent` + `pg_trgm`, con límite de pedidos por visitante y minuto) y la **versión móvil completa** (menú desplegable, panel de filtros, ficha, adaptación de todas las pantallas a 360/390/412/430/768/1024 px, error con reintento y rendimiento < 3 s). Tres historias; cada una con sus archivos y, cuando toca la base, su propia migración aditiva.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/tienda-publica/`. Existen (verificado): `rutas/{inicio,catalogo,categoria,producto}.tsx`, `layout/{LayoutTienda,MenuCategorias,PieCategorias}.tsx`, `catalogo/{TarjetaProducto,PanelFiltros,Ordenar,Paginacion,EstadoVacio}.tsx`, `secciones-catalogo/ListadoProductos.tsx`, `ficha/*`, `disponibilidad/EtiquetaDisponibilidad.tsx`, `PaginaNoEncontrada.tsx`, `secciones/{BannerHome,BarraBienvenida,PieTienda,ProductosTienda,TemaTienda}.tsx` (carga por glob con `orden`). Se agregan: `secciones/{CategoriasInicio,DestacadosInicio,EstadoPreparacion}.tsx` (F-TDA-10), `layout/BuscadorTienda.tsx` + `lib/tiendaBusqueda.ts` (F-TDA-15), `layout/MenuMovil.tsx`, `catalogo/PanelFiltrosMovil.tsx`, `ErrorConReintento.tsx` (F-TDA-17).
- **Base**: Postgres self-hosted. Verificado en el repo: `private.catalogo_tienda_efectivo`, `private.normalizar_host`, `private.precio_final_publico`, `private.disponible_publico`, `publico.categorias_por_dominio`, `publico.catalogo_pagina_por_dominio`, `pg_trgm` (migraciones `20261016160000…` y `20261020120101…`). **No existen**: la extensión `unaccent`, una función de normalización de búsqueda, ninguna tabla de control de pedidos ni `publico.destacados_por_dominio` (precio final para los destacados): se proponen como migraciones (no se inventan).
- **Estado del código verificado**: `ProductosTienda` (MSF-147) lista destacados con `precio_lista`; F-TDA-10 lo reemplaza por `DestacadosInicio` con el precio final (D8 de MSF-167). `BannerHome` ya trae título, subtítulo y botón configurables: se reutiliza.
- **Testing**: pgTAP (`supabase/tests/database/`), Vitest + axe, Playwright E2E (`apps/web/e2e/`) con los dos dominios del seed y proyectos de ancho de escritorio y de celular. `pnpm test` requiere `pnpm dev:supabase`.
- **Rendimiento**: una llamada RPC por bloque/pantalla; sugerencias con espera corta entre teclas y cancelación de respuestas viejas; buscador, menú y panel móvil de carga diferida; imágenes `loading="lazy"`.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | `anon` solo ejecuta funciones de `publico`; cada función filtra por el `host` y `empresa.activa`; la tabla nueva `public.limite_pedidos_publicos` tiene RLS activada, sin políticas ni grants (solo `SECURITY DEFINER`); no guarda la IP, solo un hash; sin service-role en el navegador. |
| II Especificar primero | Esta spec; cada FR/SC tiene una tarea dueña y una verificación. |
| III Idempotencia/auditoría | Lecturas idempotentes; el contador del límite es atómico (`insert … on conflict do update`) y se purga solo. No hay evento de negocio que auditar. |
| IV Despliegues independientes | Sin Compose nuevo; solo `refine` y `supabase`. |
| V Simplicidad | Sin motor externo: `unaccent` + `pg_trgm`; sin worker ni cron para purgar (limpieza oportunista). |
| VI Panel operable | Front público: estados del kit, teclado, lector de pantalla, 320–1440 px (más 360/390/412/430/768/1024), carga diferida del peso nuevo. |
| VII Esquemas | Tabla nueva `public.limite_pedidos_publicos` (control transversal → `public`); índice sobre `dominio.productos` (dominio); funciones en `publico`/`private`. Re-verificado aquí: coincide con la spec. pgTAP de aislamiento cubre la tabla nueva. |
| VIII Empresa activa | No aplica (público anónimo, sin selector); la tienda se resuelve por `Host`. Declarado en la matriz y verificado con el E2E de dos tiendas. |
| Documentación | `docs/tienda-busqueda.md` y `docs/tienda-movil.md` (nuevos, por historia) + `docs/tiendas-online.md` en el cierre. |

Regla del proyecto «`anon` solo ejecuta las RPC de acceso»: se respeta como en MSF-167 (las funciones públicas viven en `publico`, no en `public`; `revoke … from public, anon` + `grant execute … to anon, authenticated` explícito; la tabla nueva de `public` nace sin privilegios).

## Estructura de migraciones (aditivas, autosuficientes por historia)

| Historia | Migración | Contenido | Reversión |
|---|---|---|---|
| F-TDA-10 | `20261202100000_tienda_destacados_publicos.sql` | `publico.destacados_por_dominio(host)` + grants | `drop function publico.destacados_por_dominio(text)` |
| F-TDA-15 | `20261202110000_tienda_busqueda_base.sql` | `unaccent`, `private.normalizar_busqueda`, índice trigrama, tabla `public.limite_pedidos_publicos` (RLS, sin grants), `private.registrar_pedido_publico` | `drop function private.registrar_pedido_publico(text,int)`; `drop table public.limite_pedidos_publicos`; `drop index dominio.productos_nombre_busqueda_trgm`; `drop function private.normalizar_busqueda(text)` |
| F-TDA-15 | `20261202110100_tienda_busqueda_sugerencias.sql` | `publico.sugerencias_busqueda_por_dominio` + grants | `drop function …` |
| F-TDA-15 | `20261202110200_tienda_busqueda_resultados.sql` | `publico.busqueda_pagina_por_dominio` + grants | `drop function …` |
| F-TDA-17 | — | Sin migración (solo front) | — |

Las tres migraciones de F-TDA-15 se ordenan por timestamp dentro de la misma historia. F-TDA-10 y F-TDA-15 no comparten tabla, función ni archivo, y no se encadenan entre sí. Las funciones que llaman a las de MSF-167 se escriben en `plpgsql` (resolución en ejecución). Los timestamps van después de la última migración de `main` para no quedar fuera de orden.

## Contratos

Ver `contracts/tienda-inicio-busqueda.md` (firmas de las tres funciones públicas nuevas, las dos internas y el uso de `q` en `/catalogo`). Todo nuevo, aditivo y sin `BREAKING` (no cambia `catalogo_pagina_por_dominio` ni `catalogo_visible_por_dominio`).

## Frontend

- **F-TDA-10**: `secciones/CategoriasInicio.tsx` (orden 40), `secciones/DestacadosInicio.tsx` (orden 50, reemplaza a `ProductosTienda`), `secciones/EstadoPreparacion.tsx`, `lib/tiendaInicio.ts` (cliente de `destacados_por_dominio` + hook que sabe si hay productos visibles). `BannerHome` (orden 20) y `TarjetaProducto` se reutilizan sin cambios.
- **F-TDA-15**: `lib/tiendaBusqueda.ts` (cliente RPC, normalización de `q`, constantes únicas del mínimo y de la espera), `layout/BuscadorTienda.tsx` (combobox accesible, carga diferida) montado en `LayoutTienda`, `rutas/catalogo.tsx` y `ListadoProductos` leen `q` y llaman a `busqueda_pagina_por_dominio` (título «Resultados para…», migas «Inicio / Resultados»).
- **F-TDA-17**: `layout/MenuMovil.tsx` (carga diferida), `catalogo/PanelFiltrosMovil.tsx` (carga diferida, incluye «Precio máximo»), ficha en una columna con galería táctil, `ErrorConReintento.tsx`, y el repaso responsivo de todas las pantallas.
- Archivos compartidos: `LayoutTienda.tsx` y `ListadoProductos.tsx` los toca F-TDA-15 y luego F-TDA-17 (Plan de ejecución: grupos distintos).

## Verificación

- **pgTAP**: `tienda_destacados_publicos`, `tienda_busqueda_publica` (tildes, mayúsculas y tipeo sobre el seed, tope 6, límite, aislamiento, lista blanca, RLS de la tabla nueva).
- **Vitest + axe**: home, buscador, resultados, menú móvil, panel de filtros móvil, ficha móvil, `ErrorConReintento`.
- **E2E (Playwright)** con las dos tiendas del seed, en ancho de **escritorio** y de **celular** (360/390/412/430) y tableta (768/1024): `tienda-inicio`, `tienda-busqueda`, `tienda-movil`.
- **Rendimiento**: emulación móvil «4G lento» (D9), contenido principal < 3 s en home, catálogo y ficha, anotado en `docs/tienda-movil.md`.
- Cierre: `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`, `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check`.

## Riesgos

- **D1 (número del límite)**: 30/min es un supuesto; una constante única en la base lo cambia.
- **D3 (identidad del visitante)**: depende de que PostgREST/proxy propague `x-forwarded-for`. Si no llega, todos comparten el grupo «desconocido» y el límite pega a todos juntos; se verifica en DEV en la tarea de pgTAP/E2E y, si falla, se anota como desvío con seguimiento.
- **Rendimiento de la búsqueda**: el índice trigrama sobre `dominio.productos` cubre el nombre; se mide con el seed y se revisa solo si la medición lo exige. La búsqueda también calcula precio final para las sugerencias (hasta 6) y para la página (24).
- **Conflicto de archivos compartidos** (`LayoutTienda`, `ListadoProductos`): mitigado serializando F-TDA-17 después de F-TDA-10 y F-TDA-15.
- **Tabla nueva en `public`**: el pgTAP de aislamiento exige RLS; si exigiera además `organizacion_id`, se declara la excepción (tabla de control anónima, sin organización) en esa prueba.
