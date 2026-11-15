---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Tienda online: lista de pedido, presupuesto y «Mi cuenta» (MSF-176)

**Épica:** MSF-176 · **Spec:** `tienda-compra-y-cuentas`
(`specs/20270306-100000-tienda-compra-y-cuentas/spec.md`, `plan.md`, `tasks.md` y
`contracts/tienda-compra-y-cuentas.md`; cierre de la spec en el commit `8b7f687f`).
**Historias:** **A** «Mi cuenta» (F-CLI-20 · MSF-452), **B1** «Lista de pedido sin cobro» y **B2**
«Presupuesto desde la tienda».
**Alcance de entrega:** `refine` y `supabase`. Sin `kestra`, `superset` ni `workers`: todo se resuelve con
consultas en vivo y funciones SQL.

Resumen para quien opera el sistema: [Pedidos y presupuesto desde la tienda](../producto/tienda-compra-y-cuentas.md).

## Qué entrega y qué no

| Dentro | Fuera |
|---|---|
| **A**: el cliente con cuenta web activa entra a «Mi cuenta» y ve sus compras y presupuestos de **esa** tienda, y guarda productos como favoritos. | Checkout, cobros en línea y medios de pago (F-TDA-26 completa). |
| **B1**: cualquier visitante arma una **lista de pedido** con cantidades y la envía **sin pagar**: llega a la bandeja de Consultas como consulta de origen **«Pedido»** con sus ítems. | Cotización de envíos, facturación fiscal (ARCA) y auto-registro de clientes. |
| **B2**: el cliente con cuenta activa pide un **presupuesto real** desde su lista: un comprobante `presupuesto` en estado `pendiente`, canal `tienda_online`, calculado por el servidor, **sin mover stock ni cobrar**. | Carrito persistente entre dispositivos, cupones, reserva o descuento de stock desde la tienda, correo al cliente de que su pedido avanzó. |

La venta se sigue cerrando **fuera del sistema** (pago, envío y factura), como hoy. F-TDA-27 y F-CON-07
quedan absorbidas por A; el checkout de F-TDA-26 sigue fuera de alcance.

**Estado del código.** La épica está implementada en las ramas `epic/MSF-176-tienda-compra-y-cuentas` y
`feat/MSF-176-cierre-hallazgos` (B1 en `feat/MSF-176-lista-de-pedido`, B2 en
`feat/MSF-176-presupuesto-tienda`) y mergeada a `dokploy`. En `main` —la rama desde la que se publica esta
documentación— el frente de la tienda todavía no está, como pasa con el resto del trabajo de tienda: las
afirmaciones de esta página citan las migraciones y los archivos de `dokploy`.

## Alcance de entrega

- **`supabase`**: migraciones **aditivas**, tres tablas nuevas en `dominio`, funciones de `publico` y de
  `private`, una vista nueva (`public.consulta_items_bandeja`) y lecturas del panel alteradas
  (`public.consultas_bandeja`, `public.listar_presupuestos`, `public.obtener_comprobante`).
- **`refine`**: dos rutas públicas nuevas (`/mi-cuenta` y `/lista`), componentes nuevos en
  `apps/web/src/pages/tienda-publica/` y ajustes en el panel (Consultas, Ventas, Actividad).
- **Sin** `workers`, `kestra`, `superset` ni Compose nuevo.

## Bandera de plataforma `tienda_pedidos`

Las tres historias están detrás de **una sola bandera**, apagada por defecto en todos los entornos
(D-19, D-24, D-27).

| Qué | Cómo |
|---|---|
| Dónde vive | `public.banderas_plataforma`, clave `tienda_pedidos` (fila agregada, apagada, en `20270320100000_tienda_capacidad.sql`) |
| Qué gobierna | «Mi cuenta», «Guardar en favoritos», «Mi lista», «Agregar a la lista» y toda RPC de la épica |
| Con ella apagada | las RPC de cuenta responden `sin_acceso` (las de visitante, `error`) **sin tocar datos**: lo impone el servidor, el front solo lo refleja |
| Cómo lo sabe el front público | `publico.capacidades_tienda_por_dominio(host)` → `{estado, pedidos}`; `anon` y `authenticated`. `anon` no puede leer la tabla de banderas |
| Quién la enciende | **solo dev** y solo con el script `scripts/tienda-pedidos-dev.mjs`. Staging y producción **no** se encienden en esta épica |

```bash
node scripts/tienda-pedidos-dev.mjs estado   --entorno dev
node scripts/tienda-pedidos-dev.mjs encender --entorno dev
node scripts/tienda-pedidos-dev.mjs apagar   --entorno dev
```

El script **se niega** (código de salida distinto de 0) si no recibe `--entorno dev` o si no puede demostrar
que la conexión es la de dev: con `SUPABASE_DB_URL` el host tiene que tener etiqueta `dev` y ninguna de
stg/stage/prod (los túneles se declaran en `TIENDA_PEDIDOS_DEV_DB_HOSTS`); sin esa variable usa `docker exec`
contra el contenedor `supabase_db_multistorefront-meli-supabase-dev`. Antes de tocar nada comprueba, con
una consulta de solo lectura, que la base es la de dev (existe la organización de demostración del `seed.sql`
con su id fijo). El SQL que se manda es fijo y viaja por `stdin`; la contraseña va por `PGPASSWORD`, nunca en
los argumentos.

Rige al instante, sin redesplegar.

## Identidad: un solo punto de aislamiento

`private.cuenta_de_tienda(host)` (`20270320100100_cuenta_de_tienda.sql`) devuelve
`(cuenta_cliente_id, cliente_id, organizacion_id, empresa_id, tipo)` del `auth.uid()` de la sesión **solo si**
la cuenta está `activa`, el cliente está habilitado en `clientes_empresas`, no está archivado, no es
consumidor final y la empresa del host está activa: la misma regla que `publico.acceso_cliente_por_dominio`.

En cualquier otro caso (sin sesión, sin cuenta, suspendida, no habilitada, otra tienda, usuario de panel,
host desconocido, empresa desactivada o tienda pausada) **no devuelve nada** y la RPC responde `sin_acceso`,
**idéntico en todos los casos**. El estado se consulta en cada llamada: la suspensión o la baja de
«Habilitado en» rigen en la próxima llamada.

**Ninguna RPC de la épica recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id`**: la identidad
sale de la sesión y del host, y nada más. Orden de verificaciones de todas las RPC: bandera → cuenta →
validar entradas → trabajar. Las respuestas son siempre `jsonb` con `estado`; el `exception when others`
registra solo el `sqlstate`, nunca el `sqlerrm`.

## Modelo de datos

Tres tablas nuevas en `dominio` (Principio VII) y dos alteradas. El detalle con el DER está en
[Datos y DER](datos.md#tienda-compra-y-cuentas-msf-176).

| Objeto | Estado | Qué es |
|---|---|---|
| `dominio.favoritos_cliente` | **nueva** | Favoritos de una cuenta web por tienda: `id`, `organizacion_id`, `empresa_id`, `cuenta_cliente_id`, `producto_id`, `creado_en`; única `(cuenta_cliente_id, producto_id)`. RLS activada **sin políticas** y **sin ningún privilegio** para `anon`, `authenticated` ni `public`: solo las RPC `security definer` la tocan |
| `dominio.consulta_items` | **nueva** | Líneas de una consulta de pedido: `descripcion` y `sku` copiados del producto, `cantidad` (1 a 9.999) y `precio_referencia` calculado por el servidor. RLS por organización, empresa accesible y sección `consultas` ≥ lectura; `select` solo para `authenticated` |
| `dominio.presupuestos_tienda` | **nueva** | Vínculo entre un presupuesto y la cuenta que lo pidió desde la tienda: da idempotencia, topes y trazabilidad. RLS por organización, empresa accesible y `ventas` ≥ lectura; `select` solo para `authenticated` |
| `dominio.consultas` | **alterada** | `origen` suma `pedido`; `cliente_id` nullable (FK compuesta a `public.clientes`) que fija **solo el servidor** con una cuenta activa; `consultas_mensaje_requerido` exime a `pedido` (la nota es opcional) |
| `dominio.tienda_envios` | **alterada** | `origen` suma `pedido` y `presupuesto` (el cupo por visitante es el mismo del formulario y de WhatsApp) |

Las FK compuestas llevan `organizacion_id`: una fila no puede apuntar a otra organización ni a una tienda
distinta de la de su cuenta. Las reversiones van en migraciones posteriores, nunca en el mismo PR.

## A · «Mi cuenta» (F-CLI-20 · MSF-452)

El cliente con cuenta web **activa** de una tienda ve sus compras y presupuestos de **esa** tienda y
guarda favoritos. Favoritos e historial son **por tienda** (D-2); el operador del panel **no** los ve (D-11).

### Contratos

| RPC | Quién | Salida |
|---|---|---|
| `publico.mis_compras_por_dominio(host, desde_fecha, desde_id, limite)` | `authenticated` | `{estado, total, filas:[{id, numero, fecha, tipo, estado_publico, total_con_iva}], siguiente}` · `sin_acceso` · `error`. Cursor `(fecha, id)` que **solo ordena**; `limite` acotado a 1–50 (20 por defecto) |
| `publico.mi_compra_por_dominio(host, comprobante_id)` | `authenticated` | Detalle con líneas (`descripcion`, `codigo`, `cantidad`, `precio_unitario`, `subtotal`) y totales · `no_encontrada` · `sin_acceso` · `error`. En una nota de crédito los totales y los subtotales van **negativos** |
| `publico.cambiar_favorito_por_dominio(host, producto_id, favorito)` | `authenticated` | `{estado, favorito}` · `limite_favoritos` · `no_encontrado` · `sin_acceso` · `error` |
| `publico.mis_favoritos_por_dominio(host, desde_creado, desde_id, limite)` | `authenticated` | `{estado, total, filas:[{producto_id, nombre, sku, imagen, disponible, precio_final, escala}], siguiente}` |
| `publico.favoritos_entre_por_dominio(host, productos)` | `authenticated` | `{estado, favoritos:[uuid]}` (máx. 50 ids) · `invalido` |

**Lista blanca.** El detalle es una lista blanca probada por claves: nunca costos, márgenes, descuento, precio
manual, depósito, operador, notas internas, forma de pago, envío ni cobros. Los estados de cobro y despacho
no se exponen (D-10): una factura `cobrado` o `deuda` figura «Confirmada».

**Estado público** (`private.estado_publico_comprobante`): presupuesto `pendiente` → «Pendiente» o «Vencido»
(según `valido_hasta` contra el día de Buenos Aires, `private.hoy_argentina()`), `aceptado` → «Aceptado»,
`anulada` → «Anulado»; factura confirmada o posterior → «Confirmada», `anulada` → «Anulada»; nota de crédito →
«Nota de crédito».

**Favoritos.** Alternar es idempotente (guardar dos veces no duplica; quitar uno inexistente no falla) y el
tope es de **200 por cuenta** con `pg_advisory_xact_lock`: el 201 responde `limite_favoritos` sin guardar.
Guardar exige que el producto sea **efectivamente visible** en la tienda (`private.catalogo_tienda_efectivo`):
inexistente, inactivo, oculto, de otra tienda o de otra organización responden todos `no_encontrado`. Un
favorito cuyo producto dejó de ser visible **no se lista ni se cuenta**, pero **no se borra**: reaparece al
volver a publicarse.

### Front

- `apps/web/src/pages/tienda-publica/rutas/mi-cuenta.tsx` con `?seccion=compras|favoritos` y
  `?compra=<id>`; componentes en `pages/tienda-publica/cuenta/` (`HistorialMiCuenta`, `DetalleCompra`,
  `FavoritosMiCuenta`, `BotonFavorito`, `EstadoComprobante`, `VacioMiCuenta`).
- Encabezado: `layout/AccesoCliente.tsx` suma «Mi cuenta» solo con cuenta activa y función encendida;
  `layout/MenuMovil.tsx` suma «Mi cuenta», «Mi lista» y «Salir».
- Ficha: `cuenta/BotonFavorito.tsx` dentro de `ficha/DatosProducto.tsx`, con `aria-pressed` y el estado de
  todos los productos de la pantalla en **una sola** llamada (`hooks/useFavoritosEntre.ts`).
- Datos: `lib/tiendaCapacidades.ts` + `hooks/useCapacidadesTienda.ts` (una llamada por host) y
  `lib/tiendaCuentaDatos.ts` (las cinco RPC, con lista blanca y traducción de errores a `ErrorCuentaTienda`).
- Sin sesión o con la cuenta no activa, `/mi-cuenta` redirige a `/ingresar?volver=<ruta>` **sin decir el
  motivo**; `rutas/ingresar.tsx` acepta `volver` solo con rutas internas (`lib/tiendaVolver.ts`).
- Con la cuenta suspendida a mitad de sesión, el primer error de acceso reemplaza todo el contenido por «Tu
  cuenta no está activa en esta tienda» y no deja datos previos en pantalla.

## B1 · Lista de pedido sin cobro

Un visitante (con o sin cuenta) arma una lista con productos y cantidades y la envía sin pagar ni reservar
nada: llega al operador a la bandeja de Consultas como una consulta de origen **«Pedido»** con sus ítems.

### Contratos

| RPC | Quién | Salida |
|---|---|---|
| `publico.lista_pedido_por_dominio(host, items)` | `anon`, `authenticated` | `{estado, con_cuenta, tipo, lineas[], no_disponibles[], total_referencia}` · `invalido` (+ `campos`) · `limite` (+ `espera_segundos`) · `error` |
| `publico.enviar_lista_pedido(host, nombre, contacto, nota, items, clave_envio)` | `anon`, `authenticated` | `{estado: ok}` · `invalido` (+ `campos`, nunca el valor) · `limite` · `error` |

- **Precio de referencia (D-28)**: el que la persona **ve en la tienda** (ficha con promoción vigente y,
  con cuenta activa, la escala de su tipo según la cantidad de esa línea), **sin** el descuento de la ficha
  del cliente: ese descuento aparece en la cotización de B2.
- **`no_disponibles`**: producto inexistente, de otra tienda u organización, oculto o inactivo, todos
  **indistinguibles**.
- Host desconocido = empresa desactivada = tienda pausada = bandera apagada: la misma respuesta, **antes** de
  validar los ítems.
- La lista se valida entera: 1 a 50 líneas, `cantidad` entera de 1 a 9.999, `producto_id` con forma de uuid,
  texto de a lo sumo 8.000 caracteres, repetidos sumados con tope y **ninguna clave ajena leída**
  (`private.validar_items_pedido`).
- Con cuenta activa, `nombre` y `contacto` recibidos **se ignoran**: se usan los de la ficha y la consulta
  guarda `cliente_id` (D-8, D-25).
- Un envío válido crea **una** consulta `origen = 'pedido'` y sus ítems en una sola transacción (todo o nada).
- Los productos **sin stock** se pueden agregar: quedan marcados «Sin stock hoy: lo confirmamos al responder».

### Límites y antispam

- **Envío**: 5 por hora por visitante y empresa, compartido con el formulario de contacto y con WhatsApp (un
  solo cupo por empresa y hash de IP; la IP nunca se guarda), con idempotencia por `clave_envio` y poda a 24 h
  (`private.registrar_envio_tienda`). Si la entrega falla se revierte también el registro: **no se gasta cupo**.
- **Llamadas**: `enviar_lista_pedido` consume un cupo propio de 20 por minuto y visitante **antes** de
  validar; `lista_pedido_por_dominio`, uno de 30 por minuto (limitador de pedidos públicos de la búsqueda).
- **Topes**: 50 líneas, 9.999 unidades por producto, nota ≤ 500.

### Lo que ve el operador

- Bandeja: origen «Pedido» y, en la columna Producto, «Pedido de n productos».
- Detalle (diálogo `md`, a pantalla completa en celular): bloque «Pedido» con Producto · SKU · Cantidad ·
  Precio de referencia · Subtotal, «Total de referencia», la nota «Precios de referencia calculados al
  enviar…» y «Mensaje» pasa a «Nota de la persona». Con cuenta activa aparece la fila «Cliente». Todo se
  muestra **como texto** (nunca HTML).
- «Responder por correo/WhatsApp» arma el texto inicial con los ítems y los enlaces `mailto:`/`wa.me` van
  codificados (`lib/textoInicialConsulta.ts`).

### Front

- `lib/listaPedido.ts` + `hooks/useListaPedido.ts`: la lista vive **en el navegador, por tienda**
  (`localStorage` con `try/catch` y respaldo en memoria; solo `producto_id` y `cantidad`, **nunca precios**).
- `lista/BotonAgregarALista.tsx` en la ficha, `lista/IndicadorLista.tsx` en el encabezado y
  `rutas/lista.tsx` con `PantallaLista`, `LineaLista`, `FormularioPedido` y `ConfirmacionPedido`.
- La ruta revalida al abrirla, al cambiar la lista y **antes de enviar**; ante cualquier error **la lista se
  conserva** y la confirmación dice «Recibimos tu pedido… No se cobró nada».

### Retención de los datos (D-20)

**No hay purga automática** de consultas, ítems de pedido, presupuestos de la tienda ni sus notas: no se
inventa un plazo legal y la supresión por titular tampoco existe como función. Se guarda lo mínimo (nombre,
contacto, nota e ítems; sin dirección, DNI ni CUIT; la IP nunca), lo ve solo quien tiene la sección
`consultas` ≥ lectura en esa empresa y no se borra solo. El seguimiento está trazado como **MSF-944**.

En el panel **no hay ninguna acción para borrar una consulta** (la única mutación es
`public.actualizar_consulta`: estado, responsable y nota). Para quitar los datos personales de una consulta
vinculada a un contacto está **Anonimizar** (`public.anonimizar_contacto`), que reemplaza nombre, contacto y
mensaje y borra la nota interna; los ítems del pedido se conservan porque son datos de producto. El detalle en
[Consultas](consultas.md#pedidos-de-la-tienda-b1-msf-176) y el paso a paso en el manual, en
[Consultas de las tiendas online](../producto/consultas.md#quitar-los-datos-personales-de-un-pedido).

## B2 · Presupuesto desde la tienda

Un cliente con **cuenta activa** pide, desde su lista, un **presupuesto real**: un comprobante `presupuesto`
en estado `pendiente`, canal `tienda_online`, sin operador y sin validez (D-13, D-21), con numeración
correlativa de la tienda, calculado por el servidor y **sin mover stock ni cobrar**.

### Contratos (solo `authenticated`; `anon` no tiene `execute`)

| RPC | Salida |
|---|---|
| `publico.cotizar_presupuesto_tienda(host, items)` | `{estado, lineas[], total_sin_iva, iva, total_con_iva, no_disponibles[], sin_precio[]}` · `invalido` · `limite` · `sin_acceso` · `error` |
| `publico.crear_presupuesto_tienda(host, items, nota, clave_envio)` | `{estado: ok, numero, fecha, total_con_iva}` · `invalido` · `sin_precio` · `no_disponible` · `limite` · `limite_cuenta` · `sin_acceso` · `error` |

La función **no recibe** cliente, cuenta, empresa, organización, precios, escala, descuento, depósito, estado
ni canal: la identidad sale solo de `private.cuenta_de_tienda(host)` y cada clave ajena del `jsonb` se ignora.

**Orden de verificaciones** (todas antes de escribir): bandera → cuenta (`sin_acceso`) → cupo de llamadas por
cuenta → validar `clave_envio`, `nota` e `items` → idempotencia → `pg_advisory_xact_lock` por cuenta y segunda
lectura de la idempotencia → **topes por cuenta** (5 presupuestos por día de Buenos Aires y 10 `pendiente`
abiertos; `limite_cuenta`) → motor → una sub-transacción con el cupo por hora de la tienda, el número, el
comprobante, las líneas, el vínculo y la actividad. Todo o nada: ante un error no queda número consumido ni
cupo gastado.

### El motor

`private.motor_presupuesto_tienda` es el **único** lugar que arma las líneas: la cotización y la creación lo
usan («lo que ves es lo que se crea», probado con el mismo total y los mismos precios). Toma de la cuenta el
cliente, la organización, la tienda, el **tipo** y el **descuento de la ficha**; solo acepta productos
efectivamente visibles; el precio es siempre el del cálculo sin sesión (abajo); sin precio en pesos o con
precio ≤ 0 responde `sin_precio` y **nunca** crea una línea en cero. El depósito es el por defecto, activo,
que vende la tienda; sin ninguno responde `error`.

### Lo que se escribe y lo que no

Se escribe el comprobante con **todas** las columnas que arma el panel, sus líneas, el vínculo en
`dominio.presupuestos_tienda` y el evento `presupuesto.creado_desde_tienda` (actor nulo; el texto lleva
número, tienda y cliente, **sin correo ni teléfono**). **No** llama a funciones de stock, reservas, cobros ni
contrarreembolsos: el pgTAP cuenta las filas antes y después. La numeración usa
`private.siguiente_numero_comprobante_org` (organización explícita, el mismo `insert … on conflict` atómico
que el panel).

### Lo que ve el operador

- **Ventas › Presupuestos**: estado «Pendiente» y la columna Operador dice «Tienda online (cliente)» (antes
  «Usuario sin nombre»). El origen se deriva del **vínculo real** en `dominio.presupuestos_tienda`, no del
  canal ni de un operador nulo.
- **Ficha del comprobante**: chip «Creado desde la tienda por el cliente», Operador «Tienda online (cliente)» y
  la «Nota del cliente» (texto literal). Se modifica, acepta y copia con los flujos de siempre. Un presupuesto
  **no se anula** (el flujo vigente solo anula facturas confirmadas): queda `pendiente` hasta que el operador
  lo acepta, lo modifica o lo copia; hoy no hay botón para convertirlo en factura.
- **Actividad**: el evento se rotula «Tienda online» en «Quién» (lista, detalle y exportación); los demás
  eventos sin actor siguen diciendo «Sistema».

## Precios: el cálculo sin sesión de panel (D-17)

`private.precio_para` y `private.precio_linea_venta` (MSF-816) exigían una sesión de panel, y dos piezas
internas fallaban **en silencio** sin ella (IVA 0 por `alicuota_producto` y precio propio ignorado por
`precio_propio_empresa`). La migración `20270322100000_precio_sin_sesion.sql` **extrae el cálculo** a tres
funciones nuevas de `private`, sin `execute` para `public`, `anon`, `authenticated` ni `service_role`:

| Función | Qué es |
|---|---|
| `private.precio_para_calculo(producto, empresa, escala)` | La lógica de `precio_para` sin compuerta de sesión: `security definer`, `search_path = ''`, acotada por la organización **de la empresa** |
| `private.precio_linea_venta_calculo(...)` | La lógica de `precio_linea_venta` («gana el más bajo, sin acumular») sobre aquélla; **la llama la tienda** con el tipo y el descuento del cliente de la cuenta |
| `private.precio_sesion_alcanza(producto, empresa)` | La compuerta y el aislamiento de la sesión de panel, en un solo lugar |

`precio_para` y `precio_linea_venta` quedan como **envoltorios** (misma firma, columnas y grants): validan la
escala, preguntan a `precio_sesion_alcanza` y delegan. El resultado para el panel es el mismo (lo comprueban los
pgTAP vigentes y `precio_sin_sesion.test.sql`). Detalle y diferencias deliberadas:
[Precios e IVA](precios-e-iva.md#el-calculo-de-precio-sin-sesion-de-panel-msf-176).

## Front (resumen)

| Pieza | Dónde |
|---|---|
| Rutas públicas | `apps/web/src/pages/tienda-publica/rutas/mi-cuenta.tsx` y `lista.tsx` (el nombre del archivo define la ruta; `EnrutadorTienda` las carga con `import.meta.glob`) |
| Pantallas de «Mi cuenta» | `pages/tienda-publica/cuenta/` |
| Pantallas de la lista | `pages/tienda-publica/lista/` |
| Estado de la lista (navegador) | `apps/web/src/lib/listaPedido.ts` + `hooks/useListaPedido.ts` |
| Llamadas | `lib/tiendaCapacidades.ts`, `lib/tiendaCuentaDatos.ts`, `lib/tiendaPedido.ts` (solo `producto_id` y `cantidad`, nunca precios) |
| Panel | `lib/consultas.ts` (origen `pedido`), `pages/consultas/list.tsx`, `components/consultas/DetalleConsulta.tsx` + `BloquePedido.tsx`, `lib/textoInicialConsulta.ts`, `pages/ventas/presupuestos.tsx` y `comprobante.tsx`, `pages/actividad/list.tsx` y `lib/actividad.ts` |

Con la bandera apagada la tienda no dibuja ningún control de la épica (ni deja un hueco reservado) y `/mi-cuenta`
y `/lista` responden la página «no encontrada» de la tienda.

## Pruebas

| Tipo | Dónde | Qué cubre |
|---|---|---|
| pgTAP | `supabase/tests/database/tienda_capacidades.test.sql` | Bandera apagada por defecto, `pedidos` true/false, host desconocido = empresa desactivada, **lista cerrada** de las funciones de `publico` ejecutables por `anon` (hay que sumar a propósito cada una nueva) |
| pgTAP | `tienda_cuenta_de_tienda.test.sql` | Dos organizaciones y dos tiendas: suspendida, no habilitada, otra tienda, panel, anónimo, archivado, consumidor final, host desconocido y empresa desactivada → vacío |
| pgTAP | `tienda_favoritos.test.sql` | Alternar idempotente, tope 200, producto oculto/inactivo/ajeno/inexistente idénticos, aislamiento entre cuentas y entre tiendas, cursor forjado, lista blanca y superficie de `anon` |
| pgTAP | `tienda_historial.test.sql` | Solo lo del cliente y la tienda, sin borradores, notas de crédito negativas, estado público, IDOR idéntico a inexistente, lista blanca por claves, suspensión inmediata |
| pgTAP | `tienda_lista_pedido.test.sql` | Batería de entradas hostiles, paridad de precio con `producto_por_dominio`, indisponibles indistinguibles, idempotencia, sexto envío = `limite`, caracteres de control, `<script>` literal, aislamiento entre organizaciones, cupo de lecturas |
| pgTAP | `precio_sin_sesion.test.sql` | Paridad del cálculo sin sesión con el del panel (más de 4.700 combinaciones) y el cliente web con IVA y precio propio correctos |
| pgTAP | `tienda_presupuesto_cliente.test.sql` | IDOR, `sin_acceso` idéntico, claves ajenas ignoradas, paridad con el panel en **todas** las columnas, `sin_precio`, cero efectos de stock y cobros, topes, concurrencia con lock, idempotencia, superficie de `anon` |
| Vitest + axe | `apps/web/src/lib/`, `hooks/`, `pages/tienda-publica/cuenta/`, `pages/tienda-publica/lista/`, `components/consultas/DetallePedido.test.tsx` | Cada estado (cargando, vacío, error, fin de lista, sin acceso, función apagada) a 320, 768 y 1440 px; render literal de `<script>`; enlaces `mailto:`/`wa.me` codificados; cambio de empresa activa con un pedido abierto |
| E2E | `apps/web/e2e/tienda-cuenta.e2e.ts` | `[MSF-452:T022]` |
| E2E | `apps/web/e2e/tienda-lista-pedido.e2e.ts` | `[MSF-176:T043]` |
| E2E | `apps/web/e2e/tienda-presupuesto.e2e.ts` | `[MSF-176:T061]` |

Los E2E corren en el job `e2e-tienda` con la bandera encendida por el propio spec (que la restaura al
terminar) y **se omiten** si la base todavía no tiene las RPC de la historia: en ese caso el job falla
`e2e:omitidos:check --max=1`.

## Cómo probarlo (guía técnica)

Los pasos manuales de esta épica, para una persona que prueba la tienda, están en la página de producto
([Pedidos y presupuesto desde la tienda](../producto/tienda-compra-y-cuentas.md)). Acá va la guía técnica, a
nivel de base de datos y sin video.

### Prerrequisitos

- Una base de **dev** con las migraciones de la épica aplicadas (`supabase/migrations/20270320…`,
  `20270321…` y `20270322…`).
- La bandera encendida: `node scripts/tienda-pedidos-dev.mjs encender --entorno dev`.
- Semilla: las dos tiendas del `seed.sql` (Mundo JC y San Javucho) con productos publicados y visibles, y
  una **cuenta web activa** (la crea el panel; ver [Cuenta web del cliente](cuenta-web-cliente.md)).
- Un cliente con cuenta en la tienda y, para el panel, un usuario con permiso de `consultas` y de `ventas`.

### Pasos

1. **Bandera.** `select clave, activa from public.banderas_plataforma where clave = 'tienda_pedidos';`
   → `t` en dev, `f` en cualquier otro entorno.
2. **Superficie pública.** `select has_function_privilege('anon', 'publico.capacidades_tienda_por_dominio(text)', 'EXECUTE'),
   has_function_privilege('anon', 'publico.enviar_lista_pedido(text,text,text,text,jsonb,uuid)', 'EXECUTE'),
   has_function_privilege('anon', 'publico.crear_presupuesto_tienda(text,jsonb,text,uuid)', 'EXECUTE');`
   → `true`, `true`, **`false`**: el presupuesto es solo de `authenticated`.
3. **Enviar una lista de pedido como visitante** (sin sesión):
   `select publico.enviar_lista_pedido('mundojc.localhost', 'Ana', 'ana@example.com', 'Sin nota',
   '[{"producto_id": "<id de un producto publicado>", "cantidad": 2}]'::jsonb, gen_random_uuid());`
   → `{"estado":"ok"}`. Repetir con la **misma** `clave_envio` → `ok` y **una sola** consulta:
   `select count(*) from dominio.consultas where origen = 'pedido';`
4. **Ver los ítems** que calculó el servidor:
   `select descripcion, sku, cantidad, precio_referencia from dominio.consulta_items order by orden;`
   → las líneas con el precio de referencia de la tienda (no el que mandó el visitante).
5. **Presupuesto con la sesión del cliente** (JWT de la cuenta web, no de panel):
   `select publico.crear_presupuesto_tienda('mundojc.localhost', '[{"producto_id": "<id>", "cantidad": 3}]'::jsonb,
   null, gen_random_uuid());` → `{"estado":"ok","numero":"00000012", …}`. Sin sesión o con la cuenta
   suspendida → `sin_acceso`.
6. **Cero efectos de dinero ni de stock**: contá `dominio.movimientos_stock`, `dominio.reservas_stock`,
   `dominio.cobros_comprobante` y `dominio.contrarreembolsos` antes y después del paso 5: los números no
   cambian, y el comprobante queda `pendiente`.
7. **Historial y favoritos del cliente** (con la sesión del cliente):
   `select publico.mis_compras_por_dominio('mundojc.localhost', null, null, 20);` → sus comprobantes de esa
   tienda, con estado público y total con IVA; `select publico.cambiar_favorito_por_dominio('mundojc.localhost',
   '<id de producto>', true);` → `ok`. Con la sesión de **otro** cliente, el historial viene vacío o
   `sin_acceso`: nunca datos ajenos.
8. **Apagar la bandera** (`node scripts/tienda-pedidos-dev.mjs apagar --entorno dev`) y repetir un paso de
   cuenta: la RPC responde `sin_acceso` y las rutas de la tienda dan «no encontrada».

### Resultado esperado

- **Dado** un visitante sin cuenta, **cuando** envía una lista de dos productos, **entonces** el operador ve
  en la bandeja una consulta de origen «Pedido» con los dos ítems, sus cantidades y el precio de referencia
  calculado por el servidor, y no se cobró ni se reservó stock.
- **Dado** un cliente con cuenta activa, **cuando** pide un presupuesto desde su lista, **entonces** existe un
  comprobante `presupuesto`, `pendiente`, canal `tienda_online`, con el número correlativo de la tienda, sin
  movimientos de stock ni cobros, y visible en Ventas con el operador «Tienda online (cliente)».
- **Dado** una cuenta suspendida o de otra tienda, **cuando** llama a las RPC de cuenta, **entonces** recibe
  `sin_acceso` sin que se devuelva ningún dato.
- **Dado** la bandera apagada, **cuando** se entra a `/mi-cuenta` o `/lista`, **entonces** la tienda
  responde «no encontrada» y ninguna RPC toca datos.

### Cómo automatizarlo

- **pgTAP**: `supabase/tests/database/tienda_lista_pedido.test.sql` (B1),
  `tienda_presupuesto_cliente.test.sql` (B2), `tienda_favoritos.test.sql` y `tienda_historial.test.sql` (A),
  `precio_sin_sesion.test.sql` (D-17) y `tienda_capacidades.test.sql` (superficie de `anon`). Se corren con
  `pnpm test:db` (o `pnpm test:db:ci` con el stack de CI).
- **Vitest + axe**: los archivos de `apps/web/src/lib/`, `hooks/`, `pages/tienda-publica/cuenta/` y
  `pages/tienda-publica/lista/` (320, 768 y 1440 px).
- **E2E** (Playwright, job `e2e-tienda`, sin escritura directa en las tablas de solo lectura):
  - `[MSF-452:T022]` — «Mi cuenta»: historial, favoritos, cuenta suspendida y 200 comprobantes por tandas.
  - `[MSF-176:T043]` — lista de pedido: tres productos desde las fichas, envío, la consulta «Pedido» en la
    bandeja, el sexto envío con aviso de límite y la bandera apagada.
  - `[MSF-176:T061]` — presupuesto: el mayorista pide y el operador lo acepta sin stock ni cobros, el sexto
    del día, dos llamadas simultáneas que crean una y la idempotencia.

## Límites, deuda y seguimientos

- **La función está apagada por defecto**: hasta que no se encienda en dev, ninguna de estas pantallas
  existe para el público. Encenderla en otro entorno exige una decisión nueva con demanda medida (D-24).
- **El checkout no existe**: la tienda sigue sin cobrar, sin cotizar envíos y sin emitir factura.
- **Sin purga automática** de consultas, ítems de pedido, presupuestos de la tienda ni sus notas (D-20).
- **Seguimientos trazados** en el tracker: **MSF-940** (aviso al equipo por presupuesto nuevo desde la
  tienda), **MSF-941** («Crear presupuesto desde la consulta» en el panel), **MSF-942** (filtro por canal en
  Presupuestos), **MSF-943** (validez por defecto del presupuesto) y **MSF-944** (retención y supresión de
  consultas, ítems de pedido y presupuestos de la tienda).
- **Revisión de seguridad**: la integral de la épica está en `docs/seguridad-tienda-compra-y-cuentas.md` en la
  rama de la épica; recorre las tres tablas del modelo de amenazas de la spec contra el código final.
- **Pendiente de documentación**: faltan las capturas de pantalla de la historia A, B1 y B2 en el manual
  (`docs/producto/img/tienda-compra-y-cuentas/`). No se pudieron generar porque la herramienta de capturas del
  manual (`pnpm docs:capturas` y `pnpm demo:dataset`) **no existe en este repo** y el frente de la tienda
  todavía no está en `main`. **Dueño: documentación de producto.**
- **Pendiente de documentación**: la página de seguridad de la épica
  (`docs/seguridad-tienda-compra-y-cuentas.md`) vive en la rama de la épica; hay que traérla al árbol de
  documentación de `main`. **Dueño: seguridad / documentación técnica.**
