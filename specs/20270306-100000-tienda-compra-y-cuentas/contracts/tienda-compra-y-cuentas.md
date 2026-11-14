# Contratos: Tiendas online · Tienda compra y cuentas (MSF-176)

Funciones nuevas del esquema `publico` (superficie de la tienda; `publico` sigue **sin tablas**). Todas: `security definer`, `set search_path = ''`, nombres calificados, **sin SQL dinámico**, `revoke execute … from public, anon` y `grant execute` **explícito** a quien corresponde. Los helpers `private.*` no tienen `execute` para ningún rol de API.

## Convenciones comunes

- **Empresa y organización** salen **solo** de `host` (`dominio.tiendas` normalizado con `private.normalizar_host`, empresa `activa`). Host desconocido, empresa desactivada y tienda pausada responden **lo mismo** y **antes** de validar cualquier otro dato. En las funciones de **cuenta** (A, B2) esa respuesta es `sin_acceso`, idéntica a la de cualquier falta de cuenta (no distingue «no hay tienda» de «no hay cuenta»); en las de visitante y en `capacidades_tienda_por_dominio` es `error`.
- **Identidad** (funciones de cuenta): `private.cuenta_de_tienda(host)` devuelve `(cuenta_cliente_id, cliente_id, organizacion_id, empresa_id, tipo)` solo si `auth.uid()` tiene una fila `activa` en `public.cuentas_cliente` para **esa** empresa, el cliente está habilitado en `clientes_empresas`, no está archivado y no es consumidor final. Si no, no devuelve nada y la RPC responde `sin_acceso` (idéntico en todos los casos: sin sesión, sin cuenta, suspendida, no habilitada, otra tienda, usuario de panel).
- **Bandera**: con `private.bandera_activa('tienda_pedidos')` apagada todas (salvo `capacidades_tienda_por_dominio`, que solo informa el estado de la bandera) responden el `error`/`sin_acceso` genérico de su familia, sin tocar datos.
- **Respuestas** siempre `jsonb` con `estado`; nunca texto de Postgres. El `exception when others` registra solo `sqlstate` (`raise warning`), no `sqlerrm`.
- **Entrada de ítems** (`items jsonb`): arreglo de 1 a 50 objetos `{"producto_id": uuid, "cantidad": 1..9999}`. Se valida **antes** de recorrer: `jsonb_typeof = 'array'`, `jsonb_array_length <= 50`, `length(items::text) <= 8000`; `producto_id` con la forma de uuid (regex, sin cast que falle) y `cantidad` como número entero o texto de 1 a 4 dígitos, mayor que cero. Repetidos se suman (tope 9.999). **Toda otra clave se ignora** (`precio`, `descuento`, `escala`, `deposito_id`, `estado`, `cliente_id`, …).
- **Texto libre**: se recorta, se rechazan caracteres de control (excepto salto de línea en la nota) y se aplican los largos de cada campo; se guarda como texto.
- **Fecha «hoy»**: `private.hoy_argentina()`.
- **Código de error** de entrada inválida: `estado = 'invalido'` con `campos` (lista de nombres de campo), nunca el valor.

---

## Transversal · capacidades de la tienda

### `publico.capacidades_tienda_por_dominio(host text) → jsonb`

- **Quién**: `anon` y `authenticated`. `stable`. Sin escritura ni cupo.
- **Salida**: `{"estado":"ok","pedidos": true|false}` donde `pedidos` es el valor de `private.bandera_activa('tienda_pedidos')`; `{"estado":"error"}` para host desconocido, empresa desactivada y tienda pausada (los tres idénticos). No devuelve ningún otro dato (ni la empresa, ni otras banderas).
- **Para qué**: es lo único que el front público necesita para dibujar o no «Mi cuenta», «Mi lista», «Guardar en favoritos» y «Agregar a la lista» (spec, FR-014 y D-27); la bandera vive en `public.banderas_plataforma`, que `anon` no puede leer.

---

## A · Mi cuenta (F-CLI-20)

### `publico.mis_compras_por_dominio(host text, desde_fecha date default null, desde_id uuid default null, limite integer default 20) → jsonb`

- **Quién**: `authenticated` (`anon` sin `execute`). Volatilidad `stable`.
- **Entrada**: `limite` se acota a 1–50; el cursor `(desde_fecha, desde_id)` solo **ordena** (siguientes filas con `(fecha, id) < cursor`); nunca autoriza: la consulta siempre filtra por `cliente_id` y `empresa_id` de la cuenta.
- **Salida** `ok`: `{ "estado": "ok", "total": n, "filas": [ { "id", "numero", "fecha", "tipo": "compra|presupuesto|nota_credito", "estado_publico", "total_con_iva" } ], "siguiente": { "fecha", "id" } | null }`. `siguiente` es la última fila de la página si quedan más, y se devuelve tal cual como `desde_fecha`/`desde_id`; un cursor a medias (solo uno de los dos valores) se ignora. Con 0 comprobantes: `{"estado":"ok","total":0,"filas":[],"siguiente":null}`.
- **Qué entra**: comprobantes de `dominio.comprobantes_venta` con `cliente_id` y `empresa_id` de la cuenta, cualquier canal, **sin borradores**. `tipo`: factura → `compra`, presupuesto → `presupuesto`, `nota_credito` → `nota_credito` (importe con signo negativo).
- **`estado_publico`**: presupuesto `pendiente` (con `valido_hasta` ≥ hoy o nulo) → `pendiente`; con `valido_hasta` < hoy → `vencido`; `aceptado` → `aceptado`; `anulada` → `anulado`. Factura en cualquier estado confirmado o posterior (`confirmada`, `cobrado`, `deuda`, `en_proceso`, `armando`, `incompleto`) → `confirmada`; `anulada` → `anulada`. Nota de crédito → `nota_credito`. **Nunca** se devuelven los estados de cobro ni de despacho.
- **Errores**: `{"estado":"sin_acceso"}`, `{"estado":"error"}`.
- **Orden**: `fecha desc, id desc`. Índice de apoyo `(cliente_id, empresa_id, fecha desc, id desc)` (T012).

### `publico.mi_compra_por_dominio(host text, comprobante_id uuid) → jsonb`

- **Quién**: `authenticated`.
- **Salida** `ok`: `{ "estado":"ok", "numero", "fecha", "tipo", "estado_publico", "valido_hasta", "total_sin_iva", "iva", "total_con_iva", "lineas": [ { "descripcion", "codigo", "cantidad", "precio_unitario", "subtotal" } ] }`
- **Signo en notas de crédito**: `total_sin_iva`, `iva` y `total_con_iva` van negativos y el `subtotal` de cada línea también (el `precio_unitario` y la `cantidad` quedan positivos), de modo que, **en las notas de crédito por devolución de productos** (las únicas que tienen líneas; las de importe o descuento no tienen líneas), las líneas suman el total con signo. Probado en pgTAP.
- **Lista blanca exacta** (probada por claves en pgTAP). **Nunca**: `costo*`, margen, `descuento_pct`, `precio_manual`, `deposito`, `operador*`, notas, `cliente_id`, `organizacion_id`, `forma_pago_id`, `envio_id`, cobros.
- **Aislamiento**: el comprobante debe tener el `cliente_id` y el `empresa_id` de la cuenta; si no, la respuesta es `{"estado":"no_encontrada"}` **idéntica** a la de un id inexistente.

### `publico.cambiar_favorito_por_dominio(host text, producto_id uuid, favorito boolean) → jsonb`

- **Quién**: `authenticated`. `volatile`.
- **Reglas**: el producto debe ser **efectivamente visible** en la tienda (`private.catalogo_tienda_efectivo`); si no, `{"estado":"no_encontrado"}` (igual que inexistente). `favorito = true` inserta con `on conflict do nothing` (idempotente); `false` borra si existe (sin error si no existe) y **no exige que el producto siga visible**: siempre responde `ok` y solo toca la fila de la propia cuenta, para que quien tiene favoritos ocultos pueda liberarlos (`no_encontrado` aplica solo al guardar). Tope **200** por cuenta (lock `pg_advisory_xact_lock` por cuenta) contando **solo los favoritos de productos visibles hoy** (uno oculto no se lista ni ocupa lugar: con 150 visibles y 50 ocultos se puede guardar el 151; las filas están acotadas por la cantidad de productos de la tienda —única cuenta + producto— y el total visible puede superar 200 si se vuelven a publicar productos que estaban ocultos): el 201 devuelve `{"estado":"limite_favoritos"}` sin guardar.
- **Rendimiento (medido)**: la visibilidad y el conteo del tope salen de **una sola** evaluación de `private.catalogo_tienda_efectivo(empresa)` por llamada (la misma regla que la ficha y que `precios_cliente_por_dominio`; una comprobación puntual propia duplicaría las reglas de visibilidad y podría divergir). Medición local reproducible con `scripts/medir-tienda-favoritos.sql` (Postgres 17 de la imagen de Supabase, sin carga concurrente; es una estimación, no un SLA): con 2.000 productos en la tienda guardar tarda ~12 ms y con 10.000 ~35–50 ms (igual orden que `precios_cliente_por_dominio` de un producto, ~12 y ~35 ms). **Límite aceptado**: hasta ~10.000 productos visibles por tienda; si el catálogo supera ~50.000 hay que reemplazarlo por una función puntual de visibilidad dentro de la misma migración del catálogo.
- **Salida**: `{"estado":"ok","favorito":true|false}` | `limite_favoritos` | `no_encontrado` | `sin_acceso` | `error`.

### `publico.mis_favoritos_por_dominio(host text, desde_creado timestamptz default null, desde_id uuid default null, limite integer default 20) → jsonb`

- **Quién**: `authenticated`. `stable`.
- **Salida**: `{ "estado":"ok", "total": n, "filas": [ { "producto_id", "nombre", "sku", "imagen", "disponible": bool, "precio_final": numeric|null, "escala": "x1|x5|x10|x50" } ], "siguiente": { "creado": timestamptz, "id": uuid } | null }`. `siguiente` es la última fila de la página si quedan más (`creado` = `creado_en` y `id` = el de la fila de favorito) y se devuelve tal cual como `desde_creado`/`desde_id`; un cursor a medias se ignora. Solo productos visibles hoy en la tienda; `total` cuenta solo esos (con 0 favoritos: `{"estado":"ok","total":0,"filas":[],"siguiente":null}`). `precio_final` es el mismo que ve la cuenta en la ficha (`private.precio_final_publico_escala` con la escala **x1** para minorista, y la escala del tipo para mayorista a cantidad 1). **Sin cantidades de stock** (solo `disponible`).
- Orden `creado_en desc, id desc`; límite 1–50.

### `publico.favoritos_entre_por_dominio(host text, productos uuid[]) → jsonb`

- **Quién**: `authenticated`. Máximo **50** ids (más → `{"estado":"invalido","campos":["productos"]}`).
- **Salida**: `{"estado":"ok","favoritos":[uuid,…]}` (la intersección con los favoritos de la cuenta). Sirve para pintar el corazón en una pantalla con una sola llamada.

---

## B1 · Lista de pedido sin cobro

### `publico.lista_pedido_por_dominio(host text, items jsonb) → jsonb`

- **Quién**: `anon` y `authenticated`. `volatile` (**implementado así**: escribe solo el contador del limitador de lecturas; la spec la daba `stable` y sin cupo). Sin otra escritura; acotada por el máximo de 50 productos y con **cupo propio de 30 lecturas por minuto y visitante** (`private.registrar_pedido_publico` con la clave `lista|…`, T033, amenaza 1.9).
- **Salida** `ok`: `{ "estado":"ok", "con_cuenta": bool, "tipo": null|"minorista"|"mayorista", "lineas": [ { "producto_id", "nombre", "sku", "imagen", "cantidad", "disponible": bool, "precio_unitario": numeric|null, "precio_anterior": numeric|null, "escala": "x1|x5|x10|x50", "subtotal": numeric|null } ], "no_disponibles": [uuid,…], "total_referencia": numeric|null }`
- **Precio de referencia** (D-28): el **mismo** que ve la persona en la tienda (misma función y misma promoción vigente si la bandera de promociones está encendida; `precio_anterior` es el precio normal tachado de la ficha y es `null` sin promoción; prueba de paridad contra `publico.producto_por_dominio` y `publico.precios_cliente_por_dominio`). **No** incluye el descuento de la ficha del cliente: ése solo aparece en la cotización de B2. Con cuenta activa, se usa la escala del tipo del cliente según la **cantidad de la línea** (`private.escala_para_linea`). `null` si el producto no tiene precio visible.
- **`no_disponibles`**: producto inexistente, de otra tienda/organización, oculto, inactivo o fuera del catálogo efectivo: todos **indistinguibles**; no se devuelven en `lineas`.
- **Errores**: `{"estado":"error"}` (host desconocido, bandera apagada o falla interna); `{"estado":"invalido","campos":["items"]}`; `{"estado":"limite","espera_segundos":n}` (más de 30 lecturas en el minuto).

### `publico.enviar_lista_pedido(host text, nombre text, contacto text, nota text, items jsonb, clave_envio uuid) → jsonb`

- **Quién**: `anon` y `authenticated`. `volatile`.
- **Con cuenta activa** (`private.cuenta_de_tienda` no vacío): `nombre` y `contacto` recibidos **se ignoran**; se usan los de la ficha del cliente (nombre y correo) y la consulta guarda `cliente_id`. Sin cuenta: `nombre` (1–100) y `contacto` (correo, o teléfono de 8 a 15 dígitos) pasan por `private.validar_contacto_tienda`; `nota` opcional ≤ 500.
- **Flujo** (una sola sub-transacción con un único manejador): empresa por host → bandera → **cupo de llamadas** (`private.registrar_pedido_publico('envio|…')`, 20 por minuto y visitante, cuentan también las `invalido`; `limite` + `espera_segundos`) → validar entradas (`invalido` con `campos`) → cada producto debe ser visible, si alguno no lo es la lista entera se rechaza con `{"estado":"invalido","campos":["items"],"no_disponibles":[…]}` (la pantalla ya los avisó al revalidar) → `private.registrar_envio_tienda(empresa, 'pedido', clave_envio)`: `limite` → `{"estado":"limite","espera_segundos":n}`; `repetido` → `ok` sin crear (una clave **ya registrada** responde `ok` aun antes de revalidar la visibilidad: la repetición no depende de que los productos sigan visibles); `nuevo` → `private.crear_consulta_pedido(...)`: inserta `dominio.consultas` (`origen = 'pedido'`, `mensaje` = nota o nulo, `cliente_id` si hay cuenta) y `dominio.consulta_items` (descripción y SKU del producto, cantidad y `precio_referencia` calculado por el servidor), todo o nada. Si la entrega falla se revierte también el registro del envío (no se gasta cupo).
- **Salida**: `{"estado":"ok"}` | `invalido` (+ `campos`) | `limite` (+ `espera_segundos`) | `error`.
- **Efectos**: el aviso por correo de Consultas (cola de plataforma, valores escapados al armar el correo) con el resumen de ítems y el asunto sin datos del visitante. **Desvío**: lo emite `private.crear_consulta_pedido` (no el disparador, que no ve los ítems porque se insertan después de la consulta).

### Lectura del panel

`public.consulta_items_bandeja` (vista `security_invoker`, hereda la RLS de `dominio.consulta_items`): `consulta_id`, `empresa_id`, `orden`, `producto_id`, `descripcion`, `sku`, `cantidad`, `precio_referencia`. Sin `anon`. `public.consultas_bandeja` suma `cliente_id`, `items_cantidad` (cantidad de ítems de la consulta, 0 si no es un pedido) y, **como desvío**, `cliente_numero` y `cliente_nombre` (helpers `private` acotados a la organización de la sesión: el detalle muestra «Nº n · nombre» sin exigir acceso a Clientes); el `origen = 'pedido'` ya viaja.

---

## B2 · Presupuesto desde la tienda

### `publico.cotizar_presupuesto_tienda(host text, items jsonb) → jsonb`

- **Quién**: **solo `authenticated`**. **Desvío (T055)**: `volatile` y con cupo de llamadas por cuenta (`cotizacion|<cuenta>`, 20 por minuto, antes de calcular): puede responder `limite` (+ `espera_segundos`). Acotada a 50 líneas.
- **Salida** `ok`: `{ "estado":"ok", "lineas": [ { "producto_id", "descripcion", "codigo", "cantidad", "precio_unitario", "subtotal_sin_iva", "iva", "disponible": bool } ], "total_sin_iva", "iva", "total_con_iva", "no_disponibles": [uuid,…], "sin_precio": [uuid,…] }`.
- **Desvío (T055)**: la línea ya no trae `escala` (salida mínima: sin `promocion_id`, `alicuota_id`, `precio_referencia` ni escala; la lista de pedido ya la muestra).
- **Es el mismo motor** (`private.motor_presupuesto_tienda`, que a su vez llama al cálculo de precio único de MSF-816: `private.precio_linea_venta_calculo`, ver D-17) que usa la creación: «lo que ves es lo que se crea». Aplica el descuento de la ficha del cliente y la promoción vigente de la tienda, como el panel (D-28). Si hay `no_disponibles` o `sin_precio`, la cotización los informa y la creación **se negará**.
- **Errores**: `sin_acceso`, `invalido`, `error`.

### `publico.crear_presupuesto_tienda(host text, items jsonb, nota text, clave_envio uuid) → jsonb`

- **Quién**: **solo `authenticated`** (`has_function_privilege('anon', …) = false`, probado). `volatile`.
- **Entrada**: únicamente las cuatro de arriba. **No recibe** cliente, cuenta, empresa, organización, precios, escala, descuento, depósito, estado ni canal.
- **Orden de verificaciones** (todas antes de escribir): bandera → `cuenta_de_tienda` (`sin_acceso`) → validar `items`, `nota` y `clave_envio` (`invalido`) → idempotencia (`(cuenta_cliente_id, clave_envio)` ya existe → devolver el **mismo** presupuesto) → lock por cuenta (`pg_advisory_xact_lock(hashtextextended('presupuesto|' || cuenta, 0))`) y segunda lectura de la idempotencia → topes por cuenta (`limite_cuenta`: 5 creados hoy en Buenos Aires y 10 `pendiente` abiertos desde la tienda) → motor (`sin_precio` / `no_disponible`) → en una sub-transacción, cupo de la tienda (`registrar_envio_tienda(empresa,'presupuesto',clave)` → `limite`) y escritura. **Desvío (T055)**: antes de todo eso, un **cupo de llamadas por cuenta** (`presupuesto|<cuenta>`, 10 por minuto; también cuentan las inválidas) corta el abuso antes del cálculo, y los topes y el motor van antes del cupo por hora para que un rechazo no lo gaste.
- **Escritura** (una transacción): `private.siguiente_numero_comprobante_org(org, empresa, 'presupuesto')` → `insert` en `dominio.comprobantes_venta` (`tipo='presupuesto'`, `estado='pendiente'`, `canal='tienda_online'`, `operador_id` nulo, `valido_hasta` nulo, `fecha = private.hoy_argentina()`, totales del motor, `cliente_id` y `empresa_id` de la cuenta) → líneas en `dominio.comprobantes_venta_lineas` con **todas** las columnas que completa `guardar_lineas_comprobante` (inventario en «Líneas del presupuesto» abajo), `precio_manual = false`, depósito por defecto activo que vende la tienda → `insert` en `dominio.presupuestos_tienda` (con la `nota` opcional de la persona, <= 500, que los comprobantes no pueden guardar) → `private.insertar_actividad(org, null, 'presupuesto.creado_desde_tienda', 'Presupuesto <N> pedido desde la tienda por el cliente Nº <n> · <nombre>', empresa)` (el tipo se da de alta en `public.tipos_evento_actividad`, no sensible).
- **Sin efectos de stock ni dinero**: no se llama a funciones de stock, reservas, cobros ni contrarreembolsos.
- **Salida**: `{"estado":"ok","numero","fecha","total_con_iva"}` | `invalido` (+ `campos`) | `sin_precio` (+ `producto_id`) | `no_disponible` (+ `producto_id`) | `limite` (+ `espera_segundos`) | `limite_cuenta` | `sin_acceso` | `error`.
- **Concurrencia**: dos llamadas simultáneas de la misma cuenta se serializan por el lock; con 4 creados hoy solo una de dos crea.

---

## Matriz de permisos y privilegios (probada con pgTAP)

| Objeto | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `publico.capacidades_tienda_por_dominio`, `publico.lista_pedido_por_dominio`, `publico.enviar_lista_pedido` | execute | execute | — |
| `publico.mis_compras_por_dominio`, `mi_compra_por_dominio`, `cambiar_favorito_por_dominio`, `mis_favoritos_por_dominio`, `favoritos_entre_por_dominio`, `cotizar_presupuesto_tienda`, `crear_presupuesto_tienda` | **sin** execute | execute (devuelve `sin_acceso` si no hay cuenta) | — |
| `private.cuenta_de_tienda`, `validar_items_pedido`, `motor_presupuesto_tienda`, `crear_consulta_pedido`, `siguiente_numero_comprobante_org`, `precio_para_calculo`, `precio_linea_venta_calculo` | sin | sin | — |
| `private.precio_para`, `private.precio_linea_venta` (envoltorios, MSF-816) | sin (grants de hoy) | los de hoy (no cambian) | — |
| `dominio.favoritos_cliente` | sin | **sin** | — |
| `dominio.consulta_items`, `dominio.presupuestos_tienda` | sin | select (RLS) | — |
| `publico.crear_consulta_publica` (existente) | sin | sin | execute (no cambia) |

## Eventos de actividad nuevos

| Tipo | Cuándo | Detalle (sin correo ni contacto) |
|---|---|---|
| `presupuesto.creado_desde_tienda` | B2, misma transacción que el alta | `Presupuesto <número> pedido desde la tienda <nombre> por el cliente Nº <n> · <nombre>` (empresa = la de la tienda; actor nulo, rotulado «Tienda online» en Actividad) |

## Líneas del presupuesto: columnas que completa B2 (inventario verificado contra `20270310100200_lineas_precio_promocional.sql`)

`dominio.comprobantes_venta_lineas`, una fila por línea, `orden` desde 1, igual que `public.guardar_lineas_comprobante`:

| Columna | Valor en B2 |
|---|---|
| `organizacion_id`, `comprobante_id`, `orden` | de la empresa del host, el comprobante creado y el orden de la lista |
| `producto_id`, `descripcion`, `codigo` | el producto (visible y activo) y la copia de su `nombre` y `sku` |
| `cantidad` | la validada (1 a 9.999) |
| `precio_unitario` | `neto_unitario` de `private.precio_linea_venta_calculo` (nunca nulo ni ≤ 0: si no, `sin_precio`) |
| `escala` | `escala_usada` (x1/x5/x10/x50 según el tipo del cliente y la cantidad de **esa** línea) |
| `precio_manual` | `false` (la tienda no tiene precio manual) |
| `alicuota_id`, `alicuota_porcentaje` | las del cálculo (0 si la alícuota es exenta) |
| `deposito_id` | el depósito por defecto, activo, que vende la tienda (`depositos_empresas`); sin ninguno: `error` genérico y nada se crea |
| `a_pedido` | `producto.disponibilidad_manual = 'a_pedido'` |
| `subtotal_sin_iva`, `iva` | `round(precio_unitario × cantidad, 2)` y `round(subtotal × porcentaje / 100, 2)` |
| `descuento_pct` | `descuento_aplicado` del cálculo (el de la ficha del cliente, o 0 si ganó la promoción) |
| `precio_referencia`, `promocion_id` | solo si ganó la promoción; si no, nulos |
| `sin_stock` | `false` (default) |

Cabecera: `total_sin_iva` = suma de subtotales y `total_con_iva` = `total_sin_iva` + suma de IVA (mismo cálculo que el panel; tope de importe `< 10^12`). Un test de paridad compara **todas** estas columnas contra las que arma el panel con las mismas líneas.
