---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Precios e IVA: modelo, RPC y cálculo

**Épica:** MSF-114 · **Spec:** `specs/20261022-120000-precios-e-iva/` (spec, plan y tareas en la misma
carpeta) · **Rama:** `epic/MSF-114-precios-y-dolar-precios-e-iva` (PR #281; merge `e04772c4`),
**pendiente de merge a `main`**. Copia integrada en el lote a STG: `release/stg-lote`, commit `70184343`.

Historias: F-PRE-01 (MSF-115) precio y costo, F-PRE-07 (MSF-172) regla por empresa, F-PRE-12 (MSF-200)
IVA y precio final, F-PRE-15 (MSF-220) escalas. Resumen de producto:
[Precios e IVA](../producto/precios-e-iva.md).

## Decisión de arquitectura

**El precio se calcula al leer.** No hay columna de precio en pesos en ninguna tabla: el precio central,
el neto por empresa, el final con IVA y el visible salen de funciones y vistas de Postgres. La única
conversión a pesos es `private.a_pesos`, que lee `dominio.cotizacion_inicial`; cuando MSF-116 llegue,
cambia **esa** función y nada queda desactualizado.

Por eso la épica **no usa worker ni Kestra** (alcance de entrega: `refine` + `supabase`) y no hay
proceso de recálculo masivo propio: el recálculo del dólar es una transacción de base de MSF-116.

El frontend **no recalcula**: lee las vistas del servidor. Solo espeja las fórmulas en
`apps/web/src/lib/precios.ts`, `lib/iva.ts` y `lib/escalas.ts` para los textos de ejemplo mientras se
escribe (el precio todavía no está guardado).

## Modelo de datos (Principio VII)

Todo lo que se guarda es **dato de negocio del producto** → esquema `dominio`. Las vistas y las RPC
expuestas viven en `public` (superficie de lectura/ejecución, **no almacenan datos**) y el cálculo, en
`private`. Ver el [DER en Datos y DER](datos.md#precios-e-iva-msf-114).

| Objeto | Esquema | Naturaleza y acceso |
|---|---|---|
| `cotizacion_inicial` | `dominio` | **Nueva.** Una fila por organización (`organizacion_id` PK), `valor numeric(14,4) > 0`, `updated_at`. RLS por organización. Select con `productos` ≥ lectura; escritura con `empresas` = edición. Sin `DELETE`. |
| `precios_empresa` | `dominio` | **Nueva.** Una fila por empresa (`empresa_id` PK): `base` (`central` \| `central_ajuste`), `ajuste_pct numeric(7,3) > −100`, `redondeo_pesos = 10`, `mostrar_con_iva boolean not null default false`, `updated_at`. FK compuesta `(empresa_id, organizacion_id)` → `dominio.empresas (id, organizacion_id)`. Sin fila = «Igual al central». RLS por organización; select con `empresas` ≥ lectura, escritura con `empresas` = edición. Sin `DELETE`. |
| `alicuotas_iva` | `dominio` | **Nueva.** Catálogo por organización: `nombre`, `porcentaje numeric(5,2)` (0 ≤ pct < 100), `exento`, `activa`. Único por `(organizacion_id, lower(btrim(nombre)))`. Lectura para toda la organización autenticada; **sin escritura** desde la app en esta épica. Sin `DELETE`. |
| `producto_precios_escala` | `dominio` | **Nueva.** Precios sin IVA de las escalas x5, x10 y x50 de un producto, **en la moneda del producto**: `(producto_id, escala)` PK, `precio numeric(14,2) ≥ 0`, `updated_at`. FK compuesta `(producto_id, organizacion_id)`. Select con `productos` ≥ lectura; escritura con `productos` = edición. Sin `DELETE`: precio `null` = escala sin precio cargado. |
| `categorias.alicuota_iva_id` | `dominio` | **Alterada** (columna aditiva). FK compuesta `(alicuota_iva_id, organizacion_id)` → `alicuotas_iva`. Las existentes quedan en 21 %; las nuevas nacen en 21 % por trigger. |
| `productos.alicuota_iva_id` | `dominio` | **Alterada** (columna aditiva, nullable). `null` = hereda la de su categoría. |
| `empresas` | `dominio` | **Alterada**: `unique (id, organizacion_id)` (constraint `empresas_id_organizacion_key`), para que la FK compuesta de `precios_empresa` no pueda apuntar a otra organización. |
| `productos_precio_costo` | `public` | **Vista** `security_invoker`: precio central en pesos, costo en pesos y margen. El costo entra por `LEFT JOIN` con `dominio.producto_costos`, cuya RLS exige la sección `rentabilidad`: sin ella `costo_ars` y `margen` llegan en `null`. |
| `precios_empresa_neto` | `public` | **Vista** `security_invoker`: central y neto en pesos (sin IVA) por producto y empresa. Devuelve filas solo a quien tiene `empresas` ≥ lectura: sin ver la regla el cálculo parecería «Igual al central». |
| `precios_empresa_final` | `public` | **Vista** `security_invoker` sobre la anterior: alícuota efectiva, **precio final** (neto + IVA, al peso entero) y **precio visible** según el interruptor de la empresa. |
| `a_pesos`, `precio_central_ars`, `aplicar_regla_precio`, `precio_neto_empresa`, `alicuota_producto`, `aplicar_iva`, `precio_para` | `private` | **Funciones de cálculo.** `a_pesos` es el **único** punto de lectura de la cotización. `alicuota_producto` es `security definer` (resuelve la categoría aunque quien llama no tenga `categorias`) y está acotada a la organización del llamador. |

`anon` no tiene privilegios en ninguna de las cuatro tablas nuevas; cada RPC de `public` lleva
`revoke … from public, anon` y `grant execute … to authenticated`; las vistas llevan `revoke all` y
`grant select to authenticated`.

### Migraciones (aditivas; la reversión está en el encabezado de cada una)

| Migración | Contenido |
|---|---|
| `20261022120901_precios_cotizacion_inicial.sql` | `dominio.cotizacion_inicial`, RLS, trigger `cotizacion_inicial_tocar`, RPC `fijar_cotizacion_inicial` |
| `20261022121001_precios_conversion_central.sql` | `private.a_pesos`, `private.precio_central_ars` |
| `20261022121100_precios_costo_margen.sql` | Vista `public.productos_precio_costo` |
| `20261022121200_precios_actividad_producto.sql` | Triggers `productos_registrar_precio` y `producto_costos_registrar_precio` (`producto.precio_actualizado`) |
| `20261022130000_precios_empresa.sql` | `dominio.precios_empresa`, `unique` de `empresas`, RLS, trigger `precios_empresa_tocar` |
| `20261022130100_precios_empresa_rpc.sql` | RPC `guardar_regla_precio_empresa` (4 argumentos) y trigger `precios_empresa_registrar` |
| `20261022130200_precios_empresa_calculo.sql` | `private.aplicar_regla_precio`, `private.precio_neto_empresa`, vista `precios_empresa_neto`, RPC `previsualizar_precios_empresa` |
| `20261022140000_alicuotas_iva.sql` | `dominio.alicuotas_iva`, siembra de 21 % / 10,5 % / Exento (backfill + trigger de organización nueva) |
| `20261022140100_categorias_productos_alicuota.sql` | Columnas `alicuota_iva_id`, RPC `guardar_alicuota_categoria` y `asignar_alicuota_producto`, `private.alicuota_producto`, trigger `private.exigir_alicuota_activa` |
| `20261022140200_precios_empresa_iva.sql` | Columna `mostrar_con_iva`, RPC `guardar_regla_precio_empresa` ampliada a 5 argumentos, `private.aplicar_iva`, vista `precios_empresa_final` |
| `20261022150000_producto_precios_escala.sql` | `dominio.producto_precios_escala`, RLS, RPC `guardar_precios_escala` |
| `20261022150100_precio_para.sql` | `private.precio_para(producto, empresa, escala)` |

## Fórmulas (una sola fuente: la base)

1. **Precio central en pesos** (`private.a_pesos`): ARS queda tal cual; USD × cotización, redondeado a
   2 decimales. **Sin cotización cargada devuelve `null`**: un producto en dólares no tiene precio en
   pesos (no se inventa un valor).
2. **Neto de la empresa** (`private.aplicar_regla_precio`): base `central` (o empresa sin regla) →
   `central`; base `central_ajuste` → `round(central × (1 + ajuste/100) / 10) × 10` («Al $ 10 más
   cercano»).
3. **Precio final** (`private.aplicar_iva`): `round(neto × (1 + porcentaje/100))` al peso entero;
   **Exento ⇒ final = neto**. La alícuota es la del producto o, si no tiene, la de su categoría
   (`private.alicuota_producto`). Sin alícuota resoluble el final es `null`.
4. **Precio visible**: `mostrar_con_iva ? final : neto`.
5. **Margen**: `(neto − costo en pesos) / neto`, redondeado a 4 decimales. **Siempre sobre el neto**: el
   interruptor de IVA no lo cambia.

Ejemplo de verificación (E2E de cierre): lista USD 20, costo USD 12, dólar 1.465 → central $ 29.300,
costo $ 17.580, margen 40 %; empresa con «Central con ajuste +10 %» → neto $ 32.230 y con 21 % de IVA
$ 38.998.

## RPC y vistas (`public`)

| RPC | Devuelve | Seguridad y reglas |
|---|---|---|
| `fijar_cotizacion_inicial(p_valor numeric)` | `dominio.cotizacion_inicial` | `security invoker`. Exige `empresas` = edición. Valida `> 0` y hasta 4 decimales. `upsert` por organización. |
| `guardar_regla_precio_empresa(p_empresa, p_base, p_ajuste_pct, p_updated_at, p_mostrar_con_iva)` | `dominio.precios_empresa` | `security invoker`. Exige `empresas` = edición. `p_mostrar_con_iva` nulo = sin cambio (en el primer guardado de una empresa sin regla, nulo = «Sin IVA»). **Bloqueo optimista** por `updated_at`: el llamador manda el que leyó; si la fila cambió, `40001`. Idempotente: pedir lo ya guardado devuelve la fila sin conflicto, sin tocar `updated_at` ni generar evento. |
| `previsualizar_precios_empresa(p_empresa, p_base, p_ajuste_pct, p_muestra default 6)` | tabla `{ producto_id, nombre, sku, moneda, central_ars, neto_ars, final_ars }` | `security invoker`, `stable`. Exige `empresas` ≥ lectura. Muestra de productos **activos** de la organización (los primeros por nombre), con tope de 20. La muestra se recorta **antes** de resolver el IVA. |
| `guardar_alicuota_categoria(p_categoria, p_alicuota)` | `uuid` | `security invoker`. Exige `categorias` = edición. Idempotente. |
| `asignar_alicuota_producto(p_producto, p_alicuota)` | `uuid` | `security invoker`. Exige `productos` = edición. `p_alicuota` nulo = el producto **hereda** la de su categoría. Idempotente. |
| `guardar_precios_escala(p_producto, p_x5, p_x10, p_x50)` | `void` | `security invoker`. Exige `productos` = edición. Guarda las tres escalas de una vez (nulo = sin precio). Idempotente: solo escribe si el precio cambió. |

Códigos de error que devuelve la base y la UI traduce: `42501` (sin permiso), `23514` (valor inválido:
ajuste ≤ −100 %, más de 3 decimales, alícuota inactiva, precio negativo, cotización ≤ 0), `22003` (fuera de
rango), `P0002` (producto, categoría, alícuota o empresa inexistente o ajena), `40001` (conflicto de
edición) y `22023` (escala inexistente).

Las vistas `productos_precio_costo`, `precios_empresa_neto` y `precios_empresa_final` son `security_invoker`
y heredan la RLS de las tablas base.

## Regla de precio por empresa: bloqueo optimista

`private.tocar_precios_empresa` (trigger `BEFORE UPDATE`) hace que `updated_at` avance **solo ante un
cambio real** de `(base, ajuste_pct, redondeo_pesos, mostrar_con_iva)`. Eso permite que la RPC compare el
`updated_at` que envía el cliente con el de la fila: si no coinciden, devuelve `40001` y la UI pide
recargar. Si la empresa todavía no tiene regla y el cliente manda un `updated_at`, también es conflicto
(`40001`): la regla la creó otra persona.

## IVA por categoría y por producto

- **Herencia**: la alícuota del producto es la propia si existe, si no la de su categoría
  (`private.alicuota_producto`). Sin ninguna, el precio final es `null`: no se inventa un IVA.
- **Alícuota inactiva**: la RPC responde `23514` y el trigger `private.exigir_alicuota_activa` repite el
  rechazo en un `UPDATE` directo de la columna (necesario porque las RPC son `security invoker`).
- **Semilla**: 21 %, 10,5 % y Exento por organización, con backfill de las existentes y trigger
  `organizaciones_sembrar_alicuotas_iva` para las nuevas. El 27 % no existe hasta que haya una
  administración de alícuotas (fuera de alcance).
- **Categorías**: las existentes quedan en 21 %; las nuevas nacen en 21 % (`private.alicuota_inicial_categoria`).

## Escalas: el contrato `private.precio_para`

`private.precio_para(p_producto uuid, p_empresa uuid, p_escala text default 'x1')` devuelve
`escala_usada`, `neto`, `alicuota_id`, `alicuota_nombre`, `alicuota_porcentaje`, `alicuota_exenta` y
`final`:

1. Parte del precio de la escala pedida; **si esa escala no tiene precio cargado usa el precio de
   lista** y `escala_usada = 'x1'`.
2. Lo convierte a pesos (`a_pesos`), aplica la regla de la empresa (`aplicar_regla_precio`) y el IVA
   (`aplicar_iva`): las mismas fórmulas únicas de F-PRE-01/07/12.
3. Una escala fuera de `x1`/`x5`/`x10`/`x50` da `22023` con mensaje claro, no un precio. Producto o
   empresa ajenos no devuelven filas; USD sin cotización devuelve `neto` nulo.
4. Devuelve filas solo con la sección `empresas` (misma regla que `precios_empresa_neto`).

**`x1` es el precio de lista** del producto: no se duplica en la tabla de escalas.

**Contrato con Clientes y proveedores:** `precio_para` **no consulta `tipos_cliente`**. Quien necesita el
precio (Ventas, cuenta web) lee `tipos_cliente.escala_precio` (texto, p. ej. `x5` para «Mayorista») y se lo
pasa. `escalaDeTipoCliente` (`apps/web/src/lib/escalas.ts`) hace el mapeo: sin escala = `x1`, valor inválido
= error. Mientras la tabla no exista, el contrato se prueba con un tipo simulado
(`supabase/tests/database/precios_escala.test.sql`, `tipos_cliente_simulado`).

## Permisos

| Acción | Sección |
|---|---|
| Leer `cotizacion_inicial` | `productos` ≥ lectura |
| Fijar la cotización inicial | `empresas` = edición |
| Leer `precios_empresa` | `empresas` ≥ lectura |
| Guardar la regla de precio y el interruptor de IVA | `empresas` = edición |
| Ver la vista previa y los precios de la empresa | `empresas` ≥ lectura |
| Leer `alicuotas_iva` | Toda la organización autenticada (el IVA no es dato sensible) |
| Guardar el IVA de una categoría | `categorias` = edición |
| Guardar el IVA de un producto | `productos` = edición |
| Leer y guardar `producto_precios_escala` | `productos` ≥ lectura / = edición |
| Ver costo y margen | `rentabilidad` (join por RLS de `dominio.producto_costos`) |

La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un
parámetro.

## Eventos de actividad

Se escriben con `private.insertar_actividad`, en la **misma transacción** que el cambio.

| Tipo | Cuándo | Detalle |
|---|---|---|
| `producto.precio_actualizado` | Cambia la moneda o el precio de lista del producto; cambia el costo; cambia el IVA del producto; cambia el precio de una escala | «Cambió el precio de lista de …», «Cambió el costo de …», «Cambió el IVA de …», «Cambió el precio de la escala x5 de …». **Sin importes en el detalle del costo** (lo ve quien no tiene `rentabilidad`). |
| `empresa.regla_precio_actualizada` | Cambia la base o el ajuste de la regla; cambia el interruptor de IVA | «Cambió la regla de precio de …: Igual al central → Central con ajuste +8 %», «Los precios de … que ve el cliente pasaron a Con IVA incluido». |

Guardar lo mismo **no** deja evento: los triggers comparan antes/después.

## Frontend

| Pieza | Archivo |
|---|---|
| Pestaña «Precios y moneda» de la empresa (ruta `/empresas/edit/:id/precios`) | `apps/web/src/pages/empresas/precios.tsx` |
| Pestaña en la ficha de empresa y ruta en `App.tsx` (protegida por `RequiereAccesoSeccion seccion="empresas"`) | `apps/web/src/pages/empresas/PestanasEmpresa.tsx`, `apps/web/src/App.tsx` |
| Bloques «Precio de venta de <Empresa>» y «Moneda y cotización» | `apps/web/src/components/precios/ReglaPrecioEmpresa.tsx` |
| Tabla «Así quedan los precios» | `apps/web/src/components/precios/TablaAsiQuedan.tsx` |
| Bloque «Precio y costo» del formulario de producto | `apps/web/src/components/precios/PrecioCostoBloque.tsx` |
| «Margen estimado (escala x1)» | `apps/web/src/components/precios/MargenEstimado.tsx` |
| Bloque «Precios por escala · sin IVA» | `apps/web/src/components/precios/EscalasPrecio.tsx` |
| Campo «IVA» del producto | `apps/web/src/components/precios/IvaProducto.tsx` |
| Fórmulas espejadas, formato de importes y mensajes de error | `apps/web/src/lib/precios.ts`, `lib/iva.ts`, `lib/escalas.ts` |
| Hooks de lectura y guardado | `apps/web/src/hooks/usePreciosEmpresa.ts`, `useAlicuotas.ts`, `useCotizacionInicial.ts` |
| Integración en las pantallas de Catálogo (formulario de producto, Categorías) | `apps/web/src/components/productos/FormularioProducto.tsx`, `apps/web/src/pages/productos/create.tsx`, `edit.tsx`, `apps/web/src/components/categorias/FormularioCategoria.tsx`, `apps/web/src/pages/categorias/list.tsx` |

**Empresa activa:** no aplica al producto ni a las categorías (son de la organización). La pestaña de
empresa es de **una empresa por ruta**: al abrir otra se recargan las consultas y se reinicia el
formulario (`pages/empresas/precios.tsx` + `pages/empresas/precios.test.tsx`).

## Pruebas

| Tipo | Archivos |
|---|---|
| pgTAP | `supabase/tests/database/precios_cotizacion_conversion.test.sql`, `precios_empresa.test.sql`, `precios_iva.test.sql`, `precios_escala.test.sql`; más `rls_en_toda_tabla.test.sql` |
| Vitest | `apps/web/src/lib/precios.test.ts`, `lib/iva.test.ts`, `lib/escalas.test.ts`, `hooks/usePreciosEmpresa.test.tsx`, `components/precios/{PrecioCostoBloque,EscalasPrecio,IvaProducto}.test.tsx`, `pages/empresas/precios.test.tsx`, `pages/productos/{create,edit}.test.tsx`, `pages/categorias/list.test.tsx` |
| E2E | `apps/web/e2e/precios-iva.e2e.ts` (SC-009): producto en USD con costo → precio en dos empresas con reglas distintas → interruptor de IVA → precio final y margen. Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y aborta si el Supabase no es local ([detalle](../e2e-app.md)). |

Los pgTAP cubren dos organizaciones (aislamiento), permisos por rol, conversión USD/ARS, sin cotización →
sin precio, costo y margen solo con `rentabilidad`, redondeo y ajustes +/−, dos empresas con reglas
distintas, conflicto de edición, rango, herencia producto/categoría, 29.186 → 35.315 al 21 %, Exento,
interruptor distinto por empresa, margen invariable, escala faltante que cae en la lista, escala inválida
y `anon` sin ejecución.

## Reversión

Todas las migraciones son **aditivas** y llevan su reversión en el encabezado. Orden inverso:
`private.precio_para` → `producto_precios_escala` → interruptor y vista final (`20261022140200`) →
alícuotas (`20261022140100`, `20261022140000`) → regla por empresa (`20261022130200`…`20261022130000`) →
costo/margen, conversión, cotización inicial y actividad (`20261022121200`…`20261022120901`).

Las que borran columna o tabla (**`alicuota_iva_id` de `categorias` y `productos`**, `mostrar_con_iva`,
las cuatro tablas nuevas y el `unique` de `empresas`) piden **exportar los datos antes** y van en una
migración posterior, nunca en el PR que las creó.

A nivel de épica, el cierre es un merge commit: `git revert -m 1 <hash>` deshace la épica completa.

## Decisiones abiertas y deuda

| Tema | Estado |
|---|---|
| ¿La cantidad de la línea cambia la escala? | No en esta épica: la escala la **pasa el consumidor** a `precio_para` y hoy la define el **tipo de cliente**. La selección automática por cantidad la define Ventas (F-VTA-06). El texto del prototipo «Mayorista usa la escala según la cantidad» se adaptó a «cada tipo de cliente usa su escala». |
| Alícuotas reales y valor inicial del interruptor | Pregunta abierta del relevamiento: se parte de 21 % / 10,5 % / Exento y del interruptor en «Sin IVA»; se ajusta editando, no con código. |
| ¿El Operador ve el costo? | Se mantiene la matriz vigente: el costo y el margen solo con la sección `rentabilidad`. |
| Precio propio por empresa | Fuera de alcance (MSF-352). El punto de extensión queda en `private.precio_neto_empresa`, no en las pantallas. |
| Carga y recálculo masivo del dólar | Fuera de alcance (MSF-116): aquí solo la cotización inicial y el punto de lectura `private.a_pesos`. |
| Administración de alícuotas (27 %) | Fuera de alcance: `alicuotas_iva` se crea sin escritura desde la app. |
| Tipos de cliente: «descuento adicional» y «condición de pago» | Fuera de alcance: no están en ninguna historia de la épica. |
| `docs/schema.html` | No se regeneró (necesita el Supabase local corriendo y expone `public`); las tablas de `dominio` quedan documentadas en las migraciones y en el [DER](datos.md#precios-e-iva-msf-114). |
| Integración en el lote a STG | La copia de `release/stg-lote` (commit `70184343`) **no** incluye el cableado en las pantallas de Catálogo que ya existían: el formulario de producto sigue sin los bloques «Precio y costo», «Precios por escala» e «IVA», y la pantalla Categorías sigue sin la columna ni el campo de IVA (`git diff epic/MSF-114-… release/stg-lote -- apps/web/src/components/productos apps/web/src/pages/productos apps/web/src/components/categorias`). Hay que reconectar esos archivos al integrar a `main`. **Dueño:** quien integra la épica a `main`; sin seguimiento en Jira todavía. |
