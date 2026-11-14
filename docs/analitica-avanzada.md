---
owner: tecnico
sources:
  - specs/20261114-100000-analitica-avanzada-y-resumen-por-correo
  - supabase/migrations
  - apps/web/src
---

# Analítica avanzada: galería de tableros (F-REP-07)

Épica MSF-265 · historia F-REP-07. Spec: `specs/20261114-100000-analitica-avanzada-y-resumen-por-correo/` (RF-REP-07-1…9, SC-001). Manual para quien usa el panel: [Tableros analíticos](producto/tableros-analiticos.md).

## Qué es y qué NO es

El administrador **elige entre tableros ya armados** y versionados en el repo, con los filtros y cruces propios de cada uno. **No arma ni edita tableros** y **no entra a Superset**: la regla de la spec 007 (FR-001/FR-013) sigue intacta y no hace falta ninguna excepción de seguridad. Tampoco hay guardado de tableros propios (decisión de Nicolás, 2026-11-14, por delegación).

## Piezas

| Pieza | Dónde |
|---|---|
| Pantalla «Tableros analíticos» (`/reportes/tableros`, menú *Reportes*, solo administradores, carga diferida) | `apps/web/src/pages/reportes/Tableros.tsx` |
| Catálogo (título, descripción, cruces, filtros de cada tablero) | `apps/web/src/lib/tablerosAnaliticos.ts` |
| Componente de embebido (sin cambios) | `apps/web/src/components/ReporteEmbebido.tsx` |
| Token de invitado (sin cambios) | `supabase/functions/emitir-acceso-reporte/` |
| Vistas `analitica.ventas_empresa_categoria` y `analitica.margen_real_categoria` | `supabase/migrations/20270324100000_analitica_tableros_avanzados.sql` |
| Alta y asignación de los tableros | `supabase/migrations/20270324100100_reportes_tableros_analiticos.sql` |
| Tableros en YAML | `infra/superset/dashboards/analitica-avanzada/` |
| Importación en el despliegue | `.github/workflows/deploy-infraestructura-vps.yml` |

## Tableros de la galería

| Tablero | Sección que exige | Cruces | Filtros |
|---|---|---|---|
| Ventas por tienda y categoría (nuevo) | `reportes` | tienda × categoría · período × categoría · producto × tienda | período, tienda, categoría, agrupar por |
| Margen real por tienda, categoría y producto (nuevo) | `rentabilidad` (expone costo y margen) | tienda × categoría · período × tienda · producto × tienda | los anteriores y estado del margen |
| Ventas por período y canal (existente) | `reportes` | período × tienda | período, tienda, agrupar por |
| Productos más vendidos (existente) | `reportes` | producto × tienda · producto × categoría · producto × ubicación de stock | período, tienda, categoría, ubicación de stock |

La galería muestra la **intersección** entre este catálogo y los reportes que la organización tiene asignados y la persona puede ver (`reportes_visibles_para_mi()`): un reporte asignado que no está descrito en el catálogo no se ofrece, y un tablero del catálogo sin asignar tampoco.

## «Solo administradores»: qué es y qué no

Es el control de la **pantalla**: el destino del menú y la ruta usan `usePuedeEscribir` (administrador) y quien llega por URL sin serlo ve «Acceso restringido» sin que la pantalla pida ningún token. El **servidor** no exige el rol sino la **sección** del tablero (`reportes` o `rentabilidad`), como con todos los demás reportes embebidos: `emitir-acceso-reporte` no cambió. Quien tuviera la sección y el reporte asignado podría pedir el token por fuera de la pantalla; ese token sigue acotado a su organización y a sus empresas accesibles. Exigir el rol en el servidor sería una historia aparte (cambia el contrato de la spec 007 para todos los reportes).

## Aislamiento por organización y por tienda

1. La pantalla pide el token a `emitir-acceso-reporte` **como el usuario** (`resolver_organizacion_reporte` decide si hay acceso, incluida la sección del tablero).
2. El servidor arma la cláusula `rls` del token: `organizacion_id = '<org>'` y, como los dos tableros nuevos (y los dos existentes del catálogo) declaran `filtro_empresa = true`, `AND empresa_id IN (<empresas accesibles de quien mira>)`. Si no se pueden resolver las empresas, **no se emite token** (falla cerrada).
3. Las vistas exponen `organizacion_id`, `empresa_id` y `empresa_nombre`; el rol `superset_analitica` las lee y nadie más.
4. Los filtros de período y tienda que la pantalla preselecciona (`native_filters` de `urlParamsReportes`) **no son seguridad**: un filtro manipulado en la URL solo reduce lo que ya es visible.

Empresa activa (Principio VIII): la tienda del filtro sigue a la barra superior; al cambiarla el tablero se vuelve a montar y pide un token nuevo.

## Acoplamiento por el prefijo «Analítica · »

La migración `20270324100100` asigna a **todas** las organizaciones cualquier reporte cuyo nombre empiece con «Analítica · » (disparadores en `public.reportes`, `public.organizaciones` y `public.reportes_roles_default`). Registrar un reporte solo puede el superadmin (o el importador, del lado del servidor con la clave de servicio); asignar es solo visibilidad y el token sigue filtrando por organización y empresa. Un reporte que no deba ser global **no debe llevar ese prefijo**.

## Lo que NO se validó contra sistemas reales (MSF-949)

Los YAML se validaron de forma estructural y contra un Superset simulado; no se importaron ni se vieron renderizados en un Superset real. Seguimiento: **MSF-949**.

## Alta de un tablero nuevo

1. Armarlo en Superset (superadmin), **exportarlo a YAML** y commitearlo bajo `infra/superset/dashboards/<carpeta>/` (nunca queda solo en la UI). Usar los filtros nativos `NATIVE_FILTER-rango` y `NATIVE_FILTER-empresa` (columna `empresa_nombre`) para que la galería los preseleccione.
2. Si necesita un cruce que no existe, agregar una migración aditiva con una vista `analitica.*` (sin privilegios para `anon`/`authenticated`, `select` solo para `superset_analitica`, `organizacion_id` y `empresa_id` en cada fila).
3. Registrarlo en `reportes.json` con `filtro_empresa: true`; si su nombre empieza con «Analítica · » la migración `20270324100100` ya asigna los tableros nuevos a todas las organizaciones (un tablero con otro nombre se asigna a mano en `/analitica/administrar`).
4. Describirlo en `lib/tablerosAnaliticos.ts` (título, descripción, cruces, filtros) y agregar la carpeta a los dos pasos de importación del workflow de despliegue.

Importar en un entorno: `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/analitica-avanzada --entorno <dev|staging|production>` (idempotente). Detalle del importador y del mapeo de UUIDs en [Operar Superset](operar-superset.md).

## Reversión

Migración posterior: `drop view analitica.margen_real_categoria; drop view analitica.ventas_empresa_categoria;`, borrar los disparadores y funciones de `20270324100100` y `delete from public.reportes where nombre like 'Analítica · %'` (arrastra asignaciones y roles). Quitar la carpeta de los pasos del workflow y el destino del menú.

## Verificación

pgTAP `supabase/tests/database/analitica_tableros_avanzados.test.sql`; `node --test infra/superset/analitica-avanzada.test.mjs`; Vitest `Tableros.test.tsx` y `tablerosAnaliticos.test.ts`. Revisión de seguridad: [revision-seguridad-analitica-avanzada.md](revision-seguridad-analitica-avanzada.md).
