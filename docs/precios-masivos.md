# Actualización masiva de costos y precios (F-PRE-10 · MSF-436)

Historia de la épica MSF-363 (spec [`precios-masivos-y-promociones`](../specs/20261104-103000-precios-masivos-y-promociones/spec.md)). El administrador sube o baja costos y precios de lista en bloque: ve primero cómo quedan (vista previa) y recién al confirmar se aplican. Los importes van **sin IVA**. Contexto del modelo de precios: [`precios.md`](./precios.md).

## Qué hace

- Pantalla **Actualizar precios** (`/productos/precios-masivos`), con botón en el listado de Productos. Es de la **organización**, no de una empresa (el precio de lista y el costo son de la organización), por eso no usa la empresa activa de la barra superior.
- **Por porcentaje**: qué cambia (precio de lista, costo o ambos), alcance (todos los productos activos o una categoría con sus subcategorías) y un porcentaje que sube o baja (mayor a −100 %). Redondea a 2 decimales en la moneda del producto.
- **Por planilla**: CSV UTF-8 (coma o punto y coma, BOM, CRLF) con columnas `SKU` (obligatoria), `costo` y `precio_lista` (al menos una). Se lee en el navegador con `lib/migracionCsv.ts`; hay plantilla descargable. No depende del Centro de importaciones (Decisión 3 de la spec).
- **Vista previa** (solo lectura): antes → después por producto, totales (se actualizan, sin cambio, con error) y errores por fila numerados. Con errores no se puede confirmar.
- **Confirmar**: una sola transacción, todo o nada.

## Modelo (Principio VII)

| Objeto | Esquema | Naturaleza |
|---|---|---|
| `actualizaciones_precio` (un registro por lote aplicado: autor, fecha, modo, parámetros, cantidad, clave) | `dominio` | dato de negocio auditable |
| `previsualizar_actualizacion_precios`, `aplicar_actualizacion_precios` | `public` | superficie de ejecución, no almacenan datos |
| `private.calcular_actualizacion_precios` | `private` | cálculo único compartido por la vista previa y aplicar |

`productos` y `producto_costos` no cambian de esquema: solo se actualizan `precio_lista` y `costo`. **No se guarda ningún precio en pesos**: el neto y el final de cada empresa se calculan al leer, así que todas las empresas pasan al valor nuevo en la misma transacción (Decisión de MSF-114, ver [`precios.md`](./precios.md)).

## RPC

| RPC | Entrada | Salida / errores |
|---|---|---|
| `previsualizar_actualizacion_precios(p_modo, p_parametros)` | porcentaje: `{ cambia, alcance, porcentaje }` · planilla: `{ filas: [{ fila, sku, costo?, precio_lista? }] }` | `{ afectados, sin_cambio, con_error, filas[] }`; cada fila trae `antes → después`, `actualizado` (versión) y `error`. `costo_*` solo con `rentabilidad`. Errores: `42501`, `22023`, `54000` |
| `aplicar_actualizacion_precios(p_modo, p_parametros, p_clave)` | los mismos parámetros + `versiones` (`{ producto_id: updated_at }` de la vista previa) y una clave `uuid` por intento | `{ lote_id, aplicados, repetido }`. Errores: `42501` sin permiso, `40001` conflicto, `22023` datos inválidos (filas con error en `DETAIL`) o sin cambios, `54000` más de 5.000 productos |

Ambas son `security definer` (justificado: `authenticated` no puede escribir `actualizaciones_precio`), con `set search_path = ''`, `revoke … from public, anon` y `grant execute … to authenticated`. Cada una exige `productos` = edición, resuelve la organización con `private.organizacion_id()` y el núcleo filtra por organización de forma explícita.

## Decisiones

- **Mismo núcleo para vista previa y aplicar**: aplicar revalida todo en el servidor; no confía en los valores calculados por el cliente.
- **Conflicto**: la vista previa devuelve el `updated_at` de cada producto; aplicar bloquea cada fila (`for update`, en orden de id) y, si alguna cambió o entró al alcance desde entonces, falla con `40001` y no aplica nada. Un cambio de costo también avanza el `updated_at` del producto.
- **Idempotencia**: la clave es única por organización (`actualizaciones_precio.clave`) y se serializa con un bloqueo asesor; repetirla devuelve el lote ya aplicado. La pantalla genera una clave nueva por cada vista previa.
- **Alcance del porcentaje**: solo productos **activos**; una categoría incluye sus subcategorías (2 niveles). La planilla admite productos inactivos. Tope de 5.000 productos por llamada.
- **Costo**: solo con `rentabilidad`. La vista previa lo omite sin esa sección y aplicar rechaza (`42501`) cualquier pedido que lo toque. En modo porcentaje, un producto sin costo cargado no recibe uno nuevo; en planilla sí se crea.
- **Qué no se toca** (Decisión 2 y 5): moneda, escalas de precio (F-PRE-15), precios propios por empresa (F-PRE-08, hoy inexistentes) ni nada de Mercado Libre.
- **Auditoría**: los disparadores existentes dejan `producto.precio_actualizado` por producto con cambio real; el lote suma `precios.actualizacion_masiva` **sin importes de costo** (la ve quien no tiene `rentabilidad`), y `actualizaciones_precio.parametros` tampoco guarda costos (en planilla solo la cantidad de filas).

## Permisos

| Rol | Efecto |
|---|---|
| `productos` = edición (Administrador, Operador) | abre la pantalla; puede cambiar precios de lista |
| `rentabilidad` = edición (Administrador) | además ve y cambia costos |
| `rentabilidad` = lectura | ve el costo en la vista previa, no lo cambia |
| `productos` = lectura o sin acceso | «No tenés acceso a esta sección» (la ruta no monta la pantalla) y las RPC responden `42501` |

## Pruebas

- pgTAP `supabase/tests/database/precios_masivos.test.sql` (FR-002, FR-004…FR-009, SC-001).
- Vitest `apps/web/src/lib/preciosMasivos.test.ts` (planilla, FR-003/FR-006) y `apps/web/src/pages/productos/precios-masivos.test.tsx` (pantalla, FR-001/FR-010, SC-002).
- E2E `apps/web/e2e/precios-masivos.e2e.ts` (SC-003; ver [`e2e-app.md`](./e2e-app.md)).

## Reversión

Migraciones aditivas `20270202202001`…`20270202202003`, cada una con su reversión en el encabezado. Orden inverso: `drop function public.aplicar_actualizacion_precios(text, jsonb, uuid)` → `drop function public.previsualizar_actualizacion_precios(text, jsonb)` y `private.calcular_actualizacion_precios(uuid, boolean, text, jsonb)` → `drop table dominio.actualizaciones_precio` (en una migración posterior, no en el PR que la crea; exportar antes los lotes). Los precios ya aplicados **no se deshacen solos**: se corrigen con otra actualización (la Actividad deja qué producto cambió).
