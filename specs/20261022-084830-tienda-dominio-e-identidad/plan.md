# Implementation Plan: Tiendas online · Tienda dominio e identidad

**Branch**: `epic/MSF-147-tiendas-online-tienda-dominio-e-identida` | **Date**: 2026-10-22 | **Spec**: `specs/20261022-084830-tienda-dominio-e-identidad/spec.md`

**Delivery scope**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Cada empresa tiene una tienda resuelta por dominio con lectura anónima segura (esquema nuevo `publico`, solo funciones) y el administrador, con edición en Empresas, configura identidad visual, textos y catálogo visible. Cuatro historias tras una base común (F-TDA-01): cada una trae **su propia migración aditiva**, su RPC de escritura, su función pública de lectura y su pestaña, sin depender de tareas de otra historia.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI). Gestión en `apps/web/src/pages/empresas/tienda/` (pestañas por archivo en `pestanas/`); front público en `apps/web/src/pages/tienda-publica/` (secciones por archivo en `secciones/`, ordenadas por un `orden` exportado). Ninguna historia edita un archivo que otra también edite.
- **Base**: Postgres self-hosted, esquemas `dominio` (tablas) y `publico` (funciones). RLS con `private.organizacion_id()` y la sección de permisos `empresas` (`private.nivel_seccion('empresas') = 'edicion'`), nunca solo `puede_escribir()`.
- **Estado del código verificado** (migraciones del repo): existen `dominio.empresas` (con `activa`), `dominio.productos`, `private.nivel_seccion`, `public.registro_actividad` y buckets de Storage de ejemplo (`20261014160000_organizacion_datos_y_configuracion.sql`). **No existen**: esquema `publico`, `dominio.tiendas`, tablas de identidad/contenido/catálogo de tienda, bucket `tienda-identidad`, front público ni `dominio.categorias` (este vive en la rama de MSF-160; ver Dependencias de la spec). Todo lo nuevo se crea por migración; nada se asume.
- **Testing**: pgTAP (`supabase/tests/database/`), Vitest para componentes/utilidades, Playwright E2E con los dos dominios del seed. `pnpm test` requiere `pnpm dev:supabase`.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización en las 5 tablas; `anon` solo ejecuta funciones de `publico`; sin service-role en el navegador. |
| II Especificar primero | Esta spec; todo FR tiene una tarea dueña. |
| III Idempotencia/auditoría | RPC de guardado idempotentes (aplican el conjunto) y eventos `tienda.*` en el registro de actividad. |
| IV Despliegues independientes | Sin Compose nuevo; solo `refine` y `supabase`. |
| V Simplicidad | Sin infraestructura nueva; el bucket y el esquema `publico` son lo mínimo. |
| VI Panel operable | Ubicación, audiencia, ruta, patrones de estado, a11y y carga diferida declarados en la spec. |
| VII Esquemas | Las 5 tablas en `dominio` (justificado en la spec); `publico` sin tablas; pgTAP recorre `public`+`dominio` y comprueba que `publico` no tiene tablas. Re-verificado aquí: coincide con la spec. |
| VIII Empresa activa | FR-009 + fila «Empresa activa» en la matriz + test de cambio de empresa (SC-006). |
| Documentación | `docs/tiendas-online.md` nuevo (cierre) y notas en `docs/empresas.md`. |

Regla del proyecto «anon solo ejecuta las RPC de acceso»: se **respeta**. Las funciones públicas viven en `publico` (no en `public`); el test existente de `public` sigue verde y se agrega uno para `publico`.

## Estructura de migraciones (una por historia, aditivas)

| Historia | Migración | Contenido | Reversión |
|---|---|---|---|
| F-TDA-01 | `20261023100000_tiendas_dominio.sql` | Esquema `publico` (`revoke all … from public`), `dominio.tiendas`, RLS, `publico.tienda_por_dominio`, grants, evento de actividad, seed de dos tiendas | `drop function publico.tienda_por_dominio; drop table dominio.tiendas; drop schema publico` |
| F-TDA-02 | `20261023100100_tienda_identidad.sql` | `create schema if not exists publico`, `dominio.tienda_identidad`, bucket `tienda-identidad` + políticas, `public.guardar_tienda_identidad`, `publico.identidad_por_dominio` | `drop` de las dos funciones, la tabla y el bucket (exportar archivos antes) |
| F-TDA-03 | `20261023100200_tienda_contenido.sql` | `create schema if not exists publico`, `dominio.tienda_contenido`, `public.guardar_tienda_contenido`, `publico.contenido_por_dominio` | `drop` de funciones y tabla |
| F-TDA-04 | `20261023100300_tienda_catalogo_visible.sql` | `create schema if not exists publico`, `categorias_tienda`, `productos_tienda`, `public.listar_catalogo_tienda`, `public.guardar_catalogo_tienda`, `publico.catalogo_visible_por_dominio` | `drop` de funciones y tablas |

Independencia entre historias: F-TDA-02/03/04 no referencian objetos de F-TDA-01 en su migración (usan `dominio.empresas`; las funciones públicas resuelven la empresa por `host` con un join dinámico a `dominio.tiendas` en tiempo de ejecución, tabla que entrega F-TDA-01 en el mismo PR de la épica). Los pgTAP de cada historia crean su propia tienda de prueba dentro de la transacción.

> Orden de timestamps: posterior a `20261021233000_proveedores_sin_tienda.sql` (última de la base) y a las migraciones de MSF-160 al integrarla.

## Contratos públicos (esquema `publico`)

| Función | Entrada | Salida (solo campos públicos) | Historia |
|---|---|---|---|
| `publico.tienda_por_dominio(host text)` | host crudo | `{ tienda_id, empresa_nombre, estado }` o vacío (idéntico para desconocido/desactivada) | F-TDA-01 |
| `publico.identidad_por_dominio(host text)` | host | colores, tipografías, URLs públicas de logo/banners | F-TDA-02 |
| `publico.contenido_por_dominio(host text)` | host | textos comerciales | F-TDA-03 |
| `publico.catalogo_visible_por_dominio(host text)` | host | categorías y productos visibles (nombre, precio, imagen, categoría, destacado) | F-TDA-04 |

Todas `SECURITY DEFINER`, `stable`, `set search_path = ''`, normalizan `host`, filtran por `empresa.activa`, devuelven solo columnas de una lista blanca y `grant execute … to anon, authenticated`; `revoke … from public`.

## Contratos de escritura (esquema `public`, solo `authenticated`)

`guardar_tienda_identidad`, `guardar_tienda_contenido`, `guardar_catalogo_tienda`, `listar_catalogo_tienda`: validan sesión, pertenencia de la empresa a la organización activa y `nivel_seccion('empresas') = 'edicion'`; `revoke … from public, anon`; `grant execute … to authenticated`; registran evento `tienda.*` con actor y empresa.

## Eventos de actividad (contrato F-AUD-01)

`tienda.dominio_configurado`, `tienda.identidad_actualizada`, `tienda.contenido_actualizado`, `tienda.catalogo_actualizado` — payload mínimo: empresa, actor, nombres de campos cambiados (no valores).

## Frontend

- **F-TDA-01**: ruta `/empresas/:id/tienda/:pestaña` + `EncabezadoTienda` (migas, dominio · estado, «Cambiar a … ↔», «Ver tienda») que lee la empresa activa del selector (F-ROL-06); carga de pestañas con `import.meta.glob`; guardia de permiso (edición en Empresas); ruta pública por `Host` con `PaginaTienda` (secciones por glob) y `VolvemosPronto`.
- **F-TDA-02**: `pestanas/identidad.tsx` + componentes de logo/banner (subida con validación previa de formato/tamaño y rechazo de SVG con script), selector de color, cálculo de contraste (WCAG), vista previa; sección pública `TemaTienda` (variables CSS desde tokens DS-04) y encabezado público.
- **F-TDA-03**: `pestanas/contenido.tsx` con campos y contadores de longitud, vista previa del banner; secciones públicas `BannerHome`, `BarraBienvenida`, `PieTienda` (texto escapado).
- **F-TDA-04**: `pestanas/catalogo.tsx` con categorías, tabla, buscador, estrella con diálogo de confirmación, resumen; sección pública de productos destacados/listado mínimo.
- Estados de carga/vacío/error/éxito del kit; teclado y lector de pantalla; 320/768/1440.

## Verificación

- pgTAP por historia (aislamiento entre dos organizaciones, `anon` solo `publico`, validaciones, idempotencia) y uno que comprueba que `publico` no tiene tablas.
- Vitest: contraste, normalización de host, visibilidad efectiva, confirmación de destacado, cambio de empresa.
- E2E (cierre): dos dominios del seed; los cambios de una tienda no tocan la otra.
- Evidencia local del Desarrollador por tarea; qué queda para el CI se anota en el PR.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Esquema `publico` no expuesto por la API self-hosted | Tarea explícita (F-TDA-01) para `config.toml` y variable de entorno de PostgREST; documentado en `docs/tiendas-online.md`. |
| MSF-160 no está en la base de la rama | F-TDA-04 se implementa tras integrar MSF-160; F-TDA-01/02/03 no dependen. |
| Superposición `categorias_empresa` ↔ `categorias_tienda` | Decisión D6; la tienda solo lee `categorias_tienda`. |
| SVG con script / XSS en textos | Rechazo de SVG con script, textos siempre escapados, cabeceras de seguridad del front público. |
| Enumeración de dominios | Respuesta idéntica para dominio desconocido y tienda desactivada. |
| Carrera de guardado simultáneo | RPC transaccional; el último guardado gana. |
| Horas (36 h vs. roadmap) | D7: recorte pendiente de decidir; no cambia este alcance. |

## Documentación

- `docs/tiendas-online.md` (nuevo): modelo, esquema `publico`, dominios, límites, operación.
- `docs/empresas.md`: enlace a la gestión de tienda.
- `docs/roadmap-template.md`: fila de la épica al cerrar (paso manual del cierre).
