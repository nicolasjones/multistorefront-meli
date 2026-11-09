# Implementation Plan: Clientes y proveedores · Cuenta corriente y saldo del cliente

**Spec**: `specs/20261109-100000-cuenta-corriente-y-saldo-cliente/spec.md` · **Historia**: MSF-451
(F-CLI-19) · **Épica**: MSF-450 · **Delivery scope**: `refine`, `supabase`.

## Resumen

La cuenta corriente del cliente es una **lectura** de lo que ya existe: los documentos de venta
abiertos (`dominio.comprobantes_venta`) menos el libro de cobros (`dominio.cobros_comprobante`).
No hay libro nuevo, ni tabla nueva, ni estado nuevo: una RPC de lectura (`public.cuenta_corriente_cliente`)
resuelve el saldo y el detalle, y la ficha del cliente los muestra.

## Contexto técnico

- **Base**: `dominio.comprobantes_venta` (facturas del cliente, `total_con_iva`, `estado`) y
  `dominio.cobros_comprobante` (el libro de cobros, `importe`). Índices existentes:
  `comprobantes_venta_cliente_fecha_idx` (organización, cliente, fecha) y
  `cobros_comprobante_comprobante_idx` (comprobante, fecha). La consulta de la cuenta corriente
  entra por cliente y agrupa por comprobante: no necesita un índice nuevo.
- **Criterio de saldo**: `greatest(total_con_iva − Σ cobros, 0)`, el mismo de
  `private.saldo_comprobante` (F-VTA-12). Se replica (no se inventa): la función interna es
  `security definer` sin `grant` y sirve para un comprobante, no para un cliente.
- **Permiso**: sección `clientes` en `lectura`/`edicion`, el mismo de `public.compras_de_cliente`
  (F-CLI-10), que ya alimenta la sección «Compras» de la ficha.
- **Organización**: sale de `private.organizacion_id()`; un cliente de otra organización devuelve
  saldo 0 y sin documentos (no revela su existencia).
- **RPC**: `public.cuenta_corriente_cliente(p_cliente_id uuid)` en `public` (mecanismo de
  plataforma). Devuelve el encabezado (`saldo_total`, `comprobantes`) en cada fila y una fila de
  encabezado con los documentos en nulo cuando el cliente no debe nada (mismo patrón que
  `public.compras_de_cliente`).
- **Web**: hook `useCuentaCorrienteCliente` (mismo estilo que `useComprasCliente`: «última petición
  gana») y la vista en `apps/web/src/components/clientes/ComprasCliente.tsx`: el «Saldo deudor»
  junto al «Facturado en el año» (tarjeta «Resumen comercial» del prototipo) y la tabla
  «Cuenta corriente» debajo de «Últimos comprobantes».
- **Prototipo**: `design/pantallas/ClienteFicha.dc.html` (y su copia en
  `design/pantallas/ClienteFicha/`) reciben la tarjeta «Cuenta corriente»; los inventarios se
  regeneran con `pnpm prototipo:inventario`.
- **Sin dependencias pendientes**: Ventas · cobros y conciliación (MSF-195) está entregado; el
  saldo del comprobante, el libro de cobros y el estado «Deuda» ya existen.

## Verificación de la constitución

| Principio | Resultado |
|---|---|
| I. Aislamiento | La RPC exige sección `clientes`, toma la organización de la sesión y no filtra por la organización del llamador. pgTAP con otra organización y con `anon`. |
| II. Spec antes de implementar | Cumple: esta spec, este plan y estas tareas van antes del código. |
| VI. Panel operable | La vista usa los patrones compartidos (carga, vacío, error con «Reintentar»), la tabla adaptable (`ContenidoAdaptable`) y los tokens del sistema de diseño. Sin rutas ni navegación nuevas. |
| VII. Esquemas | Sin tablas nuevas. Se leen tablas `dominio` y `public` ya existentes; la RPC vive en `public` (mecanismo). Declarado en la spec. |
| VIII. Empresa activa | No aplica a esta sección (es de toda la organización, como la sección «Compras»); declarado en la *Matriz pantalla↔criterios*. |
| Documentación | `docs/clientes.md` se actualiza en el mismo cambio. |

## Reversión

La migración es aditiva y su reversión está en el encabezado: `drop function
public.cuenta_corriente_cliente(uuid);`. La historia se revierte con `git revert -m 1` de su merge.
No se destruye ninguna tabla ni columna: la cuenta corriente es una lectura, así que revertir la
migración no pierde datos (los cobros y los comprobantes siguen ahí).

## Riesgos

- **El saldo y el «Facturado» usan bases distintas** (con IVA y sin IVA): puede confundir. Se
  mitiga etiquetando la base en cada número («Saldo deudor» / «Facturado en el año (sin IVA)»).
- **Las notas de crédito no restan** del saldo (es de MSF-195): el número puede quedar alto si
  el cliente recibió notas de crédito. Queda anotado en la spec y en el PR, con seguimiento.
- **La cuenta corriente no pagina**: un cliente con muchísimos documentos abiertos trae todos.
  Aceptado en la *Decisión 4* de la spec; si molesta, se pagina en una historia posterior sin
  cambiar el contrato de la RPC.
