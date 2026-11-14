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
documenta la base de datos de **A** y los cimientos compartidos.

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
  (p. ej. `supabase-dev.212-90-120-53.sslip.io`) y ninguna de stg/staging/prd/prod/production ni ser de la nube de Supabase; un túnel
  a la base de dev se declara a propósito en `TIENDA_PEDIDOS_DEV_DB_HOSTS` (hosts separados por coma). La contraseña viaja por
  `PGPASSWORD`, no por argv, y requiere `psql`;
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
| `publico.mi_compra_por_dominio(host, comprobante_id)` | un id | `{estado:"ok", numero, fecha, tipo, estado_publico, valido_hasta, total_sin_iva, iva, total_con_iva, lineas:[{descripcion, codigo, cantidad, precio_unitario, subtotal}]}` · `no_encontrada` · `sin_acceso` · `error` |
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
`pg_advisory_xact_lock` por cuenta: el 201 responde `limite_favoritos` sin guardar (guardar uno que ya existe sigue siendo `ok` en el tope). Guardar exige que
el producto sea **efectivamente visible** en la tienda (`private.catalogo_tienda_efectivo`): inexistente, inactivo, oculto, de otra tienda o de otra
organización responden todos `no_encontrado`. «Favoritos» solo lista y cuenta los productos **visibles hoy**: un favorito cuyo producto se ocultó no se lista
ni se cuenta, pero **no se borra** y reaparece al volver a publicarse. Muestra solo `disponible` (sin cantidades de stock) y `precio_final` con la escala x1
(la de la ficha a cantidad 1, `private.precio_final_publico_escala`).

**Desvíos menores del contrato** (se anotan en el PR):

- **Quitar** un favorito (`favorito = false`) no exige que el producto siga visible: siempre responde `ok`. Así una persona con favoritos ocultos puede liberar
  lugar en el tope; solo toca filas de su propia cuenta.
- `siguiente` de `mis_favoritos_por_dominio` es `{creado, id}` (el `id` es el de la fila de favorito) y se devuelve tal cual en `desde_creado` y `desde_id`.
- Con host desconocido, empresa desactivada o tienda pausada las RPC de cuenta responden `sin_acceso` (igual que cualquier falta de cuenta), no `error`.

### Pruebas (pgTAP)

| Archivo | Cubre |
|---|---|
| `supabase/tests/database/tienda_capacidades.test.sql` | bandera apagada por defecto, `pedidos` true/false, host desconocido = empresa desactivada, claves exactas, `anon` sin acceso a la tabla de banderas |
| `supabase/tests/database/tienda_cuenta_de_tienda.test.sql` | dos organizaciones y dos tiendas: suspendida, no habilitada, otra tienda, panel, anónimo, archivado, consumidor final, host desconocido, empresa desactivada y otra organización → vacío; suspensión y baja rigen en la próxima llamada |
| `supabase/tests/database/tienda_favoritos.test.sql` | alternar idempotente, tope 200, producto oculto/inactivo/ajeno/inexistente idénticos, aislamiento entre cuentas y entre tiendas del mismo cliente, oculto no se lista y reaparece, cursor forjado, `favoritos_entre` ≤ 50, bandera apagada, tabla sin privilegios de API, FK compuestas, `anon` sin `execute`, `search_path` vacío |
| `supabase/tests/database/tienda_historial.test.sql` | solo lo del cliente y la tienda, sin borradores, notas de crédito negativas, estado público, vencido por Buenos Aires, IDOR idéntico a inexistente, lista blanca exacta por claves, cursor y límite, suspensión inmediata, bandera apagada |

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
- **E2E** `apps/web/e2e/tienda-cuenta.e2e.ts` (job `e2e-tienda`; se omite si la base no tiene todavía las RPC de la épica, y **mientras el SQL de la épica no esté en la rama esas omisiones hacen fallar `e2e:omitidos:check --max=1`**: el spec no corre de verdad hasta que aterrice el SQL, y esa primera corrida real hay que mirarla): ingresar
  con `?volver=` → ver el historial → guardar y quitar un favorito → suspender la cuenta → «cuenta no activa»; la cuenta de una tienda
  no entra en la otra; 200 comprobantes por tandas de 20.

## Seguridad: qué no hace A

- No recibe identidades del llamador (cliente, cuenta, empresa, organización): el cursor y los ids solo ordenan o buscan dentro de lo propio.
- No expone cantidades de stock, costos, márgenes, descuentos, depósitos, operadores ni estados de cobro y despacho.
- No toca precios ni stock ni comprobantes: solo lee comprobantes y escribe `dominio.favoritos_cliente`.
- La tabla de favoritos no se alcanza por la API aunque se conozca su nombre.

## Pendiente de las otras historias

B1 (lista de pedido) y B2 (presupuesto desde la tienda) tienen su sección cuando se implementen. «Mi lista» del menú móvil enlaza a `/lista`, que construye B1,
y «Agregar a la lista» de «Favoritos» se dibuja cuando exista esa lista (T039).
