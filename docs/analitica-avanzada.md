# Analítica avanzada: galería de tableros (F-REP-07)

Épica MSF-265 · historia F-REP-07. Spec: `specs/20261101-100000-analitica-avanzada-y-resumen-por-correo/` (FR-001–FR-005, SC-001). La otra mitad de la épica es el [resumen semanal por correo](resumen-semanal-correo.md) (F-REP-08).

> **Estado**: la galería (F-REP-07) está integrada en la línea de despliegue del producto (`dokploy`); esta rama de la épica aporta el cierre (documentación, revisión de seguridad y roadmap). La revisión de seguridad de la entrega está en [Revisión de seguridad de la analítica avanzada](revision-seguridad-analitica-avanzada.md).

## Qué es y qué no es

El administrador **elige entre tableros ya armados** y versionados en el repo, con los cruces y los filtros propios de cada uno. **No arma ni edita tableros y no entra a Superset**: la regla de la spec 007 (FR-001 y FR-013) sigue intacta y la épica **no abre ninguna excepción de seguridad** (ver «La excepción a 007 FR-013»). Tampoco hay guardado de tableros propios: los tableros viven versionados en YAML dentro del repo.

## La base: la analítica embebida (spec 007)

La galería no inventa un acceso nuevo: reutiliza el acceso embebido de la spec 007.

| Pieza | Dónde | Qué garantiza |
|---|---|---|
| Componente de embebido | `apps/web/src/components/ReporteEmbebido.tsx` | El navegador recibe un **guest token**, nunca credenciales de administración de Superset |
| Token de invitado | `supabase/functions/emitir-acceso-reporte/` | La organización y las empresas accesibles los resuelve el **servidor**, con la sesión del usuario que mira (`public.resolver_organizacion_reporte`) |
| Cláusula `rls` del token | `supabase/functions/emitir-acceso-reporte/handler.ts` (`clausulaRls`) | `organizacion_id = '<org>'` y, si el tablero declara `filtro_empresa`, `AND empresa_id IN (<empresas accesibles>)` |
| Rol de lectura de Superset | `superset_analitica` (creado por `infra/superset/crear_cuenta_servicio_guest_token.py`) | Solo lectura sobre el esquema `analitica`; no existe ningún rol de Superset con permisos de edición para la organización |
| Vistas de lectura | esquema `analitica` (`analitica.ventas_empresa_categoria`, `analitica.margen_real_categoria`) | Cada fila expone `organizacion_id` y `empresa_id`: el aislamiento no lo hace la vista, lo hace la cláusula `rls` del token |
| Tableros versionados | `infra/superset/dashboards/` (YAML) | El dashboard vive en el repo, no solo en la UI de Superset |
| Importador | `infra/superset/importar-dashboards.mjs` | Importa el YAML, habilita el embebido y **registra el reporte** en `public.reportes` (idempotente) |

Los filtros que la pantalla preselecciona (período y tienda) **no son un control de acceso**: son un filtro de datos. Manipularlos en la URL solo reduce lo que ya está acotado por el token.

## La galería «Tableros analíticos»

| Pieza | Dónde |
|---|---|
| Pantalla «Tableros analíticos» (`/reportes/tableros`, menú *Reportes*, carga diferida) | `apps/web/src/pages/reportes/Tableros.tsx` |
| Catálogo (título, descripción, cruces y filtros de cada tablero) | `apps/web/src/lib/tablerosAnaliticos.ts` |
| Vistas `analitica.ventas_empresa_categoria` y `analitica.margen_real_categoria` | `supabase/migrations/20270324100000_analitica_tableros_avanzados.sql` |
| Alta de los tableros y asignación a las organizaciones | `supabase/migrations/20270324100100_reportes_tableros_analiticos.sql` |
| Tableros en YAML (2 datasets, 6 gráficos, 2 dashboards, `reportes.json` con `filtro_empresa: true`) | `infra/superset/dashboards/analitica-avanzada/` |
| Importación en el despliegue | `.github/workflows/deploy-infraestructura-vps.yml` |

### Tableros de la galería

| Tablero | Sección que exige | Cruces | Filtros |
|---|---|---|---|
| Ventas por tienda y categoría (nuevo) | `reportes` | tienda × categoría · período × categoría · producto × tienda | período, tienda, categoría, agrupar por |
| Margen real por tienda, categoría y producto (nuevo) | `rentabilidad` (expone costo y margen) | tienda × categoría · período × tienda · producto × tienda | los anteriores y estado del margen |
| Ventas por período y canal (existente) | `reportes` | período × tienda | período, tienda, agrupar por |
| Productos más vendidos (existente) | `reportes` | producto × tienda · producto × categoría · producto × ubicación de stock | período, tienda, categoría, ubicación de stock |

La galería muestra la **intersección** entre el catálogo y los reportes que la organización tiene asignados y la persona puede ver (`reportes_visibles_para_mi()`): un reporte asignado que no está en el catálogo no se ofrece, y un tablero del catálogo sin asignar tampoco.

### «Solo administradores»: qué es y qué no

Es el control de la **pantalla**: el destino del menú y la ruta usan `usePuedeEscribir` (administrador) y quien llega por URL sin serlo ve «Acceso restringido» sin que la pantalla pida ningún token. El **servidor** no exige el rol sino la **sección** del tablero (`reportes` o `rentabilidad`), igual que con todos los demás reportes embebidos: `emitir-acceso-reporte` no cambió. Quien tuviera la sección y el reporte asignado podría pedir el token por fuera de la pantalla, pero ese token sigue acotado a su organización y a sus empresas accesibles: no hay escalada, solo una diferencia de alcance que está documentada en la revisión de seguridad.

### Aislamiento por organización y por tienda

1. La pantalla pide el token a `emitir-acceso-reporte` **como el usuario** (`resolver_organizacion_reporte` decide si hay acceso, incluida la sección del tablero).
2. El servidor arma la cláusula `rls` del token: `organizacion_id = '<org>'` y, como los tableros de la galería declaran `filtro_empresa = true`, `AND empresa_id IN (<empresas accesibles de quien mira>)`. Si no se pueden resolver las empresas, **no se emite token** (falla cerrada).
3. Las vistas exponen `organizacion_id`, `empresa_id` y `empresa_nombre`; el rol `superset_analitica` las lee y nadie más.
4. Los identificadores que se interpolan en la cláusula se validan uno por uno: lo que no es UUID se descarta.

**Empresa activa (Principio VIII)**: la tienda del filtro sigue a la barra superior; al cambiarla el tablero se vuelve a montar y pide un token nuevo, así que nunca muestra filas ni totales de la empresa anterior.

### Acoplamiento por el prefijo «Analítica · »

La migración `20270324100100` asigna a **todas** las organizaciones cualquier reporte cuyo nombre empiece con «Analítica · » (disparadores en `public.reportes`, `public.organizaciones` y `public.reportes_roles_default`). Registrar un reporte solo puede el superadmin (o el importador, del lado del servidor con la clave de servicio); asignar es solo visibilidad y el token sigue filtrando por organización y empresa. Un reporte que no deba ser global **no debe llevar ese prefijo**.

## La excepción a 007 FR-013

La spec 007 (FR-013) prohíbe que un administrador o un miembro de la organización tenga acceso directo a Superset: su único acceso es la visualización embebida de reportes ya asignados.

La épica dejó abierta la pregunta de si el administrador **arma** sus tableros (lo que cruzaría esa regla) o **elige** entre tableros ya armados. La entrega es la segunda: **no hay excepción**. La galería no crea ningún rol de Superset, no habilita la edición de dashboards, datasets ni charts, y no cambia `emitir-acceso-reporte`. La revisión completa está en [Revisión de seguridad de la analítica avanzada](revision-seguridad-analitica-avanzada.md).

## Alta de un tablero nuevo

1. Armarlo en Superset (superadmin), **exportarlo a YAML** y commitearlo bajo `infra/superset/dashboards/<carpeta>/` (nunca queda solo en la UI). Usar los filtros nativos `NATIVE_FILTER-rango` y `NATIVE_FILTER-empresa` (columna `empresa_nombre`) para que la galería los preseleccione.
2. Si necesita un cruce que no existe, agregar una migración aditiva con una vista `analitica.*` (sin privilegios para `anon`/`authenticated`, `select` solo para `superset_analitica`, `organizacion_id` y `empresa_id` en cada fila).
3. Registrarlo en `reportes.json` con `filtro_empresa: true`; si su nombre empieza con «Analítica · » la migración `20270324100100` ya asigna los tableros nuevos a todas las organizaciones (un tablero con otro nombre se asigna a mano en `/analitica/administrar`).
4. Describirlo en `lib/tablerosAnaliticos.ts` (título, descripción, cruces, filtros) y agregar la carpeta a los dos pasos de importación del workflow de despliegue.

Importar en un entorno (idempotente):

```sh
pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/analitica-avanzada --entorno staging|production
```

Detalle del importador y del mapeo de UUIDs en [Operar Superset](operar-superset.md).

## Reversión

Migración posterior: `drop view analitica.margen_real_categoria; drop view analitica.ventas_empresa_categoria;`, borrar los disparadores y funciones de `20270324100100` y `delete from public.reportes where nombre like 'Analítica · %'` (arrastra asignaciones y roles). Quitar la carpeta de los pasos del workflow y el destino del menú.

## Verificación

- pgTAP `supabase/tests/database/analitica_tableros_avanzados.test.sql`: aislamiento por organización y por empresa, privilegios de las vistas y asignación de los tableros.
- `node --test infra/superset/analitica-avanzada.test.mjs`: contenido de los YAML versionados (dataset físico con `organizacion_id`/`empresa_id`, sección `rentabilidad` en el de margen, empaquetado sin credenciales e importación idempotente).
- Vitest `apps/web/src/pages/reportes/Tableros.test.tsx` y `apps/web/src/lib/tablerosAnaliticos.test.ts`: galería, estados compartidos, axe a 320/768/1440 px y cambio de empresa.
