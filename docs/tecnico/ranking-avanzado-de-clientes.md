---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ranking avanzado de clientes: RPC y pantallas (MSF-171)

**Épica:** MSF-171 — Clientes y proveedores · Ranking avanzado de clientes. **Historias:** F-CLI-14 (MSF-384),
F-CLI-15 (MSF-391), F-CLI-16 (MSF-400). **Alcance de entrega:** `refine` + `supabase` (sin `kestra`, `superset` ni
`workers`). **Spec:** `specs/20261028-100000-ranking-avanzado-de-clientes/` (`spec.md`, `plan.md`, `tasks.md`,
`contracts/ranking-avanzado-de-clientes.md`). Guía de producto:
[Ranking avanzado](../producto/ranking-avanzado-de-clientes.md). Base:
[Ranking de clientes (MSF-126)](ranking-de-clientes.md).

> **Estado (verificado en git al 2026-10-31):** el código está en la rama de la épica
> `epic/MSF-171-clientes-y-proveedores-ranking-avanzado-` (merges de los PR #541, #543 y #544; tip `a5bfa010`),
> **no en `main`**. Las rutas y migraciones de abajo se verificaron en ese árbol. Las tareas de cierre T019–T021
> siguen `[ ]`. TODO (dueño: quien cierre la épica): confirmar el merge a `main`.

## Datos

**Sin tablas ni columnas nuevas** (las tres migraciones solo hacen `create function`; Principio VII: funciones de
aplicación en `public`, lectura de `dominio` y `public`). No cambia el DER ni `datos.md`. Lectura sobre:

| Objeto | Esquema | Lo usa |
|---|---|---|
| `comprobantes_venta` | `dominio` | las tres RPC |
| `comprobantes_venta_lineas`, `productos`, `categorias` | `dominio` | `ranking_clientes_por_dimension` |
| `clientes`, `clientes_empresas` | `public` | las tres RPC (filtro de tienda con `p_empresa_id`) |

## API (RPC de lectura)

Las tres son `security definer`, `search_path = ''`, organización de `private.organizacion_id()`, exigen
`private.nivel_seccion('clientes')` en `lectura`/`edicion` (si no, `42501`), `revoke execute … from public, anon` y
`grant execute … to authenticated`. Reutilizan `private.comprobante_cuenta_como_facturado` y
`private.signo_comprobante` (criterio de MSF-126). **`public.ranking_clientes` no se altera.**

| RPC | Migración | Contrato |
|---|---|---|
| `public.ranking_clientes_comparado(p_desde, p_hasta, p_desde_comparacion, p_hasta_comparacion, p_tipo, p_incluir_consumidor_final, p_con_iva, p_pagina, p_tamano, p_empresa_id)` | `20270120100000_ranking_clientes_comparado.sql` | Devuelve `posicion`, `cliente_id`, `numero`, `nombre`, `tipo`, `comprobantes`, `facturado`, `comprobantes_comparacion`, `facturado_comparacion`, `variacion`, `variacion_porcentaje`, `total_filas`. Valida ambos rangos (completos, Desde ≤ Hasta, máx. 5 años). Orden: facturado, facturado de la comparación, nombre, número |
| `public.ranking_clientes_por_dimension(p_desde, p_hasta, p_producto_id, p_categoria_id, p_provincia, p_tipo, p_incluir_consumidor_final, p_con_iva, p_pagina, p_tamano, p_empresa_id)` | `20270121100000_ranking_clientes_por_dimension.sql` | Mismas columnas que `ranking_clientes` (`participacion` sobre el conjunto filtrado completo). Con producto/categoría suma **líneas**; categoría raíz incluye subcategorías; provincia sin mayúsculas ni tildes vía `private.clave_texto`; `p_provincia` ≤ 100 caracteres; producto/categoría ajenos → vacío |
| `public.clientes_inactivos(p_dias, p_tipo, p_incluir_consumidor_final, p_pagina, p_tamano, p_empresa_id)` | `20270116120000_clientes_inactivos.sql` | Devuelve `cliente_id`, `numero`, `nombre`, `tipo`, `ultima_compra`, `dias_sin_comprar`, `comprobantes`, `facturado`, `total_filas`. `p_dias` 1–3650; última **factura** que cuenta `< hoy − N` (hoy en `America/Argentina/Buenos_Aires`); excluye sin compras y archivados; `facturado` neto sin IVA; orden última compra, nombre, número |

Nota de versión: el contrato de la spec nombraba `20270114110000`/`20270114120000`/`20270114100000`, pero esas
versiones quedaban por debajo de la cola aplicada; se usaron versiones mayores (ver el encabezado de cada migración y
commits `5c413298`, `68778722`).

## Flujo y pantallas

- `apps/web/src/lib/periodosRanking.ts`: período anterior de igual duración y validación de dos rangos.
- F-CLI-14: `hooks/useRankingComparado.ts` y `components/clientes/RankingComparado.tsx`, montados desde
  `components/clientes/RankingClientes.tsx` (interruptor «Comparar con otro período»).
- F-CLI-15: `hooks/useRankingPorDimension.ts`, `hooks/useOpcionesDimension.ts` (opciones de carga diferida) y
  `components/clientes/FiltrosDimension.tsx`; `RankingClientes.tsx` llama a `ranking_clientes_por_dimension` solo si
  hay algún filtro nuevo; si no, a `ranking_clientes`. No se combina con la comparación y oculta «Exportar a Excel»
  con un filtro de dimensión activo (commit `fd4ebe8b`).
- F-CLI-16: `hooks/useClientesInactivos.ts`, `lib/diasInactivos.ts` y `components/clientes/ClientesInactivos.tsx`,
  tercera solapa en `pages/clientes/list.tsx` (carga diferida, visible con `lectura`/`edicion`).
- **Empresa activa:** se pasa como `p_empresa_id`; al cambiarla se vuelve a la página 1, se recargan las consultas y no
  se muestran filas de la tienda anterior (commits `e3e349c9`, `23c29c1a`); en F-CLI-15 se descartan los filtros.
- Fix relevante: sin filtro de producto el total del comprobante se suma una sola vez (commit `06284896`).

## Operación y reversión

- Migraciones **aditivas**; reversión en el encabezado de cada una:
  `drop function public.ranking_clientes_comparado(date, date, date, date, text, boolean, boolean, integer, integer, uuid)`,
  `drop function public.ranking_clientes_por_dimension(date, date, uuid, uuid, text, text, boolean, boolean, integer, integer, uuid)`,
  `drop function public.clientes_inactivos(integer, text, boolean, integer, integer, uuid)`.
  Un `git revert -m 1` del PR de la épica deshace todo.
- Pruebas: pgTAP `ranking_clientes_comparado.test.sql`, `ranking_clientes_por_dimension.test.sql`,
  `clientes_inactivos.test.sql`; Vitest `periodosRanking.test.ts`, `useRankingComparado.test.tsx`,
  `useRankingPorDimension.test.tsx`, `useOpcionesDimension.test.tsx`, `FiltrosDimension.test.tsx`,
  `useClientesInactivos.test.ts`, `ClientesInactivos.test.tsx`, `RankingClientes.test.tsx`. Sin E2E (pendiente; ver la
  guía de producto). `rls_en_toda_tabla` y la auditoría de `anon` deben seguir verdes.
- Detalle por historia también en `docs/clientes.md` (secciones de MSF-384, MSF-391 y MSF-400 en la rama de la épica).

## Fuera de alcance / decisiones abiertas

- Superset embebido (la spec eligió consultas propias; TODO dueño: Nicolás Jones, confirmar), Excel de las tres vistas,
  combinar comparación con dimensiones y enviar inactivos a una campaña (MSF-155).
- Épica de «rentabilidad (Superset, Etapa 2)» sin confirmar (TODO dueño: producto).
