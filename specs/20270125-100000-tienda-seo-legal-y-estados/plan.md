# Implementation Plan: Tiendas online · Tienda SEO, legal y estados

**Branch**: `epic/MSF-149-tiendas-online-tienda-seo-legal-y-estado` | **Date**: 2026-11-01 | **Spec**: `specs/20270125-100000-tienda-seo-legal-y-estados/spec.md`

**Delivery scope**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Se completa el front público de la tienda (resuelta por dominio desde MSF-147) con cuatro piezas: (F-TDA-19) «Volvemos pronto» con la identidad de la tienda, 404 con buscador y pantalla de error; (F-TDA-20) productos relacionados en la ficha; (F-TDA-21) metadatos, datos estructurados, `robots.txt`, `sitemap.xml` y `noindex`; (F-TDA-22) pie legal por empresa y aviso de cookies con el contrato de consentimiento que usará F-TDA-24. El anónimo solo toca funciones de `publico`; la única tabla nueva es `dominio.tienda_legal_enlaces`. Las cuatro historias son independientes entre sí salvo por archivos compartidos del front (ver *Plan de ejecución* en `tasks.md`).

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI). Front público en `apps/web/src/pages/tienda-publica/`. Verificado en el repo: `index.tsx` (`TiendaPublicaApp`: resuelve la tienda, distingue cargando / error / sin tienda), `VolvemosPronto.tsx` (versión mínima), `PaginaNoEncontrada.tsx` (404 sin buscador), `ErrorConReintento.tsx` (error en línea), `EnrutadorTienda.tsx` (rutas por archivo en `rutas/*.tsx`, `ErrorBoundary` por ruta), `layout/LayoutTienda.tsx` (encabezado con `BuscadorTienda`, `Outlet`, pie con `PieCategorias`), `catalogo/TarjetaProducto.tsx`, `ficha/*`, `rutas/producto.tsx`, `lib/tienda.ts` (`resolverTienda`), `TemaTienda`.
- **Base**: Postgres self-hosted. Verificado: `dominio.empresas` (`activa`, `razon_social`, `cuit`, `direccion`), `dominio.tiendas` (`dominio`), `dominio.tienda_identidad`, `dominio.tienda_contenido` (`subtitulo`), `private.normalizar_host`, `private.catalogo_tienda_efectivo`, `private.precio_final_publico`, `private.disponible_publico`, `publico.identidad_por_dominio`, `publico.destacados_por_dominio` (patrón a imitar). **No existen** `publico.estado_tienda_por_dominio`, `relacionados_por_dominio`, `seo_tienda_por_dominio`, `sitemap_por_dominio`, `legal_por_dominio` ni `dominio.tienda_legal_enlaces`: se crean acá.
- **Edge Function y nginx**: hay otras Edge Functions en `supabase/functions/` y `apps/web/nginx.conf` sirve la SPA estática sin proxys. `robots.txt` y `sitemap.xml` por dominio exigen una ruta dinámica por `Host`: nginx proxea esas dos rutas a la Edge Function `tienda-seo` (URL de Supabase tomada de la misma variable que usa el build, `VITE_SUPABASE_URL`, o del entorno del contenedor). **T062 verifica en el entorno** cómo llega el `Host` original (cabecera `X-Tienda-Host`) y cómo se configura la URL en el contenedor; si no es viable, se frena con el estado del bloqueo en lugar de inventar infraestructura.
- **SPA**: los metadatos se escriben en el cliente (D4). Sin prerender.
- **Testing**: pgTAP (`supabase/tests/database/`), Vitest + axe, Playwright E2E (`apps/web/e2e/`) con los dos dominios del seed. `pnpm test` requiere `pnpm dev:supabase`.
- **Rendimiento**: relacionados, aviso de cookies y buscador de la 404 con carga diferida; una sola llamada RPC por pantalla; el sitemap se calcula en la base con tope.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Tabla nueva con RLS por organización y sin privilegios de API; el anónimo solo ejecuta funciones de `publico` que filtran por el `host`; la única función que distingue «pausada» solo entrega la marca (D1); sin service-role en el navegador (la Edge Function usa el cliente anónimo y solo funciones de `publico`). |
| II Especificar primero | Esta spec; cada FR/SC tiene una tarea dueña y una verificación nombrada. |
| III Idempotencia/auditoría | Solo lecturas (y el consentimiento local): sin efectos que duplicar. |
| IV Despliegues independientes | Sin Compose nuevo; `refine` (nginx de `apps/web`) y `supabase` (migraciones y Edge Function). |
| V Simplicidad | Una tabla; sin prerender ni servicios nuevos; sitemap calculado en una función. |
| VI Panel operable | Front público: estados del kit, teclado, lector de pantalla, 320/768/1440, carga diferida; sin identificadores técnicos en pantalla. |
| VII Esquemas | `dominio.tienda_legal_enlaces` en **`dominio`** (dato de la empresa/producto Tiendas online); funciones en `publico`; nada en `public`. Re-verificado aquí: coincide con la spec. pgTAP de aislamiento recorre `public` + `dominio`. |
| VIII Empresa activa | Pantallas públicas: no aplica (se resuelve por `Host`; declarado en la matriz y verificado con E2E de dos tiendas). La pantalla de Empresas con el interruptor no se modifica. |
| Documentación | `docs/tiendas-online.md` (sección nueva) y `openapi/tienda-seo.json` en el mismo cambio. |

Regla del proyecto «anon solo ejecuta las RPC de acceso»: se respeta (las funciones viven en `publico`); el pgTAP existente sigue pasando.

## Estructura de migraciones (una por historia, aditivas)

| Historia | Migración | Contenido | Reversión |
|---|---|---|---|
| F-TDA-19 | `20270125100000_tienda_estado_pausada.sql` | `publico.estado_tienda_por_dominio` + grants | `drop function publico.estado_tienda_por_dominio(text)` |
| F-TDA-20 | `20270125110000_tienda_relacionados.sql` | `publico.relacionados_por_dominio` + grants | `drop function publico.relacionados_por_dominio(text, uuid)` |
| F-TDA-22 | `20270125120000_tienda_legal.sql` | `dominio.tienda_legal_enlaces` + RLS + índice + check de URL; `publico.legal_por_dominio` + grants | `drop function publico.legal_por_dominio(text)`; `drop table dominio.tienda_legal_enlaces` **en una migración posterior**, no en este PR (regla de aditividad) |
| F-TDA-21 | `20270125130000_tienda_seo.sql` | `publico.seo_tienda_por_dominio`, `publico.sitemap_por_dominio` + grants | `drop function` de ambas |

Ninguna historia modifica objetos de otra; las migraciones no se encadenan. Cada una usa `create or replace function` en `plpgsql`/`sql` con resolución en tiempo de ejecución.

## Contratos

Ver `contracts/tienda-seo-legal-estados.md` (firmas de las funciones, la tabla, la Edge Function y el contrato de consentimiento) y `openapi/tienda-seo.json` (Edge Function, creado en T062). Todo nuevo y aditivo; sin `BREAKING`.

## Frontend por historia (archivos propios)

- **F-TDA-19**: `lib/tiendaEstado.ts` (cliente + hook `useEstadoTienda(host)`), `VolvemosPronto.tsx`, `index.tsx`, `PaginaNoEncontrada.tsx`, `PantallaError.tsx` (nuevo) y `EnrutadorTienda.tsx` (`ErrorDeRuta`).
- **F-TDA-20**: `lib/tiendaRelacionados.ts`, `ficha/Relacionados.tsx` (carga diferida), `rutas/producto.tsx`.
- **F-TDA-22**: `lib/tiendaLegal.ts`, `layout/PieLegal.tsx`, `layout/AvisoCookies.tsx`, `lib/consentimientoCookies.ts`, `layout/PieCategorias.tsx` (monta ambos).
- **F-TDA-21**: `seo/CabeceraSeo.tsx`, `seo/datosEstructurados.ts`, `lib/tiendaSeo.ts`, `supabase/functions/tienda-seo`, `apps/web/nginx.conf`, `openapi/tienda-seo.json`, y los cambios mínimos en `rutas/*.tsx`, `VolvemosPronto.tsx`, `PaginaNoEncontrada.tsx`, `PantallaError.tsx` (por eso depende de F-TDA-19 y F-TDA-20).

## Verificación

- **pgTAP**: `tienda_estado_pausada`, `tienda_relacionados`, `tienda_legal`, `tienda_seo` en `supabase/tests/database/`: lista blanca, `null` idéntico, aislamiento entre dos tiendas, RLS de la tabla, desactivada = desconocida, reactivar cambia el resultado.
- **Vitest + axe**: estados, relacionados, `CabeceraSeo`, datos estructurados, pie legal, aviso de cookies, consentimiento.
- **E2E** (`tienda-estados`, `tienda-relacionados`, `tienda-seo`, `tienda-legal`): dos tiendas, interruptor de Empresas, conexión caída, `robots.txt` / `sitemap.xml`, anchos 320 / 768 / 1440.
- **Revisión SEO** con Lighthouse SEO o equivalente (SC-007), resultado en el PR.
- Gates: `pnpm lint`, `build`, `infra:config`, `test`, `prototipo:check`, `matriz:check`, `docs:check`.

## Riesgos

- **Dos buscadores en la 404** (el del encabezado y el del cuerpo): `BuscadorTienda` usa `useId`, así que no choca; T005 verifica con axe que no haya ids ni roles duplicados.
- **«Volvemos pronto» con identidad revela existencia del dominio** (D1): mitigado entregando solo marca ya pública; Nicolás puede revertir a la genérica eliminando el uso de la función.
- **Proxy de nginx hacia la Edge Function** (T062): puede requerir configuración de despliegue (`docs/deployment.md`); se documenta y se prueba en el entorno.
- **SEO en SPA** (D4): los previews de redes pueden no leer Open Graph; documentado como límite conocido.
- **Datos legales reales pendientes** (D6): el código funciona sin ellos (bloque oculto); la carga real queda a la confirmación del cliente.
- **Archivos compartidos** entre historias: resueltos en el plan de ejecución (F-TDA-21 después de F-TDA-19 y F-TDA-20).
