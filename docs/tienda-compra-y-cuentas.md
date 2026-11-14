# Tienda · «Mi cuenta», lista de pedido y presupuesto (MSF-176)

Spec: `specs/20270306-100000-tienda-compra-y-cuentas/` (`spec.md`, `plan.md`, `tasks.md` y `contracts/tienda-compra-y-cuentas.md`).
La épica tiene tres historias detrás de la bandera `tienda_pedidos`: **A** «Mi cuenta» (F-CLI-20 · MSF-452), **B1** lista de
pedido sin cobro y **B2** presupuesto desde la tienda. Esta guía crece historia por historia; hoy documenta **A, el front**.
La venta se sigue cerrando fuera del sistema (pago, envío y factura): nada de esta épica cobra ni mueve stock.

## A · «Mi cuenta» (F-CLI-20) · front

**Qué es.** Un cliente con **cuenta web activa** entra a `/mi-cuenta` y ve las compras y presupuestos que tiene **en esa tienda**
y los productos que guardó como favoritos. Favoritos e historial son **por tienda** (D-2): la misma persona con cuentas en dos
tiendas ve en cada dominio solo lo suyo de ese dominio. El operador del panel **no** ve los favoritos (D-11).

### Bandera y capacidades

- Con `tienda_pedidos` **apagada** (el valor por defecto en todo entorno, D-19) la tienda no muestra «Mi cuenta», «Mi lista»
  ni «Guardar en favoritos», y `/mi-cuenta` responde la página «no encontrada». El servidor lo impone en cada RPC; el front solo lo
  refleja.
- El front público no puede leer la bandera (`public.banderas_plataforma` no es legible por `anon`): la conoce por
  `publico.capacidades_tienda_por_dominio(host)` (D-27), que devuelve solo `{estado, pedidos}`.
  `lib/tiendaCapacidades.ts` hace **una llamada por host** (la comparten encabezado, menú, ficha y rutas) y
  `hooks/useCapacidadesTienda.ts` la expone como `cargando | error | lista`. Mientras no responde, o si falla, **no se dibuja nada
  de la épica** (ni deja un hueco reservado).
- Cómo encenderla (solo en dev, D-24): `scripts/tienda-pedidos-dev.mjs encender|apagar|estado` (lo entrega la historia del SQL).

### Pantallas (spec «Pantallas y textos»)

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
`/mi-cuenta` redirige a `/ingresar?volver=<ruta y pestaña>` **sin decir el motivo** (el servidor no lo distingue). Si la cuenta se
suspende o se da de baja con la pantalla abierta, el **primer** error de acceso reemplaza todo el contenido por «Tu cuenta no está
activa en esta tienda» (con «Ir a Contacto» y «Salir») y no deja ningún dato anterior en pantalla (FR-011).

### `?volver=` sin redirección abierta

`rutas/ingresar.tsx` acepta `?volver=` **solo** con rutas internas (`lib/tiendaVolver.ts`, `rutaVolverSegura`): empieza con `/`, no
con `//` ni `/\`, no contiene `:` (esquemas) ni `\`, ni caracteres de control o espacios; y la propia `/ingresar` no es destino.
Cualquier otro valor se ignora y se vuelve a la portada, como antes.

### Capa de datos

`lib/tiendaCuentaDatos.ts` llama a las cinco RPC de la historia (`mis_compras_por_dominio`, `mi_compra_por_dominio`,
`mis_favoritos_por_dominio`, `cambiar_favorito_por_dominio`, `favoritos_entre_por_dominio`). Ninguna manda cliente, cuenta ni
empresa: eso lo decide el servidor con `private.cuenta_de_tienda(host)`. Acomoda cada respuesta con una **lista blanca** de
campos (lo que el contrato no nombra no llega a la pantalla) y traduce los errores a un `ErrorCuentaTienda` con código
`sin_acceso` (la UI lo trata como «cuenta no activa») o `error`, con mensajes en castellano y sin texto de Postgres. Los
listados usan `hooks/useListadoPorCursor.ts`: carga infinita por cursor `(fecha, id)` / `(creado, id)` (el cursor solo ordena),
igual que `useCatalogoPublico`; `useListadoAcumulado` acumula por número de página y no sirve con un cursor.

### Pruebas

- **Vitest + axe** a 320, 768 y 1440 px (`test/ancho.ts` fija el ancho de `matchMedia`): `lib/tiendaCapacidades.test.ts`,
  `lib/tiendaCuentaDatos.test.ts`, `lib/tiendaVolver.test.ts`, `hooks/useListadoPorCursor.test.tsx`,
  `pages/tienda-publica/layout/AccesoCliente.test.tsx`, `rutas/ingresar.test.tsx`, `rutas/mi-cuenta.test.tsx`,
  `cuenta/BotonFavorito.test.tsx` y `cuenta/MiCuentaPantallas.test.tsx`. Cubren cada estado (cargando, vacío, error, error al pedir más,
  fin de lista, sin acceso, función apagada), el aislamiento por tienda (cambiar de host descarta lo anterior) y que ninguna clave de
  costo, margen, descuento ni operador llega a la pantalla. `cuenta/favoritosSoloEnLaTienda.test.ts` vigila que el panel
  no mencione favoritos (ficha e historial del cliente) ni llame a sus RPC; el aislamiento del lado del servidor (los favoritos no tienen
  privilegios de API) lo prueba el pgTAP de la historia del SQL.
- **E2E** `apps/web/e2e/tienda-cuenta.e2e.ts` (job `e2e-tienda`; se omite si la base no tiene todavía las RPC de la épica): ingresar
  con `?volver=` → ver el historial → guardar y quitar un favorito → suspender la cuenta → «cuenta no activa»; la cuenta de una tienda
  no entra en la otra; 200 comprobantes por tandas de 20.
