# Feature Specification: Clientes y proveedores · Cuenta corriente y saldo del cliente

**Feature Branch**: `feat/story-MSF-451`
**Componente**: Clientes y proveedores
**Jira**: MSF-451 (F-CLI-19) · épica MSF-450 `cuentas-y-compras-a-proveedores`
**Created**: 2026-11-09
**Status**: En implementación. La historia pasó a hito: su tarea de épica (T001) pide «redactar
requisitos, pantalla (saldo en la ficha de `ClienteFicha`) y matriz de la cuenta corriente, a
partir de cómo Ventas maneje cobros y estado Deuda». Esta spec es esa redacción.
**Delivery scope**: `refine`, `supabase`
**Prioridad / Talla**: P3 · L (heredado de la épica)

## Contexto (por qué esta spec existe)

La épica MSF-450 («Clientes y proveedores · Cuentas y compras a proveedores») registró cuatro
ideas P3 **sin requisitos de comportamiento**, con la regla explícita de que «los requisitos se
redactan cuando pasen a un hito». F-CLI-19 («Cuenta corriente y saldo del cliente») es la primera
de esas ideas que pasa a hito: esta spec redacta sus requisitos y la historia los implementa en la
misma rama.

La fuente del comportamiento es **Ventas · cobros y conciliación** (épica MSF-195, ya entregada):

- El libro de dinero que entra es `dominio.cobros_comprobante`: un cobro por fila (parcial o
  total) de una factura.
- El saldo de una factura es **total con IVA menos lo cobrado**, nunca negativo
  (`private.saldo_comprobante`, F-VTA-12).
- El estado «Deuda» (F-VTA-10) no se consulta para calcular el saldo: una factura en «Deuda»
  simply no tiene cobros, así que debe su total completo; y una factura «Cobrada» tiene el
  saldo en 0. El saldo se calcula siempre con el mismo criterio, sin mirar el estado.
- Un borrador no se debe y una factura anulada no le debe nada a nadie.

Lo que **no** hay en el repo y esta historia **no** inventa: vencimientos, límites de crédito,
descuentos por pronto pago, notas de crédito restando de la cuenta corriente (es de MSF-195) ni
ningún estado nuevo de comprobante.

## Regla de fuentes (de la épica)

1. Comportamiento y datos: mandan los requisitos de esta spec.
2. Qué se ve: el prototipo validado (`design/pantallas/ClienteFicha.dc.html`) es referencia
   visual; esta historia **dibuja** la parte nueva (la tarjeta «Cuenta corriente») en el
   prototipo y la mapea en la *Matriz pantalla↔criterios*.
3. Cómo se construye: mandan el template y el sistema de diseño (MUI + tokens).
4. El prototipo muestra más que esta historia: se implementa solo lo que piden los requisitos.
5. Si algo no se puede igualar con el template: usar lo más cercano, sin inventar, y anotar la
   diferencia en el PR.
6. Si el prototipo y los requisitos se contradicen: requisitos para el comportamiento, prototipo
   para lo visual, y la contradicción queda anotada en el PR.

## Requisitos funcionales

- **FR-001** (F-CLI-19): DEBE existir `public.cuenta_corriente_cliente(p_cliente_id uuid)` que
  devuelve la cuenta corriente del cliente: `saldo_total` (cuánto debe), `comprobantes` (cuántos
  comprobantes tienen saldo) y una fila por comprobante **con saldo** (`id`, `numero`, `fecha`,
  `tipo`, `estado`, `total_con_iva`, `cobrado`, `saldo`), del más reciente al más antiguo. El `id`
  es el del comprobante: el número se repite entre tiendas (el correlativo es por organización,
  empresa y tipo) y el `id` es lo que identifica la fila. `security
  definer` con `search_path = ''`, organización de `private.organizacion_id()` (nunca del
  llamador), sección `clientes` en `lectura`/`edicion`; un cliente de otra organización devuelve
  saldo 0 y sin documentos (no revela si existe); `revoke … from public, anon` y `grant execute
  … to authenticated`. **Verificación**: pgTAP `supabase/tests/database/cuenta_corriente_cliente.test.sql`.
- **FR-002** (F-CLI-19): El saldo de un comprobante DEBE ser el que devuelve
  `private.saldo_comprobante` —su único dueño: `greatest(total_con_iva − Σ cobros, 0)`—, sin
  recalcularlo en esta RPC. **Verificación**: pgTAP (cobro parcial, cobro
  total, cobro que supera el total → 0) + comparación documento por documento con
  `private.saldo_comprobante` (SC-001).
- **FR-003** (F-CLI-19): A la cuenta corriente entran **solo facturas** que no están en
  `borrador`, `anulada` ni `cobrado` (una cobrada está saldada aunque su cobro no esté en el libro). Los presupuestos no son deuda y no entran; las notas de crédito no
  restan (ver *Fuera de alcance*). **Verificación**: pgTAP (presupuesto, anulada, borrador y nota
  de crédito quedan fuera; la factura en estado `deuda` entra con su total completo).
- **FR-004** (F-CLI-19): `saldo_total` DEBE ser la suma de los saldos de los comprobantes listados
  (y 0 si no hay ninguno); `comprobantes` DEBE ser la cantidad de comprobantes listados.
  **Verificación**: pgTAP.
- **FR-005** (F-CLI-19): La ficha (`/clientes/show/:id`) DEBE mostrar, en la tarjeta «Resumen
  comercial», el **«Saldo deudor»** junto al «Facturado en el año» (el prototipo ya lo muestra) y,
  debajo de «Últimos comprobantes», la tabla **«Cuenta corriente»** con los comprobantes que
  tienen saldo (Comprobante, Fecha, Estado, Total, Cobrado, Saldo). Los números de comprobante
  son texto (el enlace al comprobante es de Ventas). **Verificación**: Vitest
  (`apps/web/src/components/clientes/ComprasCliente.test.tsx`) + E2E `apps/web/e2e/cuenta-corriente-cliente.e2e.ts`.
- **FR-006** (F-CLI-19): La sección DEBE usar los patrones compartidos de carga, vacío y error
  (con «Reintentar»), ser usable en 320/768/1440 px, con teclado y lector de pantalla; si la
  cuenta corriente no se puede leer, el «Saldo deudor» muestra «—» y el bloque «Cuenta corriente»
  muestra el error con «Reintentar» (el error no se come el resto de la ficha). **Verificación**:
  Vitest (carga, vacío, error + reintento).
- **FR-007** (F-CLI-19): La cuenta corriente se calcula sobre **las tiendas a las que la persona
  accede** (`private.empresas_accesibles()`, como `public.saldo_comprobante`; el administrador accede
  a todas): no ve la deuda de tiendas ajenas. **Verificación**: pgTAP
  (las facturas de las dos tiendas suman en el mismo saldo).
- **FR-008** (F-CLI-19): La RPC NO DEBE crear ni alterar tablas; la migración DEBE ser aditiva
  con el camino de reversión documentado en el encabezado. **Verificación**: pgTAP (`rls_en_toda_tabla`
  verde) + `pnpm test:db:validar-aditivas` + revisión del encabezado de la migración.
- **FR-009** (F-CLI-19): La documentación del repo (`docs/clientes.md`) DEBE describir la cuenta
  corriente y el saldo de la ficha. **Verificación**: `pnpm docs:check` + revisión del diff.

## Escenarios de verificación

- **FR-001** — *Given* un cliente con una factura de $1.210 totalmente cobrada, otra de $1.210 con
  un cobro de $400 y otra de $605 en estado `deuda`, *When* se lee su cuenta corriente, *Then*
  devuelve saldo total $1.415 ($810 + $605), 2 comprobantes con saldo y sus filas con total,
  cobrado y saldo.
- **FR-002** — *Given* una factura con un cobro que supera su total, *When* se lee su cuenta
  corriente, *Then* su saldo es 0 y no aparece en la lista.
- **FR-003** — *Given* un cliente con un presupuesto, una factura anulada, una factura en
  borrador y una nota de crédito, *When* se lee su cuenta corriente, *Then* ninguno de esos
  documentos aparece y no suman al saldo.
- **FR-004** — *Given* un cliente sin comprobantes con saldo, *When* se lee su cuenta corriente,
  *Then* devuelve saldo 0, 0 comprobantes y ninguna fila de documento.
- **FR-005** — *Given* la ficha de un cliente con deuda, *When* se abre, *Then* se ve el «Saldo
  deudor» con el importe y la tabla «Cuenta corriente» con los documentos abiertos.
- **FR-006** — *Given* que la base no responde, *When* se abre la ficha, *Then* el bloque
  «Cuenta corriente» muestra el error con «Reintentar» y el resto de la ficha sigue visible.
- **FR-007** — *Given* un cliente que debe en dos tiendas, *When* se lee su cuenta corriente,
  *Then* el saldo suma las dos tiendas si la persona accede a ambas; si accede a una sola, suma solo esa.
- **FR-001** (seguridad) — *Given* un usuario sin permiso de Clientes, *When* llama la RPC
  directo a la base, *Then* recibe error de permiso; y `anon` no puede ejecutarla.
- **FR-001** (seguridad) — *Given* un cliente de otra organización, *When* se lee su cuenta
  corriente, *Then* devuelve saldo 0 y sin documentos.

## Criterios de éxito

- **SC-001**: la cuenta corriente de un cliente cuadra con `private.saldo_comprobante` documento
  por documento —el pgTAP la llama y compara cada fila—, y el saldo total es la suma de los saldos
  listados (pgTAP).
- **SC-002**: aislamiento: otra organización no lee saldos ajenos; la sección Clientes en
  `ninguno` no lee la cuenta corriente; `anon` sin ejecución; ninguna tabla nueva sin RLS
  (pgTAP).
- **SC-003**: la ficha muestra el «Saldo deudor» y la tabla «Cuenta corriente», con vacío para un
  cliente sin deuda y sin romperse si la base falla (Vitest + E2E).
- **SC-004**: `pnpm lint && pnpm build && pnpm test && pnpm docs:check && pnpm matriz:check &&
  pnpm prototipo:check` sin errores.
- **SC-005**: el diff no toca tablas ni el comportamiento de Ventas: solo una RPC de lectura nueva,
  la ficha del cliente y su prototipo.

## Esquemas de datos (Principio VII)

Esta spec **no crea ni altera tablas**. No hay esquema que declarar:

| Objeto | Esquema | Motivo |
|---|---|---|
| `dominio.comprobantes_venta` | `dominio` (existente) | Documentos de venta: se leen, no se escriben. |
| `dominio.cobros_comprobante` | `dominio` (existente) | Libro de cobros: se lee, no se escribe. |
| `public.clientes` | `public` (existente) | Se lee para verificar que el cliente es de la organización. |
| `public.cuenta_corriente_cliente(uuid)` | `public` (nueva RPC) | Mecanismo de plataforma (la usan el panel y la tienda); no es una entidad de negocio. |

Ninguna tabla nueva: el pgTAP `rls_en_toda_tabla` sigue verde sin cambios.

## Matriz pantalla↔criterios

Inventario determinista con `pnpm prototipo:inventario` sobre `design/pantallas/ClienteFicha.dc.html`
(`ClienteFicha.inventory.json`). La tarjeta «Cuenta corriente» la dibuja esta historia (la tarea
de épica T001 pide «pantalla … y matriz de la cuenta corriente»); el resto del prototipo ya
existía.

### Clientes · Ficha (`ClienteFicha.dc.html`)

| Ítem del inventario | Destino | Criterio |
|---|---|---|
| Tarjeta «Resumen comercial» → «Saldo deudor» | En alcance | F-CLI-19 US1-1, FR-005 |
| Tarjeta «Resumen comercial» → «Facturado en 12 meses» | Ya entregado por F-CLI-10 (como «Facturado en el año», sin IVA) | — |
| Tarjeta «Resumen comercial» → «Comprobantes», «Último» y botón «Nuevo comprobante» | **FUERA DE ALCANCE** — no los pide esta historia (son de Ventas) | — |
| Tabla de «Cuenta corriente» (Comprobante, Fecha, Estado, Total, Cobrado, Saldo) | En alcance (la dibuja esta historia) | F-CLI-19 US1-2, FR-005 |
| Tarjeta «Últimos comprobantes» (número, estado, total) | Ya entregado por F-CLI-10; esta historia no lo cambia | — |
| Campos de datos del cliente, botones «Etiqueta», «Guardar cambios», «Configurar tipos de cliente →», «Incluir en el correo masivo», «Imprimir etiqueta de envío», bloque «Cuenta web» y sus acciones | **FUERA DE ALCANCE** — ficha, edición y cuenta web ya entregadas (MSF-180, MSF-237) | — |

### Empresa activa (Principio VIII)

| Ítem | Destino | Motivo |
|---|---|---|
| Empresa activa (selector de la barra superior) | **No aplica** | La cuenta corriente suma las tiendas a las que la persona accede (FR-007, `private.empresas_accesibles()`): es la deuda del cliente en esas tiendas, no la de la empresa activa. La sección **no depende** de la empresa activa y no hay datos que reencuadrar al cambiarla. Lo que sí depende de la empresa activa en esta ficha —el bloque «Cuenta web», que es por tienda— ya se reencuadra (test `apps/web/src/pages/clientes/empresa-activa.test.tsx`). El texto «Si elegís una empresa en la barra superior, se filtra por esa tienda» es del **listado** de Clientes (`Clientes.dc.html`), no de la ficha. |

## Flujos

```mermaid
stateDiagram-v2
  [*] --> Documento: factura confirmada
  Documento --> Deuda: forma de pago que genera deuda
  Documento --> Cobrado: el saldo queda en 0
  Deuda --> Cobrado: se registra el cobro que completa el total
  state Deuda {
    [*] --> Parcial: cobro parcial (queda saldo)
  }
```

El saldo de un documento no se guarda: se calcula siempre como total con IVA menos cobros. Por eso
el saldo del cliente tampoco se guarda: se calcula sumando los documentos abiertos.

## Fuera de alcance (explícito)

- **Notas de crédito restando de la cuenta corriente.** El prototipo de Ventas lo dice («restan de
  lo facturado y de la cuenta corriente»), pero ese efecto pertenece a **MSF-195** (la nota de
  crédito no admite cobros hoy: F-VTA-12). Esta historia no lo reasigna: la nota no resta del
  saldo y queda anotado como diferencia conocida en el PR. **Seguimiento**: tarea `seguimiento`
  en It's a Plan para que MSF-195 lo tome.
- Vencimientos, límites de crédito, pago a plazo, descuentos por pronto pago, saldo a fin de mes
  o cualquier otra aritmética de crédito.
- Un estado nuevo de comprobante o una tabla nueva de «movimientos de la cuenta corriente»: la
  cuenta corriente es una **lectura** de los documentos abiertos, no un libro propio.
- Un historical de la deuda por fecha («saldo a fin de mes»): la cuenta corriente es la deuda
  **de hoy**.
- La reversa de un cobro mal cargado (es de MSF-195) y la exportación de la cuenta corriente.
- El «Nuevo comprobante», el contador de «Comprobantes» y la fecha del «Último» de la ficha
  (son de Ventas y quedaron fuera de alcance en F-CLI-08…10).
- El saldo por tienda o el detalle por tienda de la cuenta corriente: la tabla no muestra la
  tienda de cada documento. Como el correlativo es por empresa, el número puede repetirse entre
  tiendas de la misma organización; lo que distingue las filas es el `id` del comprobante.

## Decisiones (provisorias, con valor por defecto)

1. **Base del saldo** — con IVA: es el saldo que el cliente debe (el mismo criterio de
   `private.saldo_comprobante`). El «Facturado» que ya se muestra en la ficha es sin IVA (criterio
   del ranking); son dos números distintos y cada uno dice su base en la etiqueta.
2. **Alcance por tiendas accesibles** — las tiendas a las que la persona accede (FR-007); a diferencia de la sección «Compras», que hoy es de toda la organización (diferencia conocida, con seguimiento).
3. **Quién ve el saldo** — cualquiera con Clientes en `lectura`/`edicion`, el mismo permiso que
   la sección «Compras»: el saldo es un agregado de comprobantes que esa persona ya ve en la
   ficha, no información nueva.
4. **Paginación** — la cuenta corriente **no** pagina: lista los documentos abiertos del cliente.
   El «Facturado en el año» y los «Últimos comprobantes» de F-CLI-10 sí paginan.
5. **Notas de crédito** — no restan (ver *Fuera de alcance*).
6. **Identidad de la fila** — el `id` del comprobante, no el número: el correlativo es por
   organización, empresa y tipo, así que el mismo número puede repetirse entre tiendas de la misma
   organización. La tabla no muestra la tienda (el detalle por tienda está fuera de alcance), pero
   cada fila es un comprobante distinto.

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Jira | Historia | FR / SC | Tasks |
|---|---|---|---|
| MSF-451 | F-CLI-19 US1 Cuenta corriente y saldo del cliente | FR-001…FR-009, SC-001…SC-005 | T001–T007 |
