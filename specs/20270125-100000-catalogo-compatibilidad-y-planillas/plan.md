# Plan de implementación: Catálogo · Catálogo compatibilidad y planillas

**Spec**: `specs/20270125-100000-catalogo-compatibilidad-y-planillas/spec.md` · **Contratos**: `contracts/catalogo-compatibilidad-y-planillas.md`

## Resumen

Tres historias independientes sobre el catálogo existente: filtro por «Compatible con» (F-CAT-09), importación CSV con worker y outbox (F-CAT-10) y exportación CSV (F-CAT-11). Sin Kestra, Superset ni Edge Functions.

## Contexto técnico

- Frontend: `apps/web` (Refine + MUI), listado en `apps/web/src/pages/productos/`, `lib/productos.ts` ya maneja `compatible_con`. Usar `FiltroEmpresa`/`SelectorEmpresas` para empresas (nunca `Chip`/`Select` propios).
- Base: `dominio.productos.compatible_con text[]`; vista `public.v_productos_listado` (última migración `20261022121000`); costo en `dominio.producto_costos` con `nivel_seccion('rentabilidad')`; administrador por `private.es_administrador_de`.
- Worker: carpeta nueva `workers/importar-productos` siguiendo `workers/CONTRATO.md` y modelo de `workers/historial-importador` (parser CSV, `fflate` para ZIP). Capacidad nueva en `capacidades_ejecucion` y orden por outbox (spec 019 / `docs/adoptar-ciclo-ejecuciones.md`).
- Verificar con `graphify query` antes de implementar: nombre real de las funciones de alta/edición reutilizables por el worker, tabla de escalas de precio (F-CAT-16) y proveedores, y el patrón de outbox usado por otro producto. Lo que no exista se propone como migración, no se asume.

## Constitución — verificación

| Principio | Cumplimiento |
|---|---|
| I Multi-tenant | Tablas nuevas con RLS por organización; bucket por prefijo; pgTAP de aislamiento. |
| II Spec primero | Esta spec. |
| III Idempotencia/auditoría | Clave de idempotencia; ejecuciones auditables; actividad en exportación. |
| IV Despliegues independientes | Worker propio, sin Compose raíz. |
| V Simplicidad | Sin infraestructura nueva: el export se arma en navegador por páginas; el worker solo para la importación. |
| VI Panel | Ruta `/productos/carga` (sin ítem de menú, acceso desde el listado), estados de carga/vacío/error/éxito, 320/768/1440 px, teclado. |
| VII Esquemas | Todas las tablas nuevas en `dominio`; la vista en `public`. Re-verificar en cada tarea de migración. |
| VIII Empresa activa | FR-007, FR-113, FR-209 y fila en la matriz. |

## Diseño por historia

### F-CAT-09
Migración aditiva: `create or replace view` con `compatible_con` al final, índice GIN, `listar_compatibles()`. UI: filtro en la barra del listado y etiquetas en la fila; el filtro usa `compatible_con && $valores` con comparación en minúsculas (se guarda normalizado en la consulta, no en el dato).

### F-CAT-10
- Cliente: lectura del CSV y del ZIP en el navegador (límite de filas y tamaño), vista previa con `validar_importacion_productos`, imágenes subidas al bucket temporal por prefijo de organización.
- Servidor: `importaciones_productos` + `_filas`, `solicitar_importacion_productos` persiste y encola; `obtener_importacion_productos` para el sondeo de estado.
- Worker: toma la orden, aplica fila por fila con las mismas reglas del alta/edición, adjunta imágenes (blindaje según `docs/adoptar-blindaje-imagenes-workers.md`), deja el resultado por fila y cierra la ejecución. Serialización: una ejecución por capacidad.

### F-CAT-11
`exportar_productos` pagina por cursor; el cliente concatena páginas y arma el CSV (escape y neutralización de fórmulas), lo descarga y registra actividad.

## Riesgos

- **Solapamiento con MSF-206**: ver Decisión 6; no bloquea.
- **Alcance de diciembre**: ver Decisión 1 (OK pendiente).
- **«Etiquetas» sin definición**: Decisión 2 (OK pendiente).
- **Reglas de escalas de precio y proveedor**: la importación escribe lo que F-CAT-16 ya modela; si falta una operación reutilizable, la tarea correspondiente la agrega aditivamente.

## Documentación (obligatoria)

`docs/catalogo.md` (secciones por historia), `docs/permisos-por-rol.md` si aplica, `workers/importar-productos/README.md`, fila del roadmap y `pnpm docs:check` en el cierre.
