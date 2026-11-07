# Implementation Plan: Tiendas online · Tienda contenido y analítica

**Branch**: `epic/MSF-164-tiendas-online-tienda-contenido-y-analit` | **Date**: 2026-11-07 | **Spec**: `specs/20270210-100000-tienda-contenido-y-analitica/spec.md`

**Delivery scope**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Tres historias independientes sobre la tienda pública y su gestión: (F-TDA-23) páginas de texto propias por empresa, administradas en una pestaña nueva y publicadas en `/pagina/:slug` y en el pie; (F-TDA-24) IDs de GA4 y Meta Pixel por empresa, cargados solo en la tienda publicada y con consentimiento de cookies (MSF-149), con visita de página y los eventos de WhatsApp y contacto de MSF-212; (F-TDA-25) botón «Compartir» en la ficha (selector del sistema o copiar enlace).

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI). Front público en `apps/web/src/pages/tienda-publica/` (`EnrutadorTienda.tsx` con rutas por archivo en `rutas/*.tsx`, `layout/PieCategorias.tsx`, `ficha/`, `whatsapp/DialogoWhatsApp.tsx`, `contacto/FormularioContacto.tsx`). Gestión en `apps/web/src/pages/empresas/tienda/` con pestañas por archivo en `pestanas/` registradas en `pestanas.ts` (patrón de MSF-133).
- **Base**: Postgres self-hosted. Patrón de `20261023100200_tienda_contenido.sql` (RPC `SECURITY DEFINER` con `private.nivel_seccion('empresas')`, `publico.*` de lectura anónima). Las dos tablas son de `dominio`; `publico` sin tablas.
- **Verificado en el repo (grafo + migraciones)**: existen `dominio.empresas`, `dominio.tienda_contenido`, `dominio.tiendas`, `private.normalizar_host`, `private.nivel_seccion`. **No existen** `tienda_paginas`, `tienda_analitica` ni sus funciones: se crean con migración. `lib/consentimientoCookies.ts` y `CabeceraSeo` **vienen de MSF-149** (no están aún en `main`).
- **Testing**: pgTAP (`supabase/tests/database/`), Vitest + axe, Playwright E2E (`apps/web/e2e/`) con los dos dominios del seed. `pnpm test` requiere `pnpm dev:supabase`.
- **Rendimiento**: pestañas y ruta de página con `lazy`; scripts de medición inyectados de forma asíncrona y solo con consentimiento; una consulta por visita para la analítica y una para el pie.
- **Seguridad**: texto siempre como dato (React escapa; sin `dangerouslySetInnerHTML`); IDs de medición validados por formato en base y cliente y pasados como datos al script oficial; scripts solo de `googletagmanager.com` y `connect.facebook.net`; no se envían datos del visitante en los eventos. Si el nginx de `apps/web` o el proxy de la tienda aplica una CSP, hay que permitir esos dos orígenes (no hay CSP en el repo hoy).

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Dos tablas con RLS por organización, solo `select` a `authenticated`, sin privilegios para `anon`; el anónimo solo ejecuta funciones de `publico` que filtran por `host` y `empresa.activa`; sin service-role en el navegador. |
| II Especificar primero | Esta spec; cada FR/SC tiene tarea dueña y verificación. |
| III Idempotencia/auditoría | Guardar es idempotente (mismo valor, mismo resultado); `updated_at` en cada fila; el evento de medición no altera la acción del visitante. |
| IV Despliegues independientes | Solo `apps/web` y `supabase`; sin Compose nuevo. |
| V Simplicidad | Sin infraestructura nueva; sin Edge Function. |
| VI Panel operable | Dos pestañas dentro de la gestión existente (ruta nueva por pestaña, sin cambios de menú); patrones de carga/vacío/error/éxito; teclado y 320/768/1440 px; sin ids visibles; carga diferida. |
| VII Esquemas | `dominio.tienda_paginas` y `dominio.tienda_analitica` en **`dominio`** (datos del producto Tiendas online), RLS por organización; funciones de lectura en `publico`, de escritura en `public`. Re-verificar en tareas, implementación y PR. |
| VIII Empresa activa | Pestañas del panel: aplica y se reencuadra (FR-004, FR-013). Front público: no aplica (Host). |
| Documentación | `docs/tiendas-online.md` (sección «Contenido y analítica»), esta spec y el contrato; `pnpm docs:check`. |

## Esquema y migraciones (aditivas, con reversión)

| Migración | Historia | Crea | Reversión (documentada, no se ejecuta en el mismo PR) |
|---|---|---|---|
| `20270210100000_tienda_paginas.sql` | F-TDA-23 | `dominio.tienda_paginas`, RLS, `public.guardar_pagina_tienda`, `public.eliminar_pagina_tienda`, `publico.paginas_por_dominio`, `publico.pagina_por_dominio` | Migración posterior `drop function … ; drop table dominio.tienda_paginas;` |
| `20270212200002_tienda_analitica.sql` | F-TDA-24 | `dominio.tienda_analitica`, RLS, `public.guardar_analitica_tienda`, `publico.analitica_por_dominio` | Migración posterior `drop function … ; drop table dominio.tienda_analitica;` |

Cada historia trae la suya y no se encadenan entre sí. F-TDA-25 no tiene migración. La reversión del front es `git revert -m 1` del merge de la spec.

## Estructura de archivos (prevista)

```text
supabase/migrations/20270210100000_tienda_paginas.sql
supabase/migrations/20270212200002_tienda_analitica.sql
supabase/tests/database/tienda_paginas.test.sql
supabase/tests/database/tienda_analitica.test.sql
apps/web/src/pages/empresas/tienda/pestanas/{paginas,analitica}.tsx   (+ registro en pestanas.ts)
apps/web/src/pages/tienda-publica/rutas/pagina.tsx
apps/web/src/pages/tienda-publica/layout/PieInformacion.tsx          (montada desde PieCategorias)
apps/web/src/pages/tienda-publica/ficha/BotonCompartir.tsx
apps/web/src/lib/{tiendaPaginas,analiticaTienda,enlaceProducto}.ts
apps/web/e2e/{tienda-paginas,tienda-analitica,tienda-compartir}.e2e.ts
docs/tiendas-online.md
```

## Riesgos

- **MSF-149 no está en `main`**: F-TDA-24 (consentimiento) y el `<head>` de F-TDA-23 (`CabeceraSeo`) necesitan su código. Mitigación: el orquestador libera la épica con MSF-149 desplegado en DEV; mergear/rebasar la base antes de implementar. Si los nombres difieren, se ajusta solo el adaptador de FR-014.
- **`pestanas.ts` compartido** entre F-TDA-23 y F-TDA-24 → se serializan en el plan de ejecución.
- **Cumplimiento legal de la medición** (cookies): no se carga nada sin aceptar; la política exacta depende de MSF-149 D6/D7.
