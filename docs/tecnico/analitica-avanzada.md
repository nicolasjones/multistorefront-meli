---
owner: tecnico
sources:
  - specs/20261114-100000-analitica-avanzada-y-resumen-por-correo
  - supabase/migrations
  - apps/web/src
---

# Analítica avanzada: galería de tableros (F-REP-07)

Épica MSF-265 · historia F-REP-07. Spec: `specs/20261114-100000-analitica-avanzada-y-resumen-por-correo/` (RF-REP-07-1…9, SC-001). Manual para quien usa el panel: [Tableros analíticos y resumen semanal](../producto/tableros-analiticos.md).

> **Estado:** la épica está implementada en la rama `epic/MSF-265-analitica-y-resumen-por-correo` (spec, migraciones `20270324100000`–`20270324100100`, YAML de Superset, pantalla y tests), **todavía no mergeada a `main`**: la ruta `/reportes/tableros`, las migraciones `20270324100000`–`20270324100100`, la carpeta `infra/superset/dashboards/analitica-avanzada/` y el caso `analitica-avanzada.test.mjs` existen en esa rama, no en `main`. La guía de abajo se corre en la rama de la épica. TODO (dueño: quien mergee la épica): confirmar el merge y quitar esta nota.

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
| Importación en el despliegue | `.github/workflows/deploy-infraestructura-vps.yml` (pasos de staging y producción) |

## Tableros de la galería

El catálogo de `lib/tablerosAnaliticos.ts` describe cuatro tableros; la galería muestra la **intersección** entre ese
catálogo y los reportes que la organización tiene asignados y la persona puede ver (`reportes_visibles_para_mi()`,
vía `useReportesAsignados`): un reporte asignado que no está descrito en el catálogo no se ofrece, y un tablero del
catálogo sin asignar tampoco.

| Tablero | Reporte en `public.reportes` | Sección | Cruces | Filtros |
|---|---|---|---|---|
| Ventas por tienda y categoría (nuevo) | `Analítica · Ventas por tienda y categoría` | `reportes` | Tienda × categoría · Período × categoría · Producto × tienda | Período, Tienda, Categoría, Agrupar por día, semana o mes |
| Margen real por tienda, categoría y producto (nuevo) | `Analítica · Margen real por tienda, categoría y producto` | `rentabilidad` (expone costo y margen) | Tienda × categoría · Período × tienda · Producto × tienda | los anteriores y Estado del margen |
| Ventas por período y canal (existente) | `Reportes · Ventas por período y canal` | `reportes` | Período × tienda | Período, Tienda, Agrupar por día, semana o mes |
| Productos más vendidos (existente) | `Ventas · Más vendidos` | `reportes` | Producto × tienda · Producto × categoría · Producto × ubicación de stock | Período, Tienda, Categoría, Ubicación de stock |

Los cuatro tienen `filtro_empresa = true` en su `reportes.json` y los dos nuevos se registran con los roles por defecto
`administracion` (`administrador` tiene acceso incondicional).

## «Solo administradores»: qué es y qué no

Es el control de la **pantalla**: el destino del menú (`destinosPanel.ts`, `audiencia: 'administrador'`) y la ruta usan
`usePuedeEscribir`, y quien llega por URL sin serlo ve «No tenés acceso a esta sección» («Tu rol (actual) no incluye
Tableros analíticos») sin que la pantalla pida ningún token. El **servidor** no exige el rol sino la **sección** del
tablero (`reportes` o `rentabilidad`), como con todos los demás reportes embebidos: `emitir-acceso-reporte` no cambió y
`resolver_organizacion_reporte` decide con la sección. Quien tuviera la sección y el reporte asignado podría pedir el
token por fuera de la pantalla; ese token sigue acotado a su organización y a sus empresas accesibles. Exigir el rol en
el servidor sería una historia aparte (cambia el contrato de la spec 007 para todos los reportes).

## Aislamiento por organización y por tienda

1. La pantalla pide el token a `emitir-acceso-reporte` **como el usuario** (`resolver_organizacion_reporte` decide si
   hay acceso, incluida la sección del tablero).
2. El servidor arma la cláusula `rls` del token: `organizacion_id = '<org>'` y, como los cuatro tableros declaran
   `filtro_empresa = true`, `AND empresa_id IN (<empresas accesibles de quien mira>)`. Si no se pueden resolver las
   empresas, **no se emite token** (falla cerrada).
3. Las vistas exponen `organizacion_id`, `empresa_id` y `empresa_nombre`; el rol `superset_analitica` las lee y nadie
   más (`revoke all` para `public`, `anon` y `authenticated`).
4. Los filtros de período y tienda que la pantalla preselecciona (`native_filters` de `urlParamsReportes`) **no son
   seguridad**: un filtro manipulado en la URL solo reduce lo que ya es visible.

Empresa activa (Principio VIII): la tienda del filtro (`FiltroEmpresa`) sigue a la barra superior; al cambiarla el
tablero se vuelve a montar (la clave de montaje incluye rango y empresa) y pide un token nuevo.

## Estados de la pantalla

| Estado | Qué ve la persona |
|---|---|
| Acceso restringido | «No tenés acceso a esta sección» / «Tu rol (actual) no incluye Tableros analíticos», sin pedir token |
| Sin tableros | «Todavía no hay tableros disponibles para tu organización.» |
| 403 del token | Acceso restringido al tablero concreto |
| Superset caído | «No pudimos cargar el tablero «…».» con **Reintentar** |

## Acoplamiento por el prefijo «Analítica · »

La migración `20270324100100` asigna a **todas** las organizaciones cualquier reporte cuyo nombre empiece con «Analítica ·
» (disparadores en `public.reportes`, `public.organizaciones` y `public.reportes_roles_default`). Registrar un reporte
solo puede el superadmin (o el importador, del lado del servidor con la clave de servicio); asignar es solo visibilidad
y el token sigue filtrando por organización y empresa. Un reporte que no deba ser global **no debe llevar ese prefijo**.

## Lo que NO se validó contra sistemas reales (MSF-949)

Los YAML se validaron de forma estructural y contra un Superset simulado; no se importaron ni se vieron renderizados en
un Superset real. Seguimiento: **MSF-949**.

## Alta de un tablero nuevo

1. Armarlo en Superset (superadmin), **exportarlo a YAML** y commitearlo bajo `infra/superset/dashboards/<carpeta>/`
   (nunca queda solo en la UI). Usar los filtros nativos `NATIVE_FILTER-rango` y `NATIVE_FILTER-empresa` (columna
   `empresa_nombre`) para que la galería los preseleccione.
2. Si necesita un cruce que no existe, agregar una migración aditiva con una vista `analitica.*` (sin privilegios para
   `anon`/`authenticated`, `select` solo para `superset_analitica`, `organizacion_id` y `empresa_id` en cada fila).
3. Registrarlo en `reportes.json` con `filtro_empresa: true`; si su nombre empieza con «Analítica · » la migración
   `20270324100100` ya asigna los tableros nuevos a todas las organizaciones (un tablero con otro nombre se asigna a
   mano en `/analitica/administrar`).
4. Describirlo en `lib/tablerosAnaliticos.ts` (título, descripción, cruces, filtros) y agregar la carpeta a los dos
   pasos de importación del workflow de despliegue.

Importar en un entorno: `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/analitica-avanzada --entorno <dev|staging|production>` (idempotente). Detalle del importador y del mapeo de UUIDs en [Operar Superset](../operar-superset.md).

## Fuera de alcance

Lo que la spec deja explícitamente afuera:

- Que el administrador **arme o edite** tableros dentro de Superset (decisión P1 de la spec) y el guardado de tableros
  propios (P2).
- BI más allá de los cuatro tableros descritos, reportes exportables adicionales y Mercado Libre.
- Un editor de contenido del correo, otro día u hora por organización, correo en HTML y envío a personas que no son
  administradores.
- Una pantalla de preferencia del resumen distinta de «Mi organización» y «Avisos por correo».

## Reversión

Migración posterior: `drop view analitica.margen_real_categoria; drop view analitica.ventas_empresa_categoria;`, borrar
los disparadores y funciones de `20270324100100` y `delete from public.reportes where nombre like 'Analítica · %'`
(arrastra asignaciones y roles). Quitar la carpeta de los pasos del workflow y el destino del menú.

## Cómo probarlo (guía técnica)

Cada paso lleva el rótulo de su tarea para que el Reportero lo pueda automatizar con Playwright. En `main` todavía no
existen los scripts de la épica; corré esta guía en la rama `epic/MSF-265-analitica-y-resumen-por-correo`.

### Prerrequisitos

- `pnpm dev:supabase` (en la rama de la épica ya aplica las migraciones; si no, `supabase migration up --local`) con las
  migraciones `20270324100000` y `20270324100100` aplicadas y una organización con al menos dos tiendas, categorías y
  ventas de la semana.
- `pnpm dev:superset` y los tableros importados:
  `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/analitica-avanzada --entorno dev`.
- El panel: `pnpm dev:refine` (Docker) o `pnpm dev:refine:host`, con una persona **administradora** y una
  **operadora**. La administradora necesita la sección `rentabilidad` para abrir el tablero de margen.
- Para los pgTAP: `pnpm test:db` (levanta la base local y corre toda la suite).

### Pasos

1. `[MSF-265:T001]` Corré el pgTAP `supabase/tests/database/analitica_tableros_avanzados.test.sql`
   (`supabase test db --local supabase/tests/database/analitica_tableros_avanzados.test.sql`; `pnpm test:db` corre toda
   la suite). Verificá que las dos vistas existan, que cada fila tenga `organizacion_id`, `empresa_id` y `empresa_nombre`,
   y que `anon`/`authenticated` no puedan leerlas mientras `superset_analitica` sí.
2. `[MSF-265:T002]` En la base, consultá `public.reportes` con el prefijo «Analítica · »: deben estar los dos tableros
   nuevos con su sección (`reportes` y `rentabilidad`) y `filtro_empresa = true`. Creá una organización de prueba y
   comprobá que los dos reportes queden asignados; repetí el alta de una organización y verificá que no se dupliquen
   asignaciones.
3. `[MSF-265:T003]` Corré `node --test infra/superset/analitica-avanzada.test.mjs`: valida los dos dashboards, los
   datasets, los 6 gráficos, los filtros nativos, que no haya credenciales y que el catálogo del panel coincida con
   `reportes.json` y la migración.
4. `[MSF-265:T004]` Corré `pnpm test:superset:importar-dashboards` dos veces seguidas contra el Superset de dev: la
   segunda importación no debe duplicar objetos ni pisar UUIDs.
5. `[MSF-265:T005]` Revisá `.github/workflows/deploy-infraestructura-vps.yml`: la carpeta `analitica-avanzada` aparece
   en los pasos de importación de staging y producción.
6. `[MSF-265:T006]` Entrá como administradora a **Reportes → Tableros analíticos**. Comprobá las tarjetas de los
   tableros asignados, abrí «Ventas por tienda y categoría», cambiá el período y la tienda, y después cambiá la
   empresa activa en la barra superior: el tablero se vuelve a montar y no quedan filas de la tienda anterior. Abrí
   «Margen real…» con y sin la sección `rentabilidad`. Entrá por URL como operadora: «No tenés acceso a esta sección».
   Con Superset detenido: «No pudimos cargar el tablero «…»» con **Reintentar**. Pasá axe a 320, 768 y 1440 px y
   recorré la galería solo con teclado.

### Resultado esperado

- Las dos vistas responden y el aislamiento por organización y empresa se cumple; ningún rol de aplicación puede leerlas.
- Los dos reportes quedan asignados a las organizaciones existentes y a las nuevas, sin duplicados.
- La galería muestra solo los tableros asignados y descritos en el catálogo; abrir uno pide un token nuevo y respeta
  período y empresa activa.
- La operadora no ve el menú ni la galería; el tablero de margen sin `rentabilidad` muestra el acceso restringido; si
  Superset no responde, la pantalla ofrece **Reintentar**.
- La segunda importación de dashboards es idempotente.

### Cómo automatizarlo

- Base: pgTAP `supabase/tests/database/analitica_tableros_avanzados.test.sql` (tests 1–23).
- Tableros: `node --test infra/superset/analitica-avanzada.test.mjs` y `pnpm test:superset:importar-dashboards`.
- Pantalla: Vitest `apps/web/src/pages/reportes/Tableros.test.tsx` (incluye empresa activa, 403, error, axe y teclado) y
  `apps/web/src/lib/tablerosAnaliticos.test.ts`.
- **E2E pendiente:** no hay specs Playwright con el rótulo `[MSF-265:T006]`. Cuando se escriban, el paso 6 es el
  recorrido a automatizar; el resto ya está cubierto por los tests nombrados.

## Capturas pendientes

- TODO (dueño: Documentador, tras el merge de la épica): generar las capturas del manual con `pnpm docs:capturas` para
  la galería `/reportes/tableros` con las tarjetas, un tablero abierto con los filtros de período y tienda, el estado
  de acceso restringido y el error con **Reintentar**. La herramienta de capturas del manual (`pnpm docs:capturas`,
  `apps/web/e2e/capturas/` y `pnpm demo:dataset`) **no existe en este repo** y el código de la épica todavía no está
  en `main`: hasta entonces la página de producto describe el comportamiento **sin imágenes nuevas**, no se inventó
  ninguna.

## Verificación automática

pgTAP `supabase/tests/database/analitica_tableros_avanzados.test.sql`; `node --test infra/superset/analitica-avanzada.test.mjs`; Vitest `Tableros.test.tsx` y `tablerosAnaliticos.test.ts`. Revisión de seguridad: [revisión de seguridad de la analítica avanzada](revision-seguridad-analitica-avanzada.md).
