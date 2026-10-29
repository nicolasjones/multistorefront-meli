---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Ventas · cobros y conciliación (MSF-195)

**Épica:** MSF-195 · **Historias:** F-VTA-12 (cobros por comprobante), F-VTA-13 (conciliación de pagos por
cuenta de cobro) y F-VTA-14 (contrarreembolsos por transporte). **Spec:**
`specs/20261024-150000-ventas-cobros-y-conciliacion/` · **Rama:**
`epic/MSF-195-ventas-y-despacho-ventas-cobros-y-concil`, pendiente de merge a `main`.
Detalle técnico: [Ventas · cobros y conciliación (técnico)](../tecnico/ventas-cobros-y-conciliacion.md).

Esta página explica **qué resuelve** la épica: que cada comprobante tenga sus cobros registrados
(parciales o totales), que Administración concilie las transferencias por cuenta de cobro contra el
extracto del banco, y que los contrarreembolsos que cobran los transportes queden controlados hasta
que los rindan. La factura y el presupuesto se cargan en
[Ventas · comprobantes (MSF-159)](ventas-comprobantes.md) y el listado de comprobantes, con sus
estados, está en [Ventas · listado, estados y anulación (MSF-177)](ventas-listado-estados-y-anulacion.md).

## Qué resuelve

- **El dinero que entra queda registrado**: cada comprobante tiene una **tarjeta Cobros** con los
  cobros cargados, lo cobrado y lo que falta. Una factura se puede cobrar en partes.
- **La factura sabe si está cobrada**: cuando el saldo llega a 0 la factura pasa a **Cobrado**; si
  queda saldo y la forma de pago «genera deuda», pasa a **Deuda**. **Nadie lo cambia a mano.**
- **El control del dinero que entra por banco**: la pantalla **Pagos** lista los pagos con cuenta de
  cobro y permite **aprobar** (conciliar) cada uno contra el extracto del banco, o **deshacer** esa
  aprobación.
- **El cobro a la entrega no se pierde**: cuando un transporte cobra al entregar, el
  **contrarreembolso** queda **Pendiente** hasta que Administración lo marca cobrado; recién ahí
  cuenta como cobro de la factura.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Mostrador** | Registra cobros (parciales o totales) en el detalle de la factura. |
| **Administración** | Registra cobros, **concilia** los pagos de **Pagos** y **marca cobrados** los contrarreembolsos de Transportes. |
| **Administrador** | Lo mismo que Administración. |
| **Operador** | Tiene Ventas en edición, pero **no** registra cobros, **no** concilia pagos y **no** cobra contrarreembolsos: son acciones aparte. |
| **Depósito** | Ventas en solo lectura: ve los cobros y el estado de las facturas, sin registrar ni conciliar. |
| **Consulta** | Ventas en solo lectura. |
| **Miembro** | Ventas en solo lectura. |
| **Técnico** | Sin acceso a la sección Ventas. |

Sin la sección **Ventas** la pantalla muestra «Acceso restringido».

!!! note "Los roles son un supuesto a confirmar con el cliente"
    La spec deja como *Decisión abierta* 1 quién registra y quién aprueba. Hoy está sembrado **por
    datos** (una fila por organización, rol, sección y acción), así que corregirlo es una migración de
    datos, no un cambio de estructura.

## Cobros por comprobante (F-VTA-12)

La tarjeta **Cobros** vive en el detalle del comprobante (`/ventas/comprobantes/:id`).

- **Totales Cobrado y Saldo** y la lista de cobros: fecha, forma de pago, cuenta de cobro, importe y
  quién lo registró.
- Botón **«Registrar cobro»**: solo aparece con la acción `registrar_cobro` en la empresa de la
  factura y solo si el comprobante es una **factura en estado operativo**. Un presupuesto, un
  borrador o una factura anulada no lo muestran.
- El **diálogo «Registrar cobro»** pide **Forma de pago**, **Cuenta de cobro** (solo cuando la forma
  la exige; la etiqueta es «Banco · Titular») e **Importe**, que arranca con el saldo pendiente como
  valor sugerido.
- **Los errores van al campo**: la base dice qué campo falló (importe, forma de pago o cuenta de
  cobro) y la pantalla lo marca ahí, no como un error general.
- Un **cobro no se borra ni se edita**: es un libro de dinero. Corregir un cobro mal cargado
  (reverso de cobro) **no está en esta épica**.
- El **saldo** es `total con IVA − suma de los cobros`. Dos cobros simultáneos que juntos exceden el
  saldo: **solo se guarda el primero**.

### El campo «Cuenta de cobro»

En la tarjeta de datos del comprobante:

- el valor es la cuenta del **último cobro con cuenta**;
- el chip dice **«Sin conciliar»** o **«Conciliado»** según si ese cobro fue aprobado;
- el enlace **«Ir a Pagos →»** lleva a la pantalla de conciliación;
- la ayuda es «Titular y CUIT se ven al elegir la cuenta. Se concilia en Pagos.»;
- y cuando la forma de pago del último cobro es **Contrarreembolso**, aparece el texto «El
  transporte cobra al entregar. Queda en Transportes y contrarreembolsos hasta que lo rindan.».

## Conciliación de pagos (F-VTA-13)

La pantalla **Pagos** (`/ventas/pagos`) tiene el título «Pagos» y el subtítulo «Conciliación de
cobros: cada pago por transferencia o depósito se aprueba contra la cuenta bancaria.».

- **Tres tarjetas**: **Por conciliar** («N pagos sin aprobar»), **Conciliado** («N pagos aprobados») y
  **Saldo pendiente de clientes** («Comprobantes con pago parcial»).
- **Filtro Tienda** (píldoras «Todas las tiendas» + las accesibles) y **filtro por cuenta de cobro**
  (píldora «Todas» + las cuentas). El interruptor **«Solo con saldo»** deja solo los pagos de
  comprobantes que todavía deben algo.
- **Tabla**: Fecha · Tienda · Comprobante (enlace al detalle) · Cliente · Cuenta de cobro · Importe ·
  Aprobado por · **Cobrado** (interruptor) · Saldo. El saldo va en tono de advertencia; si el cliente
  no debe nada, va «—».
- **El interruptor «Cobrado»** concilia o revierte la conciliación de esa fila. Con conciliar queda el
  aviso «Pago conciliado · N» y con revertir «Conciliación revertida · N» (N es el número del
  comprobante). Sin la acción `conciliar_pago` el interruptor va **deshabilitado**: el rol ve el
  listado pero no puede aprobar.
- **Vacío**: «Sin pagos para mostrar / Cambiá de cuenta o desactivá el filtro de saldo.»; **error**
  con «Reintentar».
- Al pie, la tarjeta **Cuentas de cobro**: «N cargadas · se muestran las más usadas. Las marcadas
  como No usar no se ofrecen al cargar un comprobante, pero conservan su historial.», con los botones
  **«Ver todas las cuentas de cobro»** y **«Nueva cuenta»** que abren `/ventas/cuentas-cobro`.

!!! note "Conciliar no es cobrar"
    El **cobro** se registra cuando llega el dinero (F-VTA-12). La **conciliación** confirma, contra
    el extracto del banco, que ese pago llegó a la cuenta. Conciliar o revertir **no** cambia el
    estado de la factura ni su saldo.

## Contrarreembolsos por transporte (F-VTA-14)

La pantalla **Transportes y contrarreembolsos** (`/ventas/transportes`) tiene el subtítulo «Cobros a
la entrega por empresa de transporte, mensajería propia en moto y terminales de retiro.» y dos
sub-pestañas.

- **Contrarreembolsos** (la que abre por defecto), con la ayuda «El transporte cobra al entregar y
  rinde después.»:
  - **Tarjetas** «Contrarreembolsos pendientes» («N envíos sin rendir») y «Cobrados este mes»
    («Rendidos por los transportes»).
  - **Tabla**: Fecha · Tienda · Comprobante (enlace al detalle) · Cliente · Empresa de transporte ·
    Guía · Importe · Estado (chip **Pendiente** / **Cobrado**) y el botón **«Marcar cobrado»**.
  - «Marcar cobrado» queda **deshabilitado** si el contrarreembolso ya está cobrado y **oculto** si la
    persona no tiene la acción `cobrar_contrarreembolso` en esa tienda. Al cobrar, aviso
    «Contrarreembolso cobrado · <transporte>».
- **Terminales de retiro**: la tabla y el diálogo de MSF-139 (catálogo de transportes y terminales de
  retiro) sin cambios.

### Cómo se abre un contrarreembolso

La **guía de despacho** (F-VTA-16 · MSF-135) es la que abre el contrarreembolso cuando el transporte
cobra al entregar. Como esa historia todavía no existe, la épica deja el punto de entrada preparado
y **simulable** desde la base (los datos de prueba de DEV lo hacen):

```sql
select private.abrir_contrarreembolso('<comprobante_id>', '<transporte_id>', 'GUIA-DEV-0001');
```

Solo abre el contrarreembolso si el transporte tiene **«Cobra contrarreembolso»**, y es idempotente
por (comprobante, guía): la misma guía no abre dos contrarreembolsos.

## Empresa activa

Las tres pantallas respetan la **empresa activa** de la barra superior (Principio VIII).

- Al **cambiar de empresa** se invalidan y recargan **todas** las consultas de la pantalla (listado,
  tarjetas y filtros), la paginación vuelve a la primera página y se descarta el filtro de cuenta
  que ya no existe. No queda ninguna fila ni total de la empresa anterior.
- En el **detalle** del comprobante, además, el diálogo «Registrar cobro» abierto **se cierra con
  aviso**: nunca queda un cobro de una tienda cargado bajo la otra.
- El filtro **Tienda** de cada pantalla no cambia la empresa activa de la barra superior: acota lo que
  se ve.

## Matriz pantalla↔criterios

| Ítem visible | Dueño |
|---|---|
| Tarjeta **Cobros** (totales Cobrado y Saldo, lista de cobros) y botón «Registrar cobro» | FR-007 |
| Diálogo «Registrar cobro» (Forma de pago, Cuenta de cobro, Importe) — **no está en el prototipo** | FR-007 |
| Campo «Cuenta de cobro» con chip Sin conciliar/Conciliado y enlace «Ir a Pagos →» | FR-008 |
| Texto «El transporte cobra al entregar. Queda en Transportes y contrarreembolsos…» | FR-008 |
| Título «Pagos», subtítulo «Conciliación de cobros: …» y filtro Tienda | FR-025 |
| Tarjetas Por conciliar, Conciliado y Saldo pendiente de clientes | FR-024, FR-025 |
| Filtro de cuentas (píldoras) e interruptor «Solo con saldo» | FR-023, FR-025 |
| Columnas Fecha, Tienda, Comprobante, Cliente, Cuenta de cobro, Importe, Aprobado por, Cobrado, Saldo | FR-023, FR-026 |
| Interruptor «Cobrado» por fila y avisos «Pago conciliado · N» / «Conciliación revertida · N» | FR-021, FR-026 |
| Vacío «Sin pagos para mostrar» y error con «Reintentar» | FR-026 |
| Paginación «1–N de N» | FR-023, FR-025 |
| Tarjeta «Cuentas de cobro» con «Ver todas las cuentas de cobro» y «Nueva cuenta» | FR-027 |
| Botón «Exportar» de Pagos y de Transportes | **FUERA DE ALCANCE** — la épica no pide exportar pagos ni contrarreembolsos |
| Pestañas «Faltantes» y «Devoluciones (RMA)» | **FUERA DE ALCANCE** — MSF-178 y otras épicas |
| Sub-pestaña «Motos», tabla de mensajería propia y tarjeta «Motos sin rendir» | **FUERA DE ALCANCE** — es de despacho (MSF-135) |
| Pestañas de navegación Comprobantes / Presupuestos | **FUERA DE ALCANCE** — son de MSF-159/MSF-177; se llega por el menú |
| Campos Guía, Fecha de envío, Armó, Controló, Entregó y transporte del despacho | **FUERA DE ALCANCE** — despacho: MSF-135 |
| Título «Transportes y contrarreembolsos», subtítulo, filtro Tienda y sub-pestañas | FR-046 |
| Ayuda «El transporte cobra al entregar y rinde después.» | FR-046 |
| Tarjetas «Contrarreembolsos pendientes» y «Cobrados este mes» | FR-045, FR-046 |
| Tabla de contrarreembolsos con chip Pendiente/Cobrado y botón «Marcar cobrado» | FR-047 |
| Sub-pestaña «Terminales de retiro», tabla y diálogo «Nueva empresa» | Ya entregado por MSF-139; esta épica solo lo conserva bajo la pestaña |
| **Empresa activa** | FR-009, FR-028, FR-048 |

## Permisos

| Acción | Sección | Quién | Qué habilita |
|---|---|---|---|
| Registrar un cobro | `registrar_cobro` de Ventas + `ventas` en edición | Mostrador, Administración, Administrador | «Registrar cobro» en el detalle de la factura. |
| Conciliar un pago | `conciliar_pago` de Ventas + `ventas` en edición | Administración, Administrador | Interruptor «Cobrado» de Pagos. |
| Cobrar un contrarreembolso | `cobrar_contrarreembolso` de Ventas + `ventas` en edición | Administración, Administrador | «Marcar cobrado» en Transportes. |
| Ver cobros, pagos y contrarreembolsos | `ventas` ≥ lectura | Quien tenga Ventas en lectura o edición en la tienda | Listados, tarjetas y detalle del comprobante. |

El permiso se resuelve con el **rol de la persona en la empresa del dato**, no con la suma de sus
roles: quien no puede cobrar en la tienda A no lo hereda por ser Administración en la B. Las tres
acciones viven en la matriz de permisos por organización × rol × sección y se corrigen por datos
(«Roles y permisos»).

Detalle de la matriz: [Permisos por rol](../permisos-por-rol.md).

## Límites y decisiones abiertas

- **La conciliación es manual**: se compara contra el extracto del banco **fuera del sistema**. No hay
  importación de extractos.
- **Los cobros son inmutables**: no se borran ni se editan. El **reverso de cobro** (corregir un cobro
  mal cargado) queda como ampliación no pedida.
- **Solo se concilian los pagos con cuenta de cobro**: un cobro en efectivo se registra y suma a lo
  cobrado, pero no aparece en Pagos (no hay nada que conciliar contra un banco).
- **Cobrado no depende de la conciliación**: el estado lo pone el saldo, no la aprobación.
- **La columna `guia` no existe en `comprobantes_venta`** (la épica lo daba por hecho): la guía vive
  en la tabla de contrarreembolsos y la leerá la guía de despacho de MSF-135 cuando exista.
- **Una cuenta de cobro marcada «No usar»** no recibe cobros nuevos, pero conserva su historial y
  sigue apareciendo en la tarjeta de Pagos.
- **Sin multimoneda**: los importes son en pesos; las cuentas de cobro de MSF-139 declaran moneda.
- **Riesgo de fecha del Hito 4**: con 184 h de Ventas la ventana del 30 de noviembre al 11 de
  diciembre no alcanza para las cuatro épicas; el documento del componente propone correr el cierre
  al 18 de diciembre. Ante conflicto de horas manda el *Roadmap a diciembre*.

## Fuera de alcance de esta épica

El botón **«Exportar»** de Pagos y de Transportes; la sub-pestaña **«Motos»** (mensajería propia);
el **vencimiento por plazo de rendición** y la **comisión del transporte** (datos de MSF-139 sin
uso); el **cobro sobre presupuestos**; la **importación de extractos bancarios**; las pestañas
**Faltantes** y **Devoluciones (RMA)**; y los campos de despacho (Guía, Fecha de envío, Armó,
Controló, Entregó).

## Estado

Implementado en la rama de la épica con sus tres historias y el cierre (F-VTA-12 · MSF-389, F-VTA-13 ·
MSF-401, F-VTA-14 · MSF-410), **pendiente de merge a `main`**. La fuente funcional es
`specs/20261024-150000-ventas-cobros-y-conciliacion/spec.md`; las pruebas están en
`supabase/tests/database/cobros_comprobante.test.sql`, `pagos_conciliacion.test.sql`,
`contrarreembolsos.test.sql` y `datos_prueba_ventas_cobros.test.sql`, y en
`apps/web/src/pages/ventas/comprobante.cobros.test.tsx`, `apps/web/src/pages/ventas/pagos/list.test.tsx`
y `apps/web/src/pages/ventas/transportes/contrarreembolsos.test.tsx`.

## Para seguir

- **[Ventas · cobros y conciliación (técnico)](../tecnico/ventas-cobros-y-conciliacion.md)** — tablas,
  RPC, flujos, permisos y reversión.
- **[Ventas · listado, estados y anulación (producto)](ventas-listado-estados-y-anulacion.md)** — el
  listado y los estados del comprobante, incluido quién pone Cobrado y Deuda.
- **[Permisos por rol](../permisos-por-rol.md)** — secciones, niveles y acciones.
