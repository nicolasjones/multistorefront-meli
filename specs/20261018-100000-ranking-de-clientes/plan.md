# Implementation Plan: Clientes y proveedores · Ranking de clientes

**Branch**: `epic/MSF-126-clientes-y-proveedores-ranking-de-client` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

## Summary

Se agrega el ranking básico de clientes por facturación (F-CLI-08), su exportación a Excel (F-CLI-09) y el historial de compras en la ficha (F-CLI-10). Todo es **lectura** sobre un contrato de datos de venta (`dominio.comprobantes_venta`) que esta épica materializa en su mínimo y que Ventas (MSF-159/177) completa. Una sola función SQL (`public.ranking_clientes`) alimenta la pantalla y el Excel; un solo predicado (`private.comprobante_cuenta_como_facturado`) fija qué comprobantes suman, para la pantalla, el Excel y la ficha. Sin Superset, Kestra ni workers.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL en `supabase/migrations`

**Dependencies**: Refine, MUI y `write-excel-file` (MIT) — ya presentes desde MSF-180; **sin dependencias nuevas** (la carga sigue siendo diferida con `import()` al exportar).

**Storage**: Postgres self-hosted (Supabase). Tabla nueva `dominio.comprobantes_venta`; `public.clientes` sin cambios.

**Testing**: Vitest + Testing Library; pgTAP en `supabase/tests/database/`. Sin E2E propio (no hay suite Playwright de la app); los criterios se cubren con pgTAP + Vitest.

**Delivery scope**: `refine`, `supabase`

**Constraints**: migraciones aditivas; nunca service-role en el navegador; `anon` sin acceso; sin copiar HTML/CSS del prototipo; Supabase self-hosted (no Cloud); fechas en `America/Argentina/Buenos_Aires`.

## Constitution Check

- **I / VII**: `dominio.comprobantes_venta` (nueva) es entidad de negocio → **`dominio`**, con RLS por organización y sección `ventas` (solo `select`). Esquema verificado en spec, plan, tareas (T001, T018) e implementación. `public.clientes` no se toca. Sin excepciones de esquema.
- **II**: spec con permisos, fallos, auditoría (no hay escritura → sin eventos de actividad) y datos. ✔
- **III**: todo es lectura idempotente; la exportación por lotes se puede reintentar sin efectos. ✔
- **VI**: sin cambios de navegación (la solapa vive en `/clientes`, la sección en `/clientes/show/:id`); patrones compartidos de carga/vacío/error/éxito; teclado, lector y 320/768/1440 px; sin UUID visible; el código de la solapa y de Compras se carga de forma diferida (`React.lazy`) para no engordar el listado. ✔
- **VIII**: `docs/clientes.md` (ranking, compras, contrato de datos de venta) y `docs/permisos-por-rol.md`. ✔
- Complexity Tracking: ninguna desviación.

## Diseño de datos

Todas las migraciones son aditivas, con reversión en su encabezado. Prefijo de timestamp > `20261017180000` (último en `main`).

### M1 · `20261018100000_ventas_contrato_comprobantes.sql` (F-CLI-08, T001)

1. `create table dominio.comprobantes_venta` con las columnas del contrato de la spec; `unique (id, organizacion_id)`; FK compuesta `(cliente_id, organizacion_id) → public.clientes (id, organizacion_id)` (si `clientes` no expone esa unicidad, el índice único `(id, organizacion_id)` se agrega en esta migración, aditivo); `check (tipo in ('factura','presupuesto'))`, `check (total_sin_iva >= 0 and total_con_iva >= total_sin_iva)`, `check (btrim(numero) <> '')`.
2. Índices: `(organizacion_id, cliente_id, fecha desc)` para ficha y ranking; `(organizacion_id, fecha)` para el barrido por período.
3. `alter table … enable row level security` + política `select` con `organizacion_id = (select private.organizacion_id())` y `(select private.nivel_seccion('ventas')) in ('lectura','edicion')`. Sin políticas ni grants de escritura; `revoke all … from anon, public`; `grant select … to authenticated`.
4. `comment on table` documentando que Ventas escribe y completa el contrato por migraciones aditivas.

**Reversión** (migración posterior, no en el mismo PR; exportar antes los datos si Ventas ya escribe): `drop table dominio.comprobantes_venta`.

### M2 · `20261018100100_clientes_ranking.sql` (F-CLI-08, T002)

1. `private.comprobante_cuenta_como_facturado(p_tipo text, p_estado text) returns boolean` — `immutable`, `language sql`: `p_tipo = 'factura' and p_estado <> 'anulada'`. **Único lugar** donde se fija el criterio de Ventas.
2. `public.ranking_clientes(p_desde date, p_hasta date, p_tipo text default null, p_incluir_consumidor_final boolean default false, p_con_iva boolean default false, p_pagina integer default 1, p_tamano integer default 25)` → `table (posicion bigint, cliente_id uuid, numero integer, nombre text, tipo text, comprobantes bigint, facturado numeric, participacion numeric, total_filas bigint)`:
   - `security definer`, `set search_path = ''`, `stable`; organización = `private.organizacion_id()`; exige `private.nivel_seccion('clientes') in ('lectura','edicion')` (si no, `raise exception … using errcode = '42501'`).
   - Valida parámetros (FR-007).
   - Agrega por cliente sobre `dominio.comprobantes_venta` unido a `public.clientes` por `(id, organizacion_id)`, filtrando organización, `fecha between p_desde and p_hasta`, el predicado único, tipo y Consumidor final; suma `total_con_iva` o `total_sin_iva` según `p_con_iva`; la participación usa `sum(facturado) over ()` sobre el conjunto completo; orden `facturado desc, lower(nombre), numero`; `limit/offset` y `count(*) over ()` para `total_filas`.
   - `revoke … from public, anon`; `grant execute … to authenticated`.
3. Sin cambios sobre `public.clientes` (FR-016).

**Reversión**: `drop function public.ranking_clientes(date,date,text,boolean,boolean,integer,integer); drop function private.comprobante_cuenta_como_facturado(text,text);`

### M3 · `20261018100200_clientes_compras.sql` (F-CLI-10, T012) — migración **propia** de la historia

`public.compras_de_cliente(p_cliente_id uuid, p_pagina integer default 1, p_tamano integer default 10)` → `table (facturado_anio numeric, numero text, fecha date, tipo text, estado text, total_sin_iva numeric, total_filas bigint)`: `security definer`, `search_path = ''`, organización de `private.organizacion_id()`, exige sección `clientes` en `lectura`/`edicion`; verifica que `p_cliente_id` sea de la organización (si no, devuelve cero filas); `facturado_anio` = suma de `total_sin_iva` del año en curso (1/ene → hoy, zona de la organización) con el predicado de M2; el listado incluye todos los comprobantes del cliente (con su estado), `fecha desc, numero desc`, paginado. `revoke … from public, anon`; `grant execute … to authenticated`. Reutiliza `private.comprobante_cuenta_como_facturado` (F-CLI-10 depende de F-CLI-08 mergeada). Si el cliente no tiene comprobantes, una fila centinela con `facturado_anio = 0` y `numero is null` permite mostrar `$ 0` sin una segunda llamada.

**Reversión**: `drop function public.compras_de_cliente(uuid,integer,integer);`

## Diseño de frontend

- `lib/periodosRanking.ts`: atajos (`este-mes`, `mes-anterior`, `ultimos-90-dias`, `anio-en-curso`) calculados en zona `America/Argentina/Buenos_Aires`, validación de rango (Desde ≤ Hasta, máx. 5 años) y formateo.
- `hooks/useRankingClientes.ts`: llama `supabaseClient.rpc('ranking_clientes', …)` con `useQuery` (clave con parámetros, datos previos entre páginas); estados cargando/vacío/error.
- `components/clientes/RankingClientes.tsx`: formulario (Desde, Hasta, Aplicar, atajos, tipo de cliente, interruptor Consumidor final, Ver con IVA), tabla con barra de participación (`ContenidoAdaptable`: tarjetas en angosto), paginación de servidor, enlace del cliente a su ficha, botón «Exportar a Excel» (T011).
- `pages/clientes/list.tsx`: solapas «Listado» / «Ranking por facturación» (`role="tablist"`; el ranking se carga con `React.lazy`); la solapa depende de `SECCION_POR_RECURSO.clientes` (lectura/edición).
- `lib/exportarRanking.ts`: reutiliza `neutralizarFormula` y el patrón de `exportarClientes.ts`; itera `ranking_clientes` por lotes de 1.000 hasta cubrir `total_filas` (tope 100.000), hoja «Ranking de clientes», encabezados en la primera fila, texto neutralizado, importes y porcentaje numéricos, fila de contexto con período y base; progreso y cancelación (`AbortController`).
- `hooks/useComprasCliente.ts` y `components/clientes/ComprasCliente.tsx`: «Resumen comercial» (total facturado del año) + «Últimos comprobantes» (número, fecha, estado, total) paginado; montado en `pages/clientes/show.tsx`.
- Sin cambios en `App.tsx`, menú ni `destinosPanel.ts`.

## Seguridad y concurrencia

Revisión `authz-security` y `database-reviewer` (T018): las dos funciones son `security definer` con `search_path = ''`, organización tomada del servidor, sección `clientes` verificada dentro de la función (la RLS de `comprobantes_venta` exige `ventas`, por lo que el ranking no depende de que el usuario lea esa tabla); `revoke` a `public`/`anon` y `grant` a `authenticated`; sin escritura. Parámetros validados y acotados (rango, página, tamaño). Sin SQL dinámico. Lecturas `stable`, sin bloqueos ni condiciones de carrera relevantes (el único efecto de concurrencia es la lectura paginada de datos que cambian; documentado en la spec).

## Pruebas

- pgTAP `ranking_clientes.test.sql` (T003): período con extremos inclusivos, orden y desempate, anuladas y presupuestos que no suman, filtros de tipo/Consumidor final/IVA, participación = 100 %, paginación con `total_filas`, validaciones de parámetros, `ninguno`/`lectura`/`edicion`, otra organización aislada, `anon` sin ejecución.
- pgTAP `comprobantes_venta_contrato.test.sql` (T004): RLS por organización y sección `ventas`, sin escritura para `authenticated`, FK cruzada rechazada, `rls_en_toda_tabla` y `aislamiento_organizaciones` siguen verdes.
- pgTAP `clientes_compras.test.sql` (T013): total del año, listado paginado y ordenado, vacío (cliente sin compras → $ 0), cliente ajeno/inexistente, permisos y `anon`.
- Vitest: ranking (T008), exportación (T010, T011), ficha de compras (T016).
- Datos de ejemplo (T005): `supabase/seed.sql` (solo local) con comprobantes de varios clientes y meses; los pgTAP crean sus propios datos.

## Documentación

`docs/clientes.md` (sección Ranking y Compras: criterio de facturación, base sin/con IVA, contrato `dominio.comprobantes_venta` para Ventas, exportación, reversión) y `docs/permisos-por-rol.md` (quién ve el ranking). Principio VIII.
