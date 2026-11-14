---
owner: producto
sources:
  - specs/20270306-100000-tienda-compra-y-cuentas
---

# Tienda online · Compra y cuentas (MSF-176)

Épica MSF-176, spec `specs/20270306-100000-tienda-compra-y-cuentas/spec.md`
(contrato: `specs/20270306-100000-tienda-compra-y-cuentas/contracts/tienda-compra-y-cuentas.md`).
Tres historias detrás de **una sola bandera de plataforma** (`tienda_pedidos`, apagada por defecto): **A** «Mi cuenta» (F-CLI-20,
MSF-452), **B1** lista de pedido sin cobro y **B2** presupuesto desde la tienda. Esta página crece historia por historia; hoy
documenta **A**, **B1** y los cimientos compartidos (B2 todavía no existe).

## Bandera `tienda_pedidos` (D-19, D-24, D-27)

| Qué | Cómo |
|---|---|
| Dónde vive | `public.banderas_plataforma`, clave `tienda_pedidos`, **apagada por defecto en todo entorno** (migración `20270320100000_tienda_capacidad.sql`) |
| Qué gobierna | «Mi cuenta», «Guardar en favoritos», «Mi lista», «Agregar a la lista» y toda RPC de la épica |
| Con ella apagada | las RPC de cuenta responden `{"estado":"sin_acceso"}` **sin tocar datos** (el servidor lo impone; el front solo lo refleja) |
| Cómo lo sabe el front público | `publico.capacidades_tienda_por_dominio(host)` → `{estado:"ok", pedidos:true\|false}` (`anon` y `authenticated`); host desconocido, empresa desactivada y tienda pausada responden lo mismo (`{estado:"error"}`). `anon` no puede leer la tabla de banderas |
| Quién la enciende | **solo dev** y solo con el script; ninguna migración ni despliegue la enciende. Staging y producción **no** se encienden en esta épica (D-24) |

### Encender y apagar en dev

```bash
node scripts/tienda-pedidos-dev.mjs estado   --entorno dev
node scripts/tienda-pedidos-dev.mjs encender --entorno dev
node scripts/tienda-pedidos-dev.mjs apagar   --entorno dev
```

El script (`scripts/tienda-pedidos-dev.mjs`, también `pnpm tienda:pedidos:dev …`; prueba `scripts/tienda-pedidos-dev.test.mjs` con `pnpm test:tienda:pedidos-dev`) **se niega** (código de salida distinto de 0 y
mensaje en castellano) si no recibe `--entorno dev` o si no puede demostrar que la conexión es la de dev:

- con `SUPABASE_DB_URL` (la variable de `scripts/migrar-supabase-cloud.mjs`), el host tiene que tener una etiqueta `dev`
  (p. ej. `supabase-dev.212-90-120-53.sslip.io`) y ninguna de stg/stage/staging/qa/uat/test/pre/preprod/prod/prd/production ni ser de la nube de Supabase; un túnel
  a la base de dev se declara a propósito en `TIENDA_PEDIDOS_DEV_DB_HOSTS` (hosts separados por coma). La contraseña viaja por
  `PGPASSWORD`, no por argv, y requiere `psql`. Defensas contra un destino disfrazado: se rechaza la URL si su autoridad tiene `?`, `,`,
  `%` o más de una `@` o si la query trae algo fuera de la lista permitida (solo `sslmode` con require/verify-ca/verify-full/prefer y `connect_timeout` numérico); del entorno del proceso hijo se
  borran `PGHOST`, `PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGOPTIONS`, `PGSSLMODE`, `PGTARGETSESSIONATTRS`, `PGSYSCONFDIR`, `DOCKER_HOST` y `DOCKER_CONTEXT`; y **antes de tocar nada, también en modo contenedor**, se comprueba por positivo, con una consulta de solo lectura, que la base se identifica como dev: existe una organización de demostración con el **id fijo del seed** (`supabase/seed.sql`: `0f5eed00-0000-4000-8000-000000000001` «Mundo JC (demo)» o `…0002` «San Javucho (demo)») y nombre «… (demo)». Si la organización demo de dev tiene otro id, se declara a propósito en `TIENDA_PEDIDOS_DEV_ORG_IDS` (uuids separados por coma); no hace falta escribir nada en dev, y si no hay ninguna el script se niega. Los argumentos se aceptan en cualquier orden
  (`--entorno dev encender` o `encender --entorno dev`);
- sin `SUPABASE_DB_URL`, usa `docker exec` contra el contenedor `supabase_db_multistorefront-meli-supabase-dev` (el mismo nombre que usa el cron
  de migraciones del VPS), que es dev por construcción;
- el SQL es fijo (un `update … where clave = 'tienda_pedidos'` o un `select`) y viaja por stdin.

Rige al instante (sin redesplegar). Equivale al `update public.banderas_plataforma set activa = true|false where clave = 'tienda_pedidos'`
de [`deployment.md`](./deployment.md#banderas-de-plataforma-msf-363), pero con las guardas contra tocar otro entorno.

## A · «Mi cuenta» (F-CLI-20 · MSF-452)

El cliente con cuenta web **activa** de una tienda ve sus compras y presupuestos de **esa** tienda y guarda productos como favoritos.
Todo es **por tienda** (D-2): la misma persona con cuentas en San Javucho y Mundo JC ve en cada dominio solo lo suyo.

### Modelo de datos (Principio VII)

| Objeto | Esquema | Por qué | Acceso |
|---|---|---|---|
| `dominio.favoritos_cliente` (nueva: `id`, `organizacion_id`, `empresa_id`, `cuenta_cliente_id`, `producto_id`, `creado_en`; única `(cuenta_cliente_id, producto_id)`) | `dominio` | dato del negocio sobre productos del catálogo; se ata a la cuenta (identidad, `public`) y al producto | RLS activada **sin políticas** y **sin ningún privilegio** para `anon`, `authenticated` ni `public`: solo las RPC `security definer` la leen y escriben (y `service_role`, la API admin de E2E, siembra y workers, como toda tabla operativa de `dominio`) |
| `private.cuenta_de_tienda(host)` | `private` | único punto de identidad y aislamiento de las RPC de cuenta | sin `execute` para la API |
| `private.estado_publico_comprobante(tipo, estado, valido_hasta)` | `private` | única definición del estado público (lista y detalle) | sin `execute` para la API |
| `publico.cambiar_favorito_por_dominio`, `mis_favoritos_por_dominio`, `favoritos_entre_por_dominio`, `mis_compras_por_dominio`, `mi_compra_por_dominio` | `publico` | superficie de la tienda (`publico` sigue sin tablas) | solo `authenticated` (`revoke … from public, anon` + `grant execute … to authenticated`) |

Aislamiento de `favoritos_cliente`: FK compuestas `(cuenta_cliente_id, organizacion_id, empresa_id)` → `public.cuentas_cliente`
(índice único aditivo `cuentas_cliente_id_org_empresa_uq`), `(empresa_id, organizacion_id)` → `dominio.empresas` y
`(producto_id, organizacion_id)` → `dominio.productos`, todas con `on delete cascade`: una fila no puede mezclar organizaciones ni apuntar
a una tienda distinta de la de su cuenta. Quien opera el panel **no ve** los favoritos del cliente (D-11).

### Migraciones (aditivas)

| Migración | Contenido | Reversión (migración posterior) |
|---|---|---|
| `20270320100000_tienda_capacidad.sql` | fila `tienda_pedidos` (apagada) y `publico.capacidades_tienda_por_dominio` | borrar la fila; `drop function` |
| `20270320100100_cuenta_de_tienda.sql` | `private.cuenta_de_tienda(host)` | `drop function` |
| `20270320100200_favoritos_cliente.sql` | tabla `dominio.favoritos_cliente` e índice único de apoyo en `cuentas_cliente` | `drop table` (exportar antes); `drop index` |
| `20270320100300_tienda_favoritos_rpc.sql` | RPC de favoritos | `drop function` de cada una |
| `20270320100400_tienda_historial_rpc.sql` | RPC de historial, `private.estado_publico_comprobante` e índice `(cliente_id, empresa_id, fecha desc, id desc)` en `dominio.comprobantes_venta` | `drop function` de cada una; `drop index` |
| `20270320100500_exportacion_total_excluye_favoritos.sql` | `private.exclusiones_exportacion_total()` suma `dominio.favoritos_cliente` (los favoritos son privados del cliente, D-11: no entran en la exportación total del administrador) | redefinir la función sin esa fila |

Ninguna reversión se ejecuta en el mismo PR. Las versiones se fijaron por encima del máximo real de `origin/dokploy` con margen.

### Identidad: `private.cuenta_de_tienda(host)`

Devuelve `(cuenta_cliente_id, cliente_id, organizacion_id, empresa_id, tipo)` de `auth.uid()` en la tienda del host **solo** si la cuenta está
`activa`, el cliente está habilitado en `clientes_empresas`, no está archivado, no es consumidor final y la empresa del host está activa
(misma regla que `publico.acceso_cliente_por_dominio`). En cualquier otro caso (sin sesión, sin cuenta, suspendida, no habilitada,
otra tienda, usuario de panel, host desconocido, empresa desactivada o pausada) no devuelve nada y la RPC responde **`sin_acceso`, idéntico en todos
los casos**. El estado se consulta en cada llamada: la suspensión o la baja de «Habilitado en» rigen en la próxima llamada. **Ninguna RPC de A
recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id`**; todo sale de la sesión y del host.

Orden de verificaciones de toda RPC: bandera → `cuenta_de_tienda` → validar entradas → trabajar. Respuestas siempre `jsonb` con `estado`;
el `exception when others` registra solo `sqlstate`, nunca `sqlerrm`.

### Contratos

| RPC | Entrada | Salida |
|---|---|---|
| `publico.mis_compras_por_dominio(host, desde_fecha, desde_id, limite)` | cursor `(fecha, id)` que **solo ordena**; `limite` acotado a 1–50 (20 por defecto); un cursor a medias se ignora | `{estado:"ok", total, filas:[{id, numero, fecha, tipo, estado_publico, total_con_iva}], siguiente:{fecha,id}\|null}` · `sin_acceso` · `error` |
| `publico.mi_compra_por_dominio(host, comprobante_id)` | un id | `{estado:"ok", numero, fecha, tipo, estado_publico, valido_hasta, total_sin_iva, iva, total_con_iva, lineas:[{descripcion, codigo, cantidad, precio_unitario, subtotal}]}` · `no_encontrada` · `sin_acceso` · `error`. En una nota de crédito los totales y el `subtotal` de cada línea van **negativos** (el `precio_unitario` queda positivo) para que las líneas sumen el total con signo |
| `publico.cambiar_favorito_por_dominio(host, producto_id, favorito)` | `favorito` true/false | `{estado:"ok", favorito}` · `limite_favoritos` · `no_encontrado` · `sin_acceso` · `error` |
| `publico.mis_favoritos_por_dominio(host, desde_creado, desde_id, limite)` | cursor `(creado_en, id)` que solo ordena; `limite` 1–50 | `{estado:"ok", total, filas:[{producto_id, nombre, sku, imagen, disponible, precio_final, escala}], siguiente:{creado,id}\|null}` |
| `publico.favoritos_entre_por_dominio(host, productos)` | hasta 50 ids | `{estado:"ok", favoritos:[uuid]}` · `{estado:"invalido", campos:["productos"]}` |

**Historial (D-10).** Todos los comprobantes del cliente **en esa tienda**, de cualquier canal (mostrador, teléfono o tienda online), **sin borradores**,
nuevos primero (`fecha desc, id desc`). `tipo`: factura → `compra`, presupuesto → `presupuesto`, nota de crédito → `nota_credito` (su importe va con signo
negativo, también en el detalle). El detalle es una **lista blanca de campos probada por claves**: nunca costos, márgenes, descuento, precio manual,
depósito, operador, notas, cliente, organización, forma de pago, envío ni cobros.

**Estado público (FR-004).** Se deriva y nunca expone cobro ni despacho:

| Comprobante | Estado interno | `estado_publico` |
|---|---|---|
| Presupuesto | `pendiente` con `valido_hasta` ≥ hoy o nulo | `pendiente` |
| Presupuesto | `pendiente` con `valido_hasta` < hoy (día de Buenos Aires, `private.hoy_argentina()`) | `vencido` |
| Presupuesto | `aceptado` | `aceptado` |
| Presupuesto | `anulada` | `anulado` |
| Factura | `confirmada`, `cobrado`, `deuda`, `en_proceso`, `armando`, `incompleto` (todo estado confirmado o posterior) | `confirmada` |
| Factura | `anulada` | `anulada` |
| Nota de crédito | cualquiera salvo borrador | `nota_credito` |

**Favoritos (FR-007 a FR-010, D-11).** Alternar es idempotente: guardar dos veces no duplica y quitar uno que no existe no falla. **Tope de 200 por cuenta** con
`pg_advisory_xact_lock` por cuenta: el 201 responde `limite_favoritos` sin guardar (guardar uno que ya existe sigue siendo `ok` en el tope). El tope cuenta **solo los favoritos de productos visibles hoy**: con 150 visibles y 50 ocultos se puede guardar el 151. Guardar exige que
el producto sea **efectivamente visible** en la tienda (`private.catalogo_tienda_efectivo`): inexistente, inactivo, oculto, de otra tienda o de otra
organización responden todos `no_encontrado`. «Favoritos» solo lista y cuenta los productos **visibles hoy**: un favorito cuyo producto se ocultó no se lista
ni se cuenta, pero **no se borra** y reaparece al volver a publicarse. Muestra solo `disponible` (sin cantidades de stock) y `precio_final` con la escala x1
(la de la ficha a cantidad 1, `private.precio_final_publico_escala`).

**Decisiones que el contrato y la spec ya recogen** (código, contrato y spec coinciden):

- **Quitar** un favorito (`favorito = false`) no exige que el producto siga visible: siempre responde `ok` y solo toca filas de su propia cuenta; `no_encontrado` aplica solo al guardar.
- `siguiente` de `mis_favoritos_por_dominio` es `{creado, id}` (el `id` es el de la fila de favorito) y se devuelve tal cual en `desde_creado` y `desde_id`.
- Con host desconocido, empresa desactivada o tienda pausada las RPC de cuenta responden `sin_acceso` (igual que cualquier falta de cuenta), no `error`.
- Notas de crédito: totales y subtotales de línea negativos (precio unitario positivo); las líneas suman el total con signo solo en las notas por **devolución de productos** (las de importe o descuento no tienen líneas).
- **Rendimiento de guardar un favorito**: una sola evaluación de `private.catalogo_tienda_efectivo` por llamada (visibilidad y conteo del tope). Medición local con `scripts/medir-tienda-favoritos.sql` (estimación, no SLA): ~12 ms con 2.000 productos y ~35–50 ms con 10.000 en una tienda; límite aceptado ~10.000 productos visibles por tienda (ver el contrato). El total visible puede superar 200 si se republican productos ocultos; las filas están acotadas por la cantidad de productos de la tienda.

### Pruebas (pgTAP)

| Archivo | Cubre |
|---|---|
| `supabase/tests/database/tienda_capacidades.test.sql` | bandera apagada por defecto, `pedidos` true/false, host desconocido = empresa desactivada, claves exactas, `anon` sin acceso a la tabla de banderas y **lista cerrada** de las funciones de `publico` ejecutables por `anon` (hay que sumar a propósito cada una nueva) |
| `supabase/tests/database/tienda_cuenta_de_tienda.test.sql` | dos organizaciones y dos tiendas: suspendida, no habilitada, otra tienda, panel, anónimo, archivado, consumidor final, host desconocido, empresa desactivada y otra organización → vacío; suspensión y baja rigen en la próxima llamada |
| `supabase/tests/database/tienda_favoritos.test.sql` | alternar idempotente, tope 200, producto oculto/inactivo/ajeno/inexistente idénticos, aislamiento entre cuentas y entre tiendas del mismo cliente, oculto no se lista y reaparece, cursor forjado, orden «nuevos primero» con empates y un alta y una baja entre páginas, quitar el mismo producto en tres cuentas sin cruzarlas, tope contando solo visibles, quitar con el producto oculto, lista vacía, `favoritos_entre` ≤ 50, bandera apagada, tabla sin privilegios de API, FK compuestas, `anon` sin `execute`, `search_path` vacío |
| `supabase/tests/database/tienda_historial.test.sql` | solo lo del cliente y la tienda, sin borradores, notas de crédito negativas, estado público, vencido por Buenos Aires, IDOR idéntico a inexistente, lista blanca exacta por claves, cursor y límite (tope de 50 con más de 50 comprobantes, desempate por id con límite 1), lista vacía, nota de crédito con líneas negativas, el «hoy» de Buenos Aires (sin `current_date` ni `now()`), suspensión inmediata, bandera apagada |

### Front de A (`apps/web`)

**Qué es.** El cliente con cuenta web **activa** entra a `/mi-cuenta` y ve sus compras y presupuestos de esa tienda y sus favoritos; guarda favoritos desde la ficha. Favoritos e historial son por tienda (D-2); el operador del panel no los ve (D-11). Las llamadas van contra el contrato de las RPC `publico.*` de arriba.

### Front: capacidades y bandera

- Con `tienda_pedidos` **apagada** la tienda no muestra «Mi cuenta», «Mi lista»
  ni «Guardar en favoritos», y `/mi-cuenta` responde la página «no encontrada». El servidor lo impone en cada RPC; el front solo lo
  refleja.
- El front público no puede leer la bandera (`public.banderas_plataforma` no es legible por `anon`): la conoce por
  `publico.capacidades_tienda_por_dominio(host)` (D-27), que devuelve solo `{estado, pedidos}`.
  `lib/tiendaCapacidades.ts` hace **una llamada por host** (la comparten encabezado, menú, ficha y rutas) y
  `hooks/useCapacidadesTienda.ts` la expone como `cargando | error | lista`. Mientras no responde, o si falla, **no se dibuja nada
  de la épica** (ni deja un hueco reservado).
- Cómo encenderla: ver «Encender y apagar en dev» arriba (`scripts/tienda-pedidos-dev.mjs`, solo dev, D-24).

### Front: pantallas (spec «Pantallas y textos»)

| Pantalla | Dónde vive | Comportamiento |
|---|---|---|
| **P-1** Encabezado | `layout/AccesoCliente.tsx`, `layout/MenuMovil.tsx` | Con cuenta activa y la función encendida suma «Mi cuenta» (a `/mi-cuenta`) junto a «Salir». Sin sesión sigue «Ingresar». En celular y tableta (bajo `md`) el «Salir» pasa al menú ☰, que suma «Mi cuenta», «Mi lista» y «Salir» al final (con la función apagada, «Salir» queda en el encabezado como siempre). «Mi lista» enlaza a `/lista`, que construye la historia B1. |
| **P-2** Ficha | `cuenta/BotonFavorito.tsx` en `ficha/DatosProducto.tsx` | «Guardar en favoritos» / «Quitar de favoritos» (`aria-pressed`) debajo de los botones, último en la tabulación. El estado de todos los productos de la pantalla sale de **una sola** llamada (`favoritos_entre_por_dominio`, `hooks/useFavoritosEntre.ts`). Sin sesión es un enlace a `/ingresar?volver=<ficha>` con «Ingresá para guardar tus favoritos». Avisos en `Snackbar` (`aria-live` polite para confirmar, assertive para errores). |
| **P-3** `/mi-cuenta` | `rutas/mi-cuenta.tsx` y `cuenta/*` | Pestañas «Compras y presupuestos» y «Favoritos» (`?seccion=compras\|favoritos`); el detalle de un comprobante viaja en `?compra=<id>`. Una pestaña ya visitada queda cargada hasta salir de la página. |

**Compras y presupuestos** (`cuenta/HistorialMiCuenta.tsx`, `cuenta/DetalleCompra.tsx`): tabla de cinco columnas desde `md` y
tarjetas debajo; tandas de 20 con carga infinita («Cargar más» operable con teclado); contador total; **estado público** con
`Chip` (texto y color: Pendiente, Aceptado, Vencido, Anulado, Confirmada, Anulada, Nota de crédito); total **con IVA**. Nunca se
muestran cobro ni despacho (D-10). El detalle es un `Dialog` (a pantalla completa bajo `md`) con la lista blanca del contrato:
descripción, código, cantidad, precio unitario, subtotal y totales. Un comprobante ajeno o inexistente muestra lo mismo: «No
encontramos ese comprobante».

**Favoritos** (`cuenta/FavoritosMiCuenta.tsx`): miniatura con zoom (`MiniaturaProducto`), nombre (enlace a la ficha),
disponibilidad, precio según la cuenta (o «Precio a confirmar») y «Quitar» con «Deshacer». Un favorito cuyo producto dejó de
ser visible no se lista (el servidor lo omite; no se borra y vuelve si se republica). «Agregar a la lista» **todavía no se
dibuja**: lo suma la historia B1 (T039), que es la que crea la lista.

**Redirecciones y errores de acceso.** Sin sesión, o con una cuenta que no está activa y habilitada en esa tienda,
`/mi-cuenta` redirige a `/ingresar?volver=<ruta y pestaña>` **sin decir el motivo** (el servidor no lo distingue), y **solo** cuando ya se sabe que la función está encendida: con las capacidades pendientes muestra la carga, con la función apagada un anónimo ve la 404 (FR-014) y con un error al leerlas, el error con reintento. Si la cuenta se
suspende o se da de baja con la pantalla abierta, el **primer** error de acceso reemplaza todo el contenido por «Tu cuenta no está
activa en esta tienda» (con «Ir a Contacto» y «Salir») y no deja ningún dato anterior en pantalla (FR-011).

### Front: `?volver=` sin redirección abierta

`rutas/ingresar.tsx` acepta `?volver=` **solo** con rutas internas (`lib/tiendaVolver.ts`, `rutaVolverSegura`): empieza con `/`, no
con `//` ni `/\`, no contiene `:` (esquemas) ni `\`, ni caracteres de control o espacios, ni `//` en ningún lado, ni segmentos `.` o
`..` (un navegador normaliza `/..//x` a `//x`), ni `%5C`, `%2F` o `%2E`; y la propia `/ingresar` no es destino. Cualquier otro valor se
ignora y se vuelve a la portada, como antes.

### Front: capa de datos

`lib/tiendaCuentaDatos.ts` llama a las cinco RPC de la historia (`mis_compras_por_dominio`, `mi_compra_por_dominio`,
`mis_favoritos_por_dominio`, `cambiar_favorito_por_dominio`, `favoritos_entre_por_dominio`). Ninguna manda cliente, cuenta ni
empresa: eso lo decide el servidor con `private.cuenta_de_tienda(host)`. Acomoda cada respuesta con una **lista blanca** de
campos (lo que el contrato no nombra no llega a la pantalla) y traduce los errores a un `ErrorCuentaTienda` con código
`sin_acceso` (la UI lo trata como «cuenta no activa») o `error`, con mensajes en castellano y sin texto de Postgres. Los
listados usan `hooks/useListadoPorCursor.ts`: carga infinita por cursor `(fecha, id)` / `(creado, id)` (el cursor solo ordena),
igual que `useCatalogoPublico`; `useListadoAcumulado` acumula por número de página y no sirve con un cursor. El fin de lista lo dice
`CargaInfinita` con su prop `textoFin` (el foco va a ese texto al terminar). Los importes de comprobantes llevan centavos
(`formatearImporteArs`).

**Imágenes.** `lib/imagenProducto.ts` firma las miniaturas con un cliente **sin sesión** (`supabaseSinSesion`, rol `anon`): en `storage.objects` de `productos-imagenes` la política de `authenticated` exige ser miembro del panel y la de lectura pública es solo para `anon`, así que un cliente de la tienda con sesión no podría firmar. La vista previa del panel sigue firmando con la sesión de quien edita. Si una miniatura falla al cargar (la URL dura 1 h) se pide una URL nueva, una sola vez.

**Sesión compartida.** El encabezado, el menú y la ficha preguntan lo mismo en la misma página: `hooks/useSesionCliente.ts` hace UNA
consulta por host mientras haya algún uso montado (comparte la promesa y el resultado; un aviso de Auth la descarta). `useSesionCliente`
conserva su contrato; `useSesionClienteDetallada` suma `falla`, `reintentar` y `version` (cuenta ingresos y salidas, para que lo de una
persona no sobreviva al cambio: `useFavoritosEntre` lo toma como parte de su clave y se vacía al dejar de estar activo).

### Front: pruebas (Vitest, axe y E2E)

- **Vitest + axe** a 320, 768 y 1440 px (`test/ancho.ts` fija el ancho de `matchMedia`): `lib/tiendaCapacidades.test.ts`,
  `lib/tiendaCuentaDatos.test.ts`, `lib/tiendaVolver.test.ts`, `hooks/useListadoPorCursor.test.tsx`,
  `pages/tienda-publica/layout/AccesoCliente.test.tsx`, `rutas/ingresar.test.tsx`, `rutas/mi-cuenta.test.tsx`,
  `cuenta/BotonFavorito.test.tsx`, `cuenta/MiCuentaPantallas.test.tsx`, `hooks/useSesionCliente.test.tsx`, `hooks/useFavoritosEntre.test.tsx` y `hooks/useCapacidadesTienda.test.tsx`. Cubren cada estado (cargando, vacío, error, error al pedir más,
  fin de lista, sin acceso, función apagada), el aislamiento por tienda (cambiar de host descarta lo anterior) y que ninguna clave de
  costo, margen, descuento ni operador llega a la pantalla. `cuenta/favoritosSoloEnLaTienda.test.ts` vigila que el panel
  no mencione favoritos (ficha e historial del cliente) ni llame a sus RPC; el aislamiento del lado del servidor (los favoritos no tienen
  privilegios de API) lo prueba el pgTAP de la historia del SQL.
- **E2E** `apps/web/e2e/tienda-cuenta.e2e.ts` (job `e2e-tienda`; corrió de verdad con el SQL de #955 en la base del CI: los cuatro casos pasan): ingresar con `?volver=` → ver el historial → guardar y quitar un favorito → suspender la cuenta → «cuenta no activa»; la cuenta de una tienda no entra en la otra; 200 comprobantes por tandas de 20. En el stack del CI `service_role` no tiene privilegios sobre `public.clientes` ni `public.cuentas_cliente`, así que el spec da de alta los clientes y suspende la cuenta **como una persona del panel** (administrador de la organización del seed, con su sesión y RLS) y solo usa la service-role para vincular la cuenta web. Se omite si la base no tiene las RPC de la épica. La bandera `tienda_pedidos` es **global**: el spec la enciende en `beforeAll` y la restaura en `afterAll`; si el proceso muere entre medio, en una base local queda **encendida** (apagarla con `scripts/tienda-pedidos-dev.mjs apagar --entorno dev` o un `update` sobre `public.banderas_plataforma`).

## B1 · Lista de pedido sin cobro (MSF-176)

Un visitante (con o sin cuenta) arma una **lista de pedido** con productos y cantidades y la envía **sin pagar ni reservar nada**: le llega al
operador a la bandeja de Consultas como una consulta de origen **«Pedido»** con sus ítems. La venta se sigue cerrando fuera del sistema (D-1, D-6).
Todo está detrás de la bandera `tienda_pedidos` (apagada por defecto, encendida solo en dev).

### Modelo de datos (Principio VII)

| Objeto | Esquema | Qué es |
|---|---|---|
| `dominio.consulta_items` (**nueva**) | `dominio` | Las líneas de una consulta de pedido: `descripcion` y `sku` copiados del producto, `cantidad` (1 a 9.999) y `precio_referencia` calculado por el servidor. RLS por organización, empresa accesible y sección `consultas` ≥ lectura; `select` solo para `authenticated` (sin escritura ni `anon`); FK compuestas con la consulta (misma empresa y organización) y el producto (`on delete set null (producto_id)`: la línea conserva descripción y SKU). |
| `dominio.consultas` (alterada) | `dominio` | `origen` suma `pedido`; columna `cliente_id` (nullable, FK compuesta a `public.clientes`, `on delete set null (cliente_id)`) que fija **solo el servidor** con una cuenta activa; `consultas_mensaje_requerido` exime a `pedido` (la nota es opcional). |
| `dominio.tienda_envios` (alterada) | `dominio` | `origen` suma `pedido` y `presupuesto` (el cupo por visitante es el mismo del formulario y de WhatsApp). |
| `public.consulta_items_bandeja` (vista `security_invoker`) | `public` | Lectura de los ítems para el panel (hereda la RLS de `dominio.consulta_items`). |
| `public.consultas_bandeja` (alterada) | `public` | Suma al final `cliente_id`, `items_cantidad`, `cliente_numero` y `cliente_nombre` (estas dos con helpers `private` acotados a la organización, como el nombre del producto). |
| `publico.lista_pedido_por_dominio`, `publico.enviar_lista_pedido` | `publico` | Las dos RPC de **visitante** (`anon` + `authenticated`): se suman a propósito a la lista cerrada de `anon` de `tienda_capacidades.test.sql`. `publico` sigue sin tablas. |
| `private.validar_items_pedido`, `precio_referencia_pedido`, `crear_consulta_pedido`, `emitir_aviso_consulta`, `limite_listas_por_minuto` | `private` | Lógica interna sin `execute` de API. `crear_consulta_pedido` es el único insertor: nadie lo llama salvo `enviar_lista_pedido`, así el límite no se puede saltear (`crear_consulta_publica` sigue sin `execute` para `anon` ni `authenticated`). |

### Migraciones (aditivas, `IF [NOT] EXISTS`)

| Migración | Objetos | Reversión (migración posterior) |
|---|---|---|
| `20270321100000_consulta_items.sql` | tabla y vista de ítems, `origen`/`cliente_id` de `consultas`, `origen` de `tienda_envios`, `consultas_bandeja` ampliada | `drop view`/`drop table`/`drop column`; restaurar los `check` solo si no hay filas `pedido`/`presupuesto` |
| `20270321100100_validar_items_pedido.sql` | `private.validar_items_pedido`, `private.precio_referencia_pedido` | `drop function` |
| `20270321100200_lista_pedido_rpc.sql` | `publico.lista_pedido_por_dominio`, `private.limite_listas_por_minuto` | `drop function` |
| `20270321100300_consultas_aviso_pedido.sql` | `private.emitir_aviso_consulta`; el disparador `encolar_aviso_consulta` no emite para un pedido | volver al cuerpo de `20261210130300` |
| `20270321100400_enviar_lista_pedido.sql` | `publico.enviar_lista_pedido`, `private.crear_consulta_pedido` | `drop function` |
| `20270321100500_exportacion_total_consulta_items.sql` | `consulta_items` entra a la exportación total | volver a la definición de `20270222300200` |

(Las versiones de `tasks.md` eran `20270320110000…`: se renumeraron por encima del máximo de `origin/dokploy` al implementar.)

### Contratos

- **`publico.lista_pedido_por_dominio(host, items)`** (`anon` + `authenticated`; `volatile`, `security definer`, `search_path = ''`): revalida una lista de hasta 50 líneas
  `{producto_id, cantidad}`. Devuelve `{estado: ok, con_cuenta, tipo, lineas[], no_disponibles[], total_referencia}`; cada línea tiene exactamente `producto_id, nombre, sku,
  imagen, cantidad, disponible, precio_unitario, precio_anterior, escala, subtotal` (nunca costos, márgenes ni cantidades de stock). **Precio de referencia (D-28)** =
  el que la persona **ve en la tienda**: la ficha con la promoción vigente (`precio_anterior` es el precio normal tachado, o `null`) y, con cuenta activa, la **escala del
  tipo del cliente según la cantidad de esa línea** (si hay una promoción menor que la escala, gana «el más bajo, sin acumular» y la escala queda como `precio_anterior`),
  **sin** el descuento de la ficha del cliente (ése solo aparece en la cotización de B2). `no_disponibles`: inexistente, de otra tienda u organización, oculto o inactivo, todos
  **indistinguibles**. Host desconocido = empresa desactivada = tienda pausada = bandera apagada: `{estado: error}` idéntico y **antes** de validar los ítems. Errores: `invalido`
  (+ `campos = ["items"]`), `limite` (+ `espera_segundos`), `error`.
- **`publico.enviar_lista_pedido(host, nombre, contacto, nota, items, clave_envio)`** (`anon` + `authenticated`): orden de verificaciones: empresa por host → bandera → entradas
  (`invalido` con `campos` entre `nombre`, `contacto`, `nota`, `items`; nunca el valor) → reintento de una clave ya registrada (`ok` sin crear nada, aunque entre tanto un producto se haya
  ocultado) → cada producto debe ser visible en esa tienda (si alguno no lo es se rechaza **la lista entera** con `invalido` + `no_disponibles`) → una sola sub-transacción:
  `private.registrar_envio_tienda(empresa, 'pedido', clave)` (`limite` / `repetido` / `nuevo`) y `private.crear_consulta_pedido` (consulta + ítems, todo o nada, y el aviso).
  **Con cuenta activa** `nombre` y `contacto` recibidos se **ignoran**: se usan nombre y correo de la ficha (D-8, D-25) y la consulta guarda `cliente_id`; una ficha sin ningún
  contacto da `error` (no se inventa uno). Sin cuenta: `nombre` 1–100, `contacto` correo o teléfono de 8 a 15 dígitos (`private.validar_contacto_tienda`), `nota` ≤ 500. Se rechazan
  caracteres de control (en la nota se acepta el salto de línea), separadores de línea Unicode y marcas de dirección del texto; lo demás (`<script>`, `=HYPERLINK(…)`) se guarda **tal
  cual, como texto**. Ninguna clave ajena de `items` se lee: el precio sale del servidor.
- **Entrada de ítems** (`private.validar_items_pedido`): arreglo de 1 a 50 objetos, texto de a lo sumo 8.000 caracteres (se mira **antes** de recorrer), `producto_id` con forma de uuid
  (regex, sin cast que falle), `cantidad` entera o texto de 1 a 4 dígitos mayor que cero; repetidos sumados con tope 9.999. Devuelve `null` si es inválida y **nunca lanza** un error de Postgres.

### Límites y antispam

- **Envío**: 5 por hora por visitante y empresa (compartido con el formulario de contacto, WhatsApp **y los pedidos**: es UN solo cupo por (empresa, hash de IP); falla cerrada sin IP; el visitante es un **hash**, la IP nunca se guarda), idempotencia por
  `clave_envio` y poda a 24 h (todo ya existente: `private.registrar_envio_tienda`). Si la entrega falla se revierte también el registro del envío: **no se gasta cupo**. **No hay un tope global por empresa**: quien cambia de IP
  tiene un cupo nuevo; es un riesgo aceptado igual que en el formulario de contacto (amenaza 1.1) y lo acota la bandera apagada, el aviso agrupado y el costo mínimo de cada consulta.
- **Llamadas a `enviar_lista_pedido`** (S1, revisión de seguridad): además del cupo de envíos, cada llamada consume un **cupo de llamadas** propio (`private.registrar_pedido_publico('envio|' + visitante)`, 20 por minuto y visitante) **antes**
  de validar y de evaluar el catálogo efectivo; así también cuentan las llamadas `invalido` (uuids al azar, campos vacíos) y no se puede saturar la base con pedidos inválidos. Responde `limite` con `espera_segundos`.
- **Datos de la ficha** (S2): con cuenta activa, nombre y contacto de la ficha del cliente pasan por las mismas reglas que los de un visitante (sin caracteres de control, separadores ni marcas de dirección; se usa el primero de correo,
  teléfono y celular con formato válido; si no queda ninguno, `error` genérico). **Datos raros del catálogo** (S3): un precio de referencia fuera de rango (>= 10^12 o negativo) se guarda `null` («precio a confirmar») y un nombre en blanco usa
  «Producto sin nombre»: nunca abortan el envío.
- **Lectura** (amenaza 1.9, decisión de T033): `lista_pedido_por_dominio` aplica el limitador de pedidos públicos de la búsqueda (`private.registrar_pedido_publico`) con **su propio cupo**
  (`lista|` + visitante, 30 por minuto): quien lo supera recibe `{estado: limite}`. Por eso la función es `volatile` (escribe el contador). Además está acotada a 50 productos por llamada.
  `statement_timeout`: no se fija a nivel de función; rige el de los roles de API de la imagen de Supabase (`anon` 3 s, `authenticated` 8 s, `authenticator` 8 s), que el pgTAP `tienda_lista_pedido` comprueba (S5; no lo pone una migración del repo:
  si el Postgres self-hosted no usara esa imagen habría que fijarlo con `alter role … set statement_timeout`). Medición (pgTAP, 50 líneas, Postgres 17 local sin carga): ver el log del
  pgTAP `tienda_lista_pedido` (`rendimiento: lista_pedido_por_dominio con 50 líneas tardó … ms`).
- **Topes**: 50 líneas, 9.999 unidades por producto, nota ≤ 500 (D-9, D-23; constantes en la validación). El tamaño de la lista se mide con `pg_column_size` (8.000 bytes), sin materializar el texto.

### Aviso por correo a Consultas

El disparador de Consultas no ve los ítems (se insertan **después** de la consulta): para un pedido `private.crear_consulta_pedido` llama a `private.emitir_aviso_consulta` cuando ya los insertó.
El aviso lleva `Origen: Pedido de la tienda`, `Nombre`, `Contacto`, `Pedido` (resumen de hasta 10 líneas `cantidad × descripción (SKU)` y «y N más»), `Cliente` (Nº y nombre, con cuenta) y
`Mensaje` (la nota). **El asunto sale del nombre del tipo de aviso («Consulta nueva») y no lleva datos del visitante**; el cuerpo del correo escapa todo valor como texto (flow `enviar-avisos`). Un fallo al
emitir se registra solo con `sqlstate` y no frena el alta.

### Lo que ve el operador (panel · Consultas)

- **Bandeja**: el origen «Pedido» y, en la columna Producto, **«Pedido de n productos»** («1 producto»).
- **Detalle** (diálogo `md`, pantalla completa en celular): bloque **«Pedido»** con una tabla Producto · SKU · Cantidad · Precio de referencia · Subtotal de referencia (en celular, una tarjeta por línea), «Total de
  referencia» y la nota «Precios de referencia calculados al enviar, tal como los vio la persona en la tienda. Confirmalos al responder.»; «Mensaje» pasa a **«Nota de la persona»** («Sin nota» si no hay);
  con cuenta activa, la fila **«Cliente»** (Nº y nombre). Todo se muestra **como texto** (nunca HTML). Estados: cargando, error con «Reintentar» y sin ítems.
- **«Responder por correo/WhatsApp»**: el texto inicial lista los ítems (`• 2 × Joystick Pro (JOY-1)`) y los enlaces `mailto:`/`wa.me` van **codificados** (`lib/textoInicialConsulta.ts`).
- **Empresa activa**: igual que la bandeja; si se cambia con un pedido abierto, el diálogo se cierra y la lista se recarga (cubierto por Vitest).

### Front de B1 (`apps/web`)

- `lib/listaPedido.ts` + `hooks/useListaPedido.ts`: la lista vive **en el navegador, por tienda** (`localStorage` con `try/catch` y respaldo en memoria; solo `producto_id` y `cantidad`, **nunca precios**; tope 50
  líneas y 9.999 unidades; sincronía entre pestañas por el evento `storage` y al volver el foco). Con el almacenamiento bloqueado, o si solo falla la escritura (cuota llena: `setItem` lanza pero `getItem` anda), la lista dura mientras la página esté abierta y `/lista` lo avisa; mientras la última escritura de un host falló, la memoria es la verdad (releer no borra lo agregado).
- `lib/tiendaPedido.ts`: llamadas a las dos RPC, validación espejo del servidor y traducción de estados (nunca detalles técnicos).
- Ficha: **«Agregar a la lista»** (`lista/BotonAgregarALista.tsx`; cada clic suma 1; avisos de tope; el producto sin stock también se agrega) y la línea «Ya tenés n en tu lista · Ver lista» (n = unidades de **este** producto).
  Encabezado: **«Mi lista (n)»** (`lista/IndicadorLista.tsx`; n = productos distintos). Menú móvil: «Mi lista» con cuenta activa. «Mi cuenta › Favoritos»: «Agregar a la lista».
- Detalle de un pedido en el panel: «Responder por correo/WhatsApp» queda **deshabilitado mientras los ítems cargan o fallan** (el texto inicial los lista); «Cliente» es un enlace a `/clientes/show/:id` solo si la persona tiene acceso a Clientes (texto plano si no).
- Ruta **`/lista`** (`rutas/lista.tsx`, `lista/PantallaLista.tsx`, `LineaLista.tsx`, `FormularioPedido.tsx`, `ConfirmacionPedido.tsx`): revalida al abrirla, al cambiar la lista (con una espera de 500 ms) y **antes de enviar**; los
  productos no disponibles van a una sección aparte y se sacan al enviar; una sola petición en vuelo; `clave_envio` por contenido (se reutiliza en los reintentos); ante cualquier error **la lista se conserva**; `limite` avisa en minutos y
  habilita el botón al cumplirse la espera (si el que da `limite` es la revisión previa al envío, el aviso es «No pudimos revisar tu lista.»); cada campo se valida también **al salir** de él, con `maxLength` igual al del servidor (nombre 100, contacto 120); la confirmación dice «Recibimos tu pedido… No se cobró nada.» y vacía la lista. Con la bandeja apagada es la 404 de la tienda.
- `LISTA_DE_PEDIDO_DISPONIBLE = true` en `lib/tiendaCapacidades.ts`: aparecen «Mi lista» (menú móvil) y «Agregar a la lista» (Favoritos); cada control se dibuja solo con la función encendida.

### Retención de los datos (D-20)

**No hay purga automática** de consultas ni de ítems de pedido en esta épica: no se inventa un plazo legal, y **la supresión por titular** (que un visitante pida borrar sus datos) tampoco existe como función: queda como seguimiento (T072). Se guarda lo mínimo (nombre, contacto, nota e ítems; sin dirección, DNI ni CUIT; la IP nunca), lo ve solo
quien tiene la sección `consultas` ≥ lectura en esa empresa y no se borra solo. Cómo borrar a mano y el seguimiento trazado: [`consultas.md`](./consultas.md#pedidos-de-la-tienda-b1-msf-176).

### Pruebas de B1

| Archivo | Cubre |
|---|---|
| `supabase/tests/database/tienda_lista_pedido.test.sql` | batería de entradas hostiles de `validar_items_pedido` (todas `null`, ninguna error de Postgres); `lista_pedido_por_dominio` (paridad de precio y `precio_anterior` con `producto_por_dominio`, escala con `precios_cliente_por_dominio`, promoción que gana, no disponibles indistinguibles, claves exactas, host desconocido = pausada = bandera apagada, cupo de lecturas, 50 líneas con medición); `enviar_lista_pedido` (consulta + ítems en una transacción, `precio_referencia` del servidor, idempotencia, sexto envío = `limite`, validación de campos y caracteres de control, `<script>`/fórmulas literales, cuenta activa sin pedir datos y con `cliente_id`, rechazo total ante productos no visibles, falla de entrega sin gastar cupo, ningún texto de Postgres, aislamiento entre dos organizaciones, bandera apagada sin efecto); privilegios de `anon`; RLS de las líneas; aviso con resumen de ítems |
| `supabase/tests/database/tienda_capacidades.test.sql` | la lista cerrada de `anon` suma **a propósito** `lista_pedido_por_dominio` y `enviar_lista_pedido` |
| `supabase/tests/database/consultas.test.sql` | origen `pedido`, líneas con la misma RLS que la consulta, `items_cantidad` |
| Vitest + axe a 320/768/1440 | `lib/listaPedido.test.ts`, `lib/tiendaPedido.test.ts`, `rutas/lista.test.tsx` (cada estado y cada error de campo), `lista/BotonAgregarALista.test.tsx` (ficha, encabezado, topes, función apagada), `lista/ConfirmacionPedido.test.tsx`, `cuenta/MiCuentaPantallas.test.tsx`, `components/consultas/DetallePedido.test.tsx` (ítems, XSS literal, enlaces codificados, cambio de empresa en `pages/consultas/list.test.tsx`), `lib/textoInicialConsulta.test.ts`, `hooks/useItemsConsulta.test.tsx` |
| E2E | `apps/web/e2e/tienda-lista-pedido.e2e.ts` (job `e2e-tienda`): 3 productos desde las fichas → «Mi lista» → enviar → el operador ve «Pedido de 3 productos» con los 3 ítems; sexto envío = aviso de límite; almacenamiento bloqueado; bandera apagada. Tienda, productos y personas propios de la corrida |

### Desvíos de la spec (B1)

- Migraciones renumeradas a `20270321…` (por encima de `20270320100500`).
- `lista_pedido_por_dominio` es `volatile` y puede responder `limite` (la spec la daba `stable`, sin cupo): se aplicó el limitador de la búsqueda (amenaza 1.9, T033).
- `consultas_bandeja` suma además `cliente_numero` y `cliente_nombre` (la spec pedía `cliente_id` e `items_cantidad`): el detalle muestra «Nº n · nombre» sin exigir acceso a Clientes.
- El aviso para un pedido lo emite `crear_consulta_pedido` (no el disparador) porque los ítems se insertan después de la consulta.
- `enviar_lista_pedido` suma un cupo de **llamadas** (20 por minuto y visitante) antes del catálogo y puede responder `limite` también por eso (revisión de seguridad S1).
- Un reintento de una clave ya registrada responde `ok` **antes** de revalidar la visibilidad de los productos (la repetición no depende de que sigan visibles).
- El asunto del correo no cambia (sigue siendo el del tipo de aviso): ya no lleva datos del visitante.

## B2 · Presupuesto desde la tienda (MSF-176)

**Estado**: implementada (T050 a T061, T064 y T065). Las revisiones independientes de seguridad (T062) y de QA y código (T066) las coordina quien integra el PR. La función sigue detrás de la bandera `tienda_pedidos` (apagada por defecto; solo dev, D-24).

Un cliente con **cuenta activa** pide, desde su lista de pedido, un **presupuesto real**: un comprobante `presupuesto` en estado `pendiente`, canal `tienda_online`, sin operador y sin validez (D-13, D-21), con numeración correlativa de la tienda, calculado por el servidor y **sin mover stock ni cobrar**. La venta se sigue cerrando fuera del sistema; el operador lo acepta, modifica, copia o anula con los flujos de siempre.

### Etapa 1 · precio sin sesión de panel (T050 y T051)

#### Qué cambia (migración `20270322100000_precio_sin_sesion.sql`, D-17)

`private.precio_para` y `private.precio_linea_venta` (MSF-816) exigían una sesión de panel y dos piezas internas fallaban **en silencio** sin ella (IVA 0 por `alicuota_producto` y precio propio ignorado por `precio_propio_empresa`). La migración **extrae el cálculo** a tres funciones nuevas de `private`, **sin `execute` para `public`, `anon`, `authenticated` ni `service_role`**:

| Función | Qué es |
|---|---|
| `private.precio_para_calculo(producto, empresa, escala)` | La lógica de `precio_para` sin compuerta de sesión. `security definer`, `search_path = ''`. Acotada por la organización **de la empresa** (no por `organizacion_id()`); alícuota por join y precio propio con `neto_precio_propio`. |
| `private.precio_linea_venta_calculo(...)` | La lógica de `precio_linea_venta` («gana el más bajo, sin acumular») sobre aquélla. Misma firma y columnas. **La llamará la tienda** con el tipo y el descuento del cliente de la cuenta. |
| `private.precio_sesion_alcanza(producto, empresa)` | La compuerta y el aislamiento de la sesión de panel, en un solo lugar: `empresas` o `ventas` en lectura/edición y producto y empresa de la organización de la sesión. |

`precio_para` y `precio_linea_venta` quedan como **envoltorios** (misma firma, columnas y grants): validan la escala, preguntan a `precio_sesion_alcanza` y delegan. El resultado para el panel es el mismo (lo prueban los pgTAP vigentes y `precio_sin_sesion.test.sql`, que compara contra una copia literal de las funciones originales en más de 4.700 combinaciones).

#### Dos diferencias, dichas con todas las letras

- `precio_para` pasa de `security invoker` a **`security definer`** (necesita llamar al cálculo, que `authenticated` no ejecuta). El aislamiento que antes daba la RLS de las tablas lo da ahora `precio_sesion_alcanza`. **Pierde el requisito de sección de esa RLS** (`productos` y `empresas` en lectura/edición): la compuerta que queda es la documentada por F-VTA-06, `empresas` o `ventas`. Sin ruta real: `private` no está expuesto y los llamadores son `security definer` sin RLS. El pgTAP lo nombra («diferencia deliberada 1»). Seguimiento: retirar `execute` de `authenticated` en `precio_para` permitiría volver a `security invoker`, pero obliga a reescribir pgTAP vigentes que lo llaman como `authenticated`.
- Producto o empresa de **otra organización** respecto de la sesión: antes, llamado sin RLS, devolvía el neto sin alícuota ni precio propio (el mismo fallo silencioso); ahora devuelve vacío. Ningún llamador real lo usa; el pgTAP lo fija.

#### Pruebas

`supabase/tests/database/precio_sin_sesion.test.sql` (127 aserciones): paridad con la copia literal de las originales (escalas, tipos, cantidades, descuentos, reglas de tienda, monedas, precio propio, alícuotas 21 %/10,5 %/exenta/ninguna, promociones que ganan/empatan/pierden/vencidas/futuras/anuladas, bandera apagada y sin precio); el cliente web da el mismo resultado con IVA y precio propio correctos (falla si se revierte la extracción); compuerta y aislamiento de los envoltorios con roles reales; superficie (ni `anon` ni `authenticated` ni `service_role` ejecutan lo nuevo; la lista de funciones ejecutables por `authenticated` no crece).

### Contratos (`publico`, solo `authenticated`; `anon` no tiene `execute`)

- `cotizar_presupuesto_tienda(host, items) → jsonb`: `{estado: ok, lineas[], total_sin_iva, iva, total_con_iva, no_disponibles[], sin_precio[]}` | `invalido` | `limite` (+ `espera_segundos`) | `sin_acceso` | `error`. Por línea solo `producto_id`, `descripcion`, `codigo`, `cantidad`, `precio_unitario`, `subtotal_sin_iva`, `iva`, `disponible`: **sin** `promocion_id`, `alicuota_id`, `precio_referencia`, escala ni descuento. Es `volatile` (escribe el contador del cupo de llamadas).
- `crear_presupuesto_tienda(host, items, nota, clave_envio) → jsonb`: `{estado: ok, numero, fecha, total_con_iva}` | `invalido` (+ `campos`: `nota`, `clave_envio`, `items`) | `sin_precio` / `no_disponible` (+ `producto_id`) | `limite` (+ `espera_segundos`) | `limite_cuenta` | `sin_acceso` | `error`. **No recibe** cliente, cuenta, empresa, organización, precios, escala, descuento, depósito, estado, canal ni fecha: la identidad sale solo de `private.cuenta_de_tienda(host)` (auth.uid() → cuenta activa y habilitada en la tienda del host → cliente → organización) y cada clave ajena del `jsonb` se ignora.
- Orden de verificaciones, todas antes de escribir: bandera → cuenta (`sin_acceso`, idéntico para anónimo, panel, suspendida, no habilitada, otra tienda, host desconocido o pausado) → **cupo de llamadas por cuenta** (`presupuesto|<cuenta>` 10 por minuto; `cotizacion|<cuenta>` 20 por minuto), **antes de cualquier cálculo costoso** y contando también las inválidas → validar `clave_envio`, `nota` (<= 500, sin caracteres de control) e `items` (1 a 50 líneas, cantidad 1 a 9.999) → idempotencia → lock por cuenta (`pg_advisory_xact_lock`) y segunda lectura de la idempotencia → **topes por cuenta** (5 creados por día de Buenos Aires y 10 `pendiente` abiertos desde la tienda: `limite_cuenta`) → motor (`no_disponible`, `sin_precio`) → una sub-transacción: **cupo por hora de la tienda** (5 por IP, compartido con el formulario y la lista: `limite`), número, comprobante, líneas, vínculo y actividad. Todo o nada: ante cualquier error no queda número consumido, líneas sueltas ni cupo gastado.
- Desvíos del contrato (T055): los topes por cuenta y el motor van **antes** del cupo por hora de la tienda (un rechazo no gasta el cupo del visitante); la cotización es `volatile` y responde `limite`; no devuelve la escala por línea (la lista ya la muestra); la **nota** del cliente se guarda en `dominio.presupuestos_tienda.nota` (los comprobantes no tienen dónde guardarla) y la ficha del comprobante se la muestra al operador como texto.

### El motor (`private.motor_presupuesto_tienda`)

Es el **único** lugar que arma las líneas: la cotización y la creación lo usan («lo que ves es lo que se crea», pgTAP con el mismo total y los mismos precios). Recibe solo la cuenta y los ítems ya normalizados y saca de la cuenta el cliente, la organización, la tienda, el **tipo** y el **descuento de la ficha** (siempre con la organización de la empresa). Solo acepta productos **efectivamente visibles** en la tienda (`private.catalogo_tienda_efectivo`): inexistente, ajeno, oculto o inactivo son **indistinguibles** (`no_disponible`). El precio es siempre `private.precio_linea_venta_calculo` (D-17) con el **instante del servidor**, el descuento siempre aplicado y sin precio manual: escala por el tipo y la cantidad de **esa** línea, precio propio, promoción vigente si es menor y IVA. Sin precio en pesos (por ejemplo, dólar sin cotización) o con precio <= 0: `sin_precio`, **nunca** una línea en cero. El depósito es el por defecto, activo, que vende la tienda; sin ninguno responde `error`.

### Lo que se escribe y lo que no

`dominio.presupuestos_tienda` (nueva, `dominio`; RLS por organización, empresa accesible y `ventas`; `select` solo para `authenticated`; sin escritura por la API; únicas `(cuenta, clave_envio)` y `(comprobante)`), el comprobante con **todas** las columnas que arma el panel (paridad de columnas en el pgTAP), las líneas y el evento `presupuesto.creado_desde_tienda` (actor nulo; el texto lleva número, **tienda**, cliente Nº y nombre, sin correo ni teléfono: «Presupuesto 00000012 pedido desde la tienda Tienda A por el cliente Nº 910 · Ana»; desvío de la spec, que no nombraba la tienda y es útil con varias tiendas). **No** llama a funciones de stock, reservas, cobros ni contrarreembolsos: el pgTAP cuenta las filas antes y después. `private.siguiente_numero_comprobante_org` numera con la organización explícita (el mismo `insert … on conflict` atómico que el panel).

### Lo que ve el operador

- **Ventas › Presupuestos** (y el CSV de comprobantes y presupuestos): «Pendiente», la columna Operador dice «Tienda online (cliente)» (antes «Usuario sin nombre»). El origen se deriva del **vínculo real** (`dominio.presupuestos_tienda`), no del canal ni de un operador nulo: cambiar el canal no pierde la etiqueta y un presupuesto de panel con canal `tienda_online` y operador borrado **no** se rotula como de la tienda (`listar_presupuestos`, `private.comprobantes_consulta` y `obtener_comprobante`, migraciones `…100500` y `…100600`).
- **Ficha del comprobante**: chip «Creado desde la tienda por el cliente», Operador «Tienda online (cliente)» y la «Nota del cliente» (texto literal). Se modifica, acepta y copia con los flujos de siempre. **Un presupuesto no se anula** (el flujo vigente solo anula facturas confirmadas): queda `pendiente` hasta que el operador lo acepta o lo convierte; el pgTAP lo fija igual para uno de la tienda que para uno de panel.
- **Actividad**: el evento se rotula «Tienda online» en «Quién» (lista, detalle y exportación); los demás eventos sin actor siguen diciendo «Sistema».
- Aviso al equipo por presupuesto nuevo, «Crear presupuesto desde la consulta», filtro por canal y validez por defecto: **fuera** (D-12, D-14, D-21, D-22), con seguimientos trazados en el tracker: **MSF-940** (aviso al equipo por presupuesto nuevo), **MSF-941** (crear presupuesto desde una consulta de pedido), **MSF-942** (filtro por canal en Presupuestos), **MSF-943** (validez por defecto) y **MSF-944** (retención y supresión de consultas, ítems de pedido y presupuestos de la tienda).

### Front (`apps/web`)

`lib/tiendaPedido.ts` (`cotizarPresupuesto`, `crearPresupuesto` y sus traductores de estado; solo `producto_id` y `cantidad`, nunca precios), `pages/tienda-publica/lista/DialogoPresupuesto.tsx` («Tu presupuesto»: cotización del servidor, productos que no se pueden pedir listados por nombre, una sola petición en vuelo, «Reintentar» con la **misma** clave), «Pedir presupuesto» en `FormularioPedido` (solo con cuenta activa; «Enviar pedido» pasa a secundario) y la confirmación en `ConfirmacionPedido` (con «Ver en Mi cuenta» y el aviso si el total cambió). Panel: `lib/actividad.ts` (`quienDelEvento`), `pages/ventas/comprobante.tsx` y `presupuestos.tsx`.

### Revisión independiente: correcciones (M-1 a M-4) y decisiones (I-1 a I-5)

- **M-3 (cupo que sobrevive a un error)**: cotizar y crear toman el cupo de llamadas **antes** de un bloque propio con su manejador de excepciones; un error revierte solo ese bloque y el contador no se deshace (pgTAP: con el motor roto, las llamadas gastan cupo y la undécima del minuto es `limite`).
- **M-4 (nota)**: se recorta con espacios, tabuladores y saltos de línea (una nota solo de saltos de línea es «sin nota» y el `CHECK` de la tabla es coherente) y se rechazan además U+061C y los ceros de ancho (U+200B a U+200D, U+2060, U+FEFF), con el **mismo conjunto** en `crear_presupuesto_tienda`, `enviar_lista_pedido` (migración `…100700`) y el front (`tiendaPedido.ts`).
- **I-1 (cupo por IP compartido)**: el cupo de **5 por hora por IP y tienda** lo comparten el formulario de contacto, WhatsApp, la lista de pedido y el presupuesto (todos pasan por `registrar_envio_tienda`). Se evaluó un cupo propio por origen `presupuesto`: no es barato sin aflojar la protección conjunta (obligaría a cambiar `registrar_envio_tienda`, ya en `dokploy`, y a permitir hasta 5 envíos por cada origen desde la misma IP), así que **se deja compartido y documentado**. Quien sí tiene tope propio es la **cuenta**: 5 por día y 10 abiertos, más el cupo de llamadas por minuto.
- **I-2 (costo del catálogo efectivo)**: medido con un catálogo de **5.000 productos** en una tienda (stack local de Postgres 17): `private.catalogo_tienda_efectivo` tarda **7 a 12 ms**; el motor completo (catálogo efectivo + precio de cada línea) tarda **14 ms con 1 línea y 43 a 48 ms con 50 líneas**. El cupo de llamadas por cuenta (10 y 20 por minuto) acota el costo máximo por cuenta a unos 2 s de CPU por minuto en el peor caso.
- **I-3 (idempotencia)**: repetir una `clave_envio` devuelve el presupuesto **ya creado** con su total **actual** (si el operador lo modificó entre tanto, el total que ve el cliente en el reintento es el vigente, no el original) y no crea otro.
- **I-4 (sin vencimiento automático)**: el presupuesto nace sin validez (D-13, D-21), nunca vence solo y el operador no puede anularlo: **10 abiertos bloquean a la cuenta hasta que el operador acepte o convierta alguno** (el cliente ve «Ya tenés presupuestos abiertos…»). Es una decisión de negocio; la validez por defecto es MSF-943.
- **I-5 (retención y supresión)**: las consultas, los ítems de pedido, los presupuestos de la tienda y sus notas **no se purgan solos** y no hay supresión por titular automática: **MSF-944**. Mientras tanto se borra a mano (ver `docs/consultas.md`).

### Cómo apagarlo

Con la bandera `tienda_pedidos` apagada las dos RPC responden `sin_acceso` sin tocar datos y la tienda no dibuja «Pedir presupuesto». Los presupuestos ya creados son comprobantes de Ventas: **no se borran** (y un presupuesto no se anula: el operador los acepta, los convierte o los deja pendientes).

### Pruebas de B2

- pgTAP `tienda_presupuesto_cliente.test.sql` (182 aserciones, adversarial: dos organizaciones, tres tiendas, cuentas de todos los estados): IDOR, `sin_acceso` idéntico, claves ajenas ignoradas, **paridad con el panel en todas las columnas**, `sin_precio`, cero efectos de stock y cobros, topes (5 por día, 10 abiertos, 50 líneas, cantidad 10.000, 20 entradas hostiles), cupo de llamadas, idempotencia, error a mitad sin saltos de numeración, actividad sin correo y superficie de `anon` (la lista cerrada no cambia: `tienda_capacidades.test.sql`).
- Vitest con axe a 320, 768 y 1440 px: `DialogoPresupuesto`, `ConfirmacionPedido`, los traductores y los rótulos del panel.
- E2E `tienda-presupuesto.e2e.ts` (job `e2e-tienda`): el mayorista pide, el operador lo acepta; el sexto del día; **dos llamadas simultáneas con 4 creados crean una** (el lock con sesiones de verdad); misma clave = mismo número; sin cuenta, otra tienda, anónimo y bandera apagada.

## Seguridad: qué no hace A

- No recibe identidades del llamador (cliente, cuenta, empresa, organización): el cursor y los ids solo ordenan o buscan dentro de lo propio.
- No expone cantidades de stock, costos, márgenes, descuentos, depósitos, operadores ni estados de cobro y despacho.
- No toca precios ni stock ni comprobantes: solo lee comprobantes y escribe `dominio.favoritos_cliente`.
- La tabla de favoritos no se alcanza por la API aunque se conozca su nombre.

## Pendiente de las otras historias

B2 (presupuesto desde la tienda) tiene su sección arriba. «Mi lista» (menú móvil) y «Agregar a la lista» (Favoritos) ya se dibujan: B1 puso `LISTA_DE_PEDIDO_DISPONIBLE` en `true` junto con la ruta `/lista`.
