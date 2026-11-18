---
owner: tecnico
sources:
  - apps/web/src/lib/mensajeErrorBase.ts
  - apps/web/src/lib/ventasPresupuestos.ts
  - apps/web/src/lib/facturasElegibles.ts
  - apps/web/src/components/ventas/DialogoNuevaDevolucion.tsx
---

# Errores de negocio de las RPC y su respuesta HTTP

Lote de la auditoría MSF-647: errores de negocio que PostgREST contesta como 5xx o 4xx inconsistente
(MSF-599, MSF-654, MSF-655, MSF-638), la anulación con cobros parciales (MSF-600) y «Nueva devolución»
(MSF-721).

## Qué pasa hoy

Las RPC de `public` avisan «no» al usuario con `raise exception ... using errcode = '<código>'`. PostgREST
traduce el SQLSTATE a HTTP por **clase**. La columna HTTP sale de la documentación de PostgREST y **no está verificada
contra la versión instalada** (en especial la fila `40001`):

| SQLSTATE | Uso en las RPC | HTTP de PostgREST |
|---|---|---|
| `P0002` | «no existe» / fuera de tu alcance | 500 (clase `P0`; solo `P0001` es 400) |
| `55000` | estado que no admite la acción (presupuesto vencido, comprobante cerrado…) | 500 (clase `55`) |
| `55006` | ya hay un respaldo en curso | 500 (clase `55`) |
| `54000` | tope de filas del lote o de la exportación | 413 (clase `54`) |
| `40001` | conflicto de edición (bloqueo optimista) | 500 (clase `40`) |

**El cliente ya lee `error.code`**, no el estado HTTP (`supabase-js` entrega `error.code`). Por eso la persona
ve un mensaje accionable; lo que se degrada es el monitoreo del servidor (alertas, reintentos, ruido). Casi
todas las pantallas ya traducen estos códigos en su módulo de `apps/web/src/lib` (`mensajeDeErrorComprobante`,
`mensajeDeErrorReparacion`, `mensajeDeAnulacion`, `mensajeDeErrorDespacho`, `mensajeDeRma`…).

## Criterio adoptado

1. **Normalizar en el cliente, no reescribir funciones.** Cambiar el SQLSTATE de decenas de RPC rompe a los
   clientes que ya ramifican por código (p. ej. `55000` y `40001` en Ventas y Service) y a sus pgTAP, y no hay en el
   repo el patrón `PT404`/`PT409` de PostgREST (`raise ... using errcode = 'PT409'`) que permita un 4xx sin
   cambiar de semántica. Sin ese patrón probado contra la versión instalada, no se introduce uno nuevo.
2. **Catálogo central en `lib/mensajeErrorBase.ts`**: `mensajeDeErrorBase` ahora traduce también `55000`, `55006`
   y `54000` con un texto accionable (los textos propios de cada pantalla tienen prioridad). El estado HTTP y el
   monitoreo del servidor no cambian: ver «Pendiente».
3. **Brecha concreta cerrada**: `aceptar_presupuesto` responde `55000` con «El presupuesto está vencido…» y la
   pantalla mostraba el genérico «Este comprobante ya está cerrado». `mensajeDeAceptarPresupuesto` muestra el
   texto fijo del catálogo que coincide con el de la RPC (nunca el `message` del servidor).
4. **MSF-638** (`obtener_reparacion`): una reparación de una tienda inaccesible se trata como inexistente a
   propósito (no revela que existe) y la ficha, la orden y el remito ya muestran «Esa reparación ya no existe»
   (`mensajeDeErrorReparacion`, código `P0002`). Lo único pendiente es el estado HTTP.

## Pendiente (y por qué)

- **Estado HTTP 4xx en el servidor** para `P0002`/`55000`/`55006`/`40001` en las funciones de `public`. Propuesta:
  1) verificar con un JWT real contra el PostgREST instalado que `raise ... using errcode = 'PT404'` / `'PT409'` se
  traducen a 404/409 (`message`/`detail`/`hint` se conservan); 2) crear un helper `private.error_negocio(tipo,
  mensaje, hint)` y migrar por olas, empezando por las críticas (`obtener_reparacion`, `aceptar_presupuesto`,
  `anular_comprobante`, `confirmar_comprobante`, `cambiar_estado_despacho`, `actualizar_producto`), cada ola con su
  pgTAP; 3) actualizar a la vez los mapeos del cliente para aceptar el código viejo y el nuevo.
- Alcance por código, **contado por migraciones, sin verificar contra `pg_proc`** (última definición de cada función
  de `public`): `P0002` 163 funciones (más 22 en `private` y 2 en `publico`), `55000` 39, `40001` 38, `54000` 13,
  `55006` 3. Consulta para verificarlo en una base:
  `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~* 'errcode\s*=\s*''55000''';`
- `publico.registrar_interes_whatsapp` y `publico.crear_consulta_publica` lanzan `P0002` ante un host desconocido y
  los llama `anon`: se resuelven con la misma convención, cuidando de no revelar qué hosts existen.

## MSF-600: anular una factura con cobros parciales

**Resuelto en el lote 32.** Con la decisión de negocio tomada (MSF-667: contra-asiento auditado), `anular_comprobante` rechaza
una factura con cobros registrados (`55000`, «revertí el cobro o corregila con una nota de crédito») y la persona sale con
`revertir_cobro` (solo administrador). También rechaza la factura ya entregada (MSF-661). Detalle en
`docs/cobros-por-comprobante.md`.

## MSF-638: `obtener_reparacion` fuera del alcance

**Primera ola de la convención `PT404`** (lote 32): `obtener_reparacion` responde `PT404` (HTTP 404) con el mismo mensaje cuando la
reparación no existe, es de otra organización o de una tienda inaccesible (sin oráculo de existencia), y `42501` (403) sin la
sección `service_tecnico`. El cliente acepta `P0002` y `PT404`. Sigue pendiente la verificación con un JWT real contra el
PostgREST instalado y el resto de las olas (propuesta de arriba).

## MSF-721: «Nueva devolución» no encontraba la factura

El diálogo pedía la página 1 (20 filas) de `listar_comprobantes` y filtraba en el cliente las facturas no
borrador ni anuladas. Ahora `listarFacturasElegibles` (`lib/facturasElegibles.ts`) filtra cada página y sigue con
la siguiente hasta juntar 20 elegibles (tope: 10 páginas de 50), corta si la persona cierra el diálogo o sigue
tipeando, avisa «Hay más resultados: refiná la búsqueda» si se agota el tope con páginas pendientes y, si una página
falla, muestra «No pudimos cargar los comprobantes.» con «Reintentar». Sin cambios en la base.

Pendiente: el pedido de ofrecer **Borrador** y **Anulada** en el filtro Estado de Comprobantes y mostrar el estado de
despacho en el listado cambia lo visible, y el prototipo (`VentasComprobantes.dc.html`) manda la UI: primero hay que
actualizar el prototipo y su inventario.
