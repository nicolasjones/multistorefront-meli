# Implementation Plan: Catálogo · Catálogo variantes

**Branch**: `epic/MSF-229-catalogo-catalogo-variantes` · **Spec**: [spec.md](spec.md) · **Jira Epic**: MSF-229
**Delivery scope**: `refine`, `supabase` · **Constitución**: v1.9.0 (Supabase self-hosted; Principio VII en cada etapa; Principio VIII declarado «no aplica» en la matriz)

## Resumen

Dos historias sobre el formulario de producto que dejaron MSF-456, MSF-179 y MSF-292: **F-CAT-18** (productos relacionados, S) agrega una lista ordenada por producto y su contrato de lectura; **F-CAT-15** (variantes, XL) agrega variantes con código y stock propios, el stock del producto como suma y el parámetro de variante en los movimientos. Ambas editan `FormularioProducto`, por eso van en serie; F-CAT-18 va primero (solo necesita `productos`, riesgo bajo).

## Contexto técnico

- Frontend `apps/web`: `pages/productos/create.tsx`, `edit.tsx`, `FormularioProducto`, `lib/productos*`; componentes del kit (`TarjetaBase`, `ContenidoAdaptable`, `EtiquetaEstado`, tabla en `sm+` y tarjetas en `xs`). Bloques nuevos cargados con el formulario (ya se descarga bajo demanda, `lazy`).
- Supabase: migraciones aditivas con timestamps propios por historia (sin encadenar entre historias); reversión en el encabezado de cada una.
- Sin workers, Kestra ni Superset.

## Diseño por historia

### F-CAT-18 · Relacionados (migración `20270125110000_catalogo_relacionados.sql`)

- Tabla `dominio.producto_relacionados (producto_id, relacionado_id, organizacion_id, orden, creado_en)`; PK `(producto_id, relacionado_id)`; FK compuestas `(producto_id, organizacion_id)` y `(relacionado_id, organizacion_id)` a `productos` con `on delete cascade`; `check (producto_id <> relacionado_id)`; índice `(organizacion_id, producto_id, orden)`.
- RLS: select `lectura`/`edicion` en `productos`; insert/update/delete `edicion`. `anon` sin privilegios.
- `public.guardar_relacionados` y `v_producto_relacionados` según `contracts/relacionados.md`; evento `producto.relacionados_editados`.
- UI: componente `BloqueRelacionados` (buscador sobre `v_productos_listado` por nombre/SKU/categoría con tope de 4, lista con ↑ ↓ ✕, avisos, estado vacío). Integrado en alta (tras `crear_producto`) y edición.
- Reversión: `drop function public.guardar_relacionados`, `drop view public.v_producto_relacionados`, luego `drop table dominio.producto_relacionados` en migración posterior.

### F-CAT-15 · Variantes (cuatro bloques, migraciones propias)

- **A · Datos** (`20270125100000_catalogo_variantes_tablas.sql`): `dominio.producto_variantes (id, organizacion_id, producto_id, nombre, codigo, codigo_barras, activa, orden, creado_en, updated_at)`; únicos por organización de `codigo` y `codigo_barras`; disparador que impide que un `codigo` coincida con un `productos.sku` (y viceversa) y que un `codigo_barras` coincida con `productos.codigo_barras`; `check` EAN-13; RLS sin DELETE; se agrega a `rls_en_toda_tabla`.
- **B · Stock** (`20270125100100_catalogo_variantes_stock.sql`, `…100200_…`): `dominio.existencias_variante (variante_id, deposito_id, organizacion_id, cantidad >= 0)` espejo de `existencias_deposito`; `movimientos_stock.variante_id` nullable; `registrar_movimiento_stock` con `p_variante` (BREAKING declarado); cuerpo nuevo de `private.disponibilidad_producto`, `productos_con_stock`, `disponible_publico` (suma de variantes activas; reservado de variantes = 0 hasta que Reservas se adapte). `guardar_variantes_producto` y `v_producto_variantes` (`…100300_…`).
- **C · Ficha**: `BloqueVariantes` (tabla Variante/Código/Código de barras/Stock/Activa, «Agregar variante» con valores por defecto, celdas editables en línea del kit, interruptor Activa, textos y avisos del prototipo), integrado en alta y edición; errores de `23505`/`22023` mapeados al campo.
- **D · Precio y verificación**: la variante no guarda precio; prueba de que `precio_para` se resuelve por `producto_id`; regresión de productos sin variantes.
- Reversión: `drop` de RPC/vistas, restaurar cuerpos y firma previos de las funciones (migración posterior), luego `drop table` de `existencias_variante` y `producto_variantes` y `drop column movimientos_stock.variante_id` en una migración **posterior** a la que las crea.

## Pruebas (pruebas-plataforma)

- **pgTAP**: unicidad cruzada, aislamiento entre organizaciones, `anon` sin acceso, RLS de las tres tablas, suma de stock y disponibilidad, movimientos con variante, regla de la primera variante, orden de relacionados, `rls_en_toda_tabla`.
- **Vitest**: bloques de variantes y relacionados (textos del prototipo, estados vacío/carga/error, permisos lectura/edición/sin Stock), mapeo de errores, regresión de producto sin variantes, cambio de empresa que no altera los bloques.
- **E2E**: recorrido de cierre (variantes + relacionados + suma de stock) con el stack local.

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Ventas, reservas, Mercado Libre y tienda no descuentan stock de variantes (Decisión 5) | Declarado fuera de alcance; las specs de esos canales lo adoptan; aviso en `docs/catalogo.md` |
| Cambio de firma de `registrar_movimiento_stock` rompe llamadores (importación, Service, Ventas) | `p_variante default null`; buscar llamadores en `apps/web` y `supabase` y probarlos; `BREAKING` declarado |
| Alta no atómica (producto creado y luego variantes/relacionados) | RPC idempotentes, error visible y reintento; documentado |
| Dependencias MSF-114 / MSF-136 no mergeadas al implementar | Tomar el tronco vigente; no inventar contratos de Precios |
| Rendimiento de la suma de variantes en listados | Subconsulta no correlacionada (patrón vigente de `productos_con_stock`); medir con 10 000 productos |

## Constitución — chequeo

- I/VII: tablas nuevas en `dominio` con RLS por organización, vistas `security_invoker`, sin acceso `anon`; esquema re-verificado en plan y tareas.
- II: spec con FR/SC, matriz y flujos. III: RPC idempotentes con evento de actividad. VI: bloques accesibles (teclado, 320/768/1440 px) con patrones compartidos. VIII (contexto de empresa): declarado «no aplica» con motivo en la matriz.
- Documentación (Governance): `docs/catalogo.md`, `docs/stock.md` y contratos en el mismo cambio.
