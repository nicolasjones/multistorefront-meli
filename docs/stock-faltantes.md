# Stock · Faltantes con aviso de reposición (F-STK-17)

Pestaña **Faltantes** de Stock (`/stock/faltantes`): las líneas «A pedido» de facturas confirmadas que
esperan mercadería, con un aviso por correo al cliente cuando el producto vuelve a tener stock. Spec:
`specs/20261024-130000-stock-carga-exportacion-y-avisos/` (US4, FR-301…FR-311, SC-301…SC-303). Prototipo:
`design/pantallas/VentasFaltantes.dc.html`.

Migraciones de la historia (aditivas, con reversión en el encabezado): `20261213100200_faltantes_avisos.sql`
(tabla y RPC de la cola), `20261213100300_faltantes_listado.sql` (vista) y
`20261213100400_avisar_faltantes.sql` (RPC de aviso). Usan una versión **nueva y mayor** a propósito: con
los números que nombra `tasks.md` (`2026120612…`) la migración quedaba por debajo de la cola ya aplicada
en dokploy y no se aplicaba nunca (guard `scripts/verificar-migraciones.mjs`: «versión REUSADA»). El orden
de dependencia se mantiene: tabla → vista → RPC.

## Qué es un faltante

Una línea de una **factura confirmada** cuyo producto es «A pedido» (`a_pedido = true`) y cuya **reserva
sigue activa** (`dominio.reservas_stock`, referencia `comprobante:<id>:linea:<orden>`). Lo calcula la vista
`public.faltantes_listado` (`security_invoker`, migración `20261213100300`):

- Borradores, presupuestos y líneas con stock **no** aparecen.
- **No hay cierre manual.** Una línea sale sola cuando su reserva deja de estar activa: al **descontarse**
  (entrega, MSF-135: `descontar_reserva`) o al **liberarse** (`liberar_reserva`). Nota MSF-135: esta pantalla
  no entrega ni descuenta; solo lee el estado de la reserva, así que cuando la entrega exista el faltante se
  cierra sin tocar nada acá.
- Solo se ven las **tiendas con `ventas` en lectura o edición** para la persona
  (`private.nivel_ventas_en_empresa`) y con la sección Stock visible. Otra organización nunca ve filas.
- Columnas: Tienda, Cliente, Producto (nombre y SKU), Pedido, Comprobante (enlace), Desde (fecha de
  confirmación), Stock hoy (estado de `stock_estados`: Sin stock / Stock bajo / Disponible) y Aviso
  (Sin avisar / Avisado). Orden por «Desde» descendente, 25 por página.

## La pantalla

Tabla con casilla por fila y «seleccionar todo», filtro de tienda (`FiltroEmpresa`) y pie «N seleccionados de
M faltantes». Por debajo de 900 px la tabla se condensa en tarjetas (componente compartido) y la casilla por
fila **se mantiene**: es el control para elegir faltantes y tiene que quedar accesible también a 320 px.
Cada casilla se nombra con el producto, el cliente y el **comprobante** («Seleccionar {producto} de {cliente}
del comprobante {número}»): el mismo producto puede estar pedido por el mismo cliente en más de un
comprobante y, sin el comprobante, las casillas quedan con el mismo nombre accesible.

## Ciclo de vida del aviso

1. La persona con **`ventas` en edición** en la tienda selecciona faltantes y toca «Avisar a los
   seleccionados (N)» → diálogo «Avisar a los clientes» → «Enviar avisos».
2. `avisar_faltantes(p_lineas uuid[])` (migración `20261213100400`) **omite** y cuenta: ya avisadas, producto
   **sin stock disponible hoy**, cliente **sin correo** y líneas **sin permiso** (solo lectura). Con el resto
   registra una fila por línea en `dominio.faltantes_avisos` (`pendiente`). Es idempotente por línea. Entre 1 y
   200 líneas por llamada (`22023` si no).
3. El aviso emergente dice «Avisos enviados» y, si corresponde, cuántos se omitieron y por qué.
4. El flow de Kestra `avisos-faltantes` (cada minuto) llama a la Edge Function `enviar-aviso-faltante`
   (`{"barrer": true}`): toma los avisos pendientes **por cliente**, manda **un correo por cliente** con el
   detalle de todos sus productos y cierra los avisos como `enviado`. La base solo encola y registra; no hace
   HTTP (`docs/adoptar-ciclo-ejecuciones.md` §3.1).
5. **Reintentos:** la toma reserva el aviso 2 minutos (dos barridos no mandan el mismo correo; es también la
   espera del reintento). Un envío fallido queda `pendiente` con el error sanitizado (máx. 300 caracteres, una
   línea, **sin direcciones de correo**). Al llegar a **5 intentos** el aviso pasa a `agotado`: la línea
   **vuelve a «Sin avisar»**, el error queda en `ultimo_error` y se puede avisar de nuevo. Un fallo de envío
   nunca toca la venta ni el stock.
6. **Un correo por cliente:** mientras hay un envío en vuelo de un cliente (su tanda reservada hace menos de
   2 minutos) no se abre otra tanda para ese cliente. Así el cliente recibe un solo correo con todos sus
   faltantes y el cierre —que es por cliente— no pisa otra tanda. La línea que entra en cola durante el envío
   espera a que venza la reserva y sale en el barrido siguiente.
7. **Solo se avisa de faltantes abiertos:** si la reserva se liberó o descontó antes de salir el correo (el
   faltante se cierra solo), la línea en cola **vuelve a «Sin avisar»** con el motivo y **no se manda ningún
   correo** de un faltante que ya no existe. Lo decide `private.faltante_abierta`, el mismo criterio que la
   vista del listado.
8. Garantía **al menos una vez**: si el correo sale pero la base no logra cerrar el aviso, el próximo barrido
   lo reenvía (se prefiere un duplicado a perder el aviso).

El destinatario sale siempre de la base (correo del cliente), nunca del pedido HTTP: la función no es un relay.

## Seguridad

- `dominio.faltantes_avisos` (esquema `dominio`: dato del producto) con **RLS** por organización y tienda
  (`ventas` en lectura/edición). Sin insert/update/delete para `authenticated`; `anon` sin privilegios.
- `faltantes_avisos_pendientes`, `tomar_aviso_faltante` y `cerrar_aviso_faltante` son **solo `service_role`**
  (la clave de servicio vive únicamente en la Edge Function, nunca en el navegador).
- `avisar_faltantes`: `revoke … from public, anon` y `grant execute … to authenticated`; la organización sale
  de la sesión, nunca del pedido.
- El error de envío se **sanea** antes de guardarlo o de escribirlo en el log: se borran las direcciones de
  correo (el SMTP puede devolverlas) y se acota a 300 caracteres. `ultimo_error` lo lee el panel, así que el
  correo del cliente no es un dato que deba quedar ahí.
- La migración `20261213100200` da `execute` a `authenticated` sobre `private.nivel_ventas_en_empresa` (la
  usan la política y la vista; es `security definer` y solo informa el nivel de quien la llama).
- `private.faltante_abierta` (la usan solo las RPC de la cola, que son de `service_role`) decide si el
  faltante de una línea sigue abierto.

## Empresa activa (Principio VIII)

La lista sigue a la empresa activa de la barra superior y al filtro «Tienda» (`FiltroEmpresa`). Al cambiar:

- se **reencuadra en el mismo render**: la paginación vuelve a la página 1, la consulta de la nueva
  empresa sale una sola vez (no se pide una página que ya no corresponde) y el diálogo abierto se cierra
  con aviso («Cambiaste de empresa: se cerró el aviso a los clientes»). Así no se dibuja ni un cuadro con
  los datos de la empresa anterior;
- la **selección se descarta** y no vuelve a armarse sola al regresar a la empresa anterior (si
  reapareciera, el botón «Avisar» se activaría con filas que la persona ya no eligió);
- una **respuesta tardía** de la empresa anterior no pisa la lista nueva (la petición vigente es la
  última).

Nunca se muestran filas ni totales de la empresa anterior. La recarga que sigue a un aviso usa los filtros
**vigentes** (página y empresa de ahora): si la persona cambió de página o de empresa mientras el aviso
viajaba, lo que se recarga es lo que está a la vista, nunca la página anterior.

## Variables y operación

| Dónde | Variable |
|---|---|
| `infra/kestra/.env` (ejemplo en `infra/kestra/.env.example`) | `AVISOS_FALTANTES_URL`, `AVISOS_FALTANTES_APIKEY` (clave pública anon), `SECRET_AVISOS_FALTANTES_TOKEN` (**base64**) |
| Secretos de la función (`supabase/functions/.env.example`) | `AVISOS_FALTANTES_TOKEN` (decodificado, igual al de Kestra), `SMTP_*` |

Generar el token de Kestra: `printf '%s' '<token>' | base64 -w0`. Sin `AVISOS_FALTANTES_TOKEN` la función
responde 503 y rechaza todo.

## Reversión

Migraciones aditivas. Para deshacer (en una migración posterior, exportando antes `dominio.faltantes_avisos`):

```sql
drop function public.avisar_faltantes(uuid[]);
drop view public.faltantes_listado;
drop function public.faltantes_avisos_pendientes(integer, integer);
drop function public.tomar_aviso_faltante(uuid, integer);
drop function public.cerrar_aviso_faltante(uuid, boolean, text, integer);
drop function private.faltante_abierta(uuid);
drop table dominio.faltantes_avisos;
revoke execute on function private.nivel_ventas_en_empresa(uuid) from authenticated;
```

Además: desactivar el flow `avisos-faltantes` en Kestra y quitar la pestaña/ruta `/stock/faltantes`.

## Pruebas

pgTAP `faltantes_listado.test.sql` (la vista: solo facturas confirmadas «A pedido» con reserva activa, se
cierra al descontar o liberar, borrador/presupuesto no aparecen, tienda sin `ventas` no ve filas, otra
organización aislada y `anon` sin acceso) y `faltantes_avisos.test.sql` (`avisar_faltantes` marca y encola
un correo por cliente, no repite, omite sin stock/sin correo/sin permiso; toma, cierre y agotado; un faltante
que se cerró antes del correo no se avisa; con un envío en vuelo no se abre una segunda tanda del mismo
cliente; un fallo de envío no toca la venta ni el stock; las RPC de la función de envío no las ejecuta
`authenticated` ni `anon`); `node --test
supabase/functions/enviar-aviso-faltante/handler.test.ts` (el error que se registra no lleva el correo del
cliente); `node --test
infra/kestra/validar-avisos-faltantes.test.mjs`; Vitest `lib/faltantes.test.ts` (la capa de datos: consulta
con tienda y paginación, llamada a `avisar_faltantes` y texto del aviso emergente, con el singular de
«1 ya avisado»), `pages/stock/faltantes.test.tsx`
(columnas, selección, contadores, diálogo, resultado con omitidos, rol sin `edicion`, orden por «Desde»
descendente, paginación, estados de carga/vacío/error, nombre accesible propio de cada casilla y recarga
con los filtros vigentes después de avisar) y `faltantes.empresa.test.tsx` (empresa activa:
reencuadre de la paginación, descarte de la selección, cierre del diálogo y respuesta tardía de la empresa
anterior).
