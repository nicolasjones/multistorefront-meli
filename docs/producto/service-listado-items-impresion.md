---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Service técnico: listado, ítems e impresión (MSF-199)

Épica **MSF-199 · Service técnico: Service listado ítems e impresión**. Historias: **F-SVC-04** (listado con
filtros por período), **F-SVC-06** (ítems y costos) y **F-SVC-07** (impresión de orden de ingreso y remito).
Spec: `specs/20261022-100000-service-listado-items-e-impresion/spec.md`. Implementación en la rama
`epic/MSF-199-service-tecnico-service-listado-items-e-` (merge `c8d9930`, PR #258), **pendiente de merge a
`main`** al momento de esta página. Detalle técnico:
[Service técnico: listado, ítems e impresión](../tecnico/service-listado-items-impresion.md).

Esta entrega completa el Service técnico de MSF-182: la reparación ya se podía dar de alta, cambiar de estado
y entregar; ahora también se encuentra en un listado, se le cargan la mano de obra y los repuestos con totales,
y se imprimen los papeles que recibe el cliente.

## Qué resuelve y para quién

| Persona | Qué puede hacer |
|---|---|
| **Técnico / mostrador** | Encontrar cualquier reparación por período, N.º de serie o técnico; cargar mano de obra y repuestos; imprimir la orden de ingreso y el remito. |
| **Administración** | Ver el total al cliente listo para copiar a Ventas y, con `ver_costos`, la ganancia estimada. |
| **Consulta** | Ver el listado y el detalle, e imprimir ambos documentos, sin editar ítems ni reparaciones. |

El listado respeta la **empresa activa** de la barra superior: con una tienda elegida muestra solo sus
reparaciones; con «todas mis empresas», todas las accesibles. No hay chips de tienda dentro de la pantalla.

## Listado de reparaciones

`/service-tecnico/reparaciones` muestra una tabla en escritorio y tarjetas en móvil con nueve columnas:
**Reparación** (`R-0238` e «Ingreso dd/mm», con enlace al detalle), **Tienda**, **Cliente**, **Equipo** (con
el modelo debajo), **N.º de serie**, **Estado** (chip), **Técnico** (nombre visible, nunca el correo),
**Entrega** (prevista) y **Total** (total al cliente).

- **Período** Hoy / Semana / Mes (por defecto Mes) sobre la **fecha de entrega prevista**; el subtítulo
  aclara «Según la fecha de entrega prevista (hoy: dd/mm/aaaa)».
- **N.º de serie** con coincidencia parcial e independiente del período, para encontrar cualquier reparación.
- **Técnico**, con los técnicos elegibles de Service.
- Paginación en el servidor, de 25 reparaciones por página, de la más reciente a la más antigua.
- Estados: carga, error con «Reintentar», vacío «No hay reparaciones en este período» y, buscando por serie,
  «No hay reparaciones con ese número de serie».
- Una reparación sin ítems muestra **«A presupuestar»** en Total; los datos ausentes (serie, técnico, entrega)
  se muestran «—».
- Con `service_tecnico` en **lectura** el listado se ve completo, pero no el botón «Nueva reparación».

## Ítems y costos de la reparación

En el detalle de la reparación, la sección **«Mano de obra y repuestos»** separa las dos tablas y muestra
**Subtotal mano de obra**, **Subtotal repuestos**, **Mano de obra / Repuestos / Total al cliente**. El total
al cliente se puede seleccionar para copiarlo: el cobro se carga a mano en Ventas hasta que llegue F-SVC-13.

- **Agregar mano de obra**: Concepto en texto libre, Precio y Cantidad, con «Subtotal:» en vivo.
- **Agregar repuesto**: se puede buscar un producto del catálogo por Nombre o SKU (solo activos de la
  organización) o cargarlo como **repuesto libre** con su descripción. El precio no se precarga y se escribe
  en ARS.
- Cantidad o precio inválidos muestran el error en el campo y no se guarda.
- Un ítem cargado por error se puede **quitar** con confirmación; los totales se recalculan. No hay edición de
  un ítem: se quita y se vuelve a cargar.
- Las reparaciones **entregadas o anuladas** y los usuarios con **lectura** ven la sección completa pero sin
  acciones; la base también rechaza la carga.
- Con la acción **`ver_costos`** se ve la **Ganancia estimada** (Total al cliente − costo interno) junto a la
  tarjeta «Costo interno»; sin esa acción no se muestra ni llega al navegador.
- Los **ítems P0 no mueven stock**: el descuento de repuestos del depósito es de MSF-217.
- Los importes son **ARS sin IVA**. No es el costo interno de MSF-182.

## Impresión de orden de ingreso y remito

Desde el detalle, **«Imprimir orden»** abre la vista A4 de la **orden de ingreso** para cualquier reparación;
**«Imprimir remito»** abre el **remito de entrega** solo si la reparación está entregada y no anulada.

- **Orden de ingreso**: tienda (nombre y datos de contacto cargados), número `R-000N`, fecha de ingreso,
  cliente y contacto, equipo, N.º de serie, accesorios, falla informada, técnico, entrega prevista y el bloque
  de condiciones. **No muestra importes.**
- **Remito**: los mismos datos, las tablas de mano de obra y repuestos con subtotales, el **total sin IVA**, la
  fecha de entrega y quién entregó. Sin ítems muestra «Sin ítems».
- Se imprimen desde el navegador (diálogo de impresión), en A4 y sin menús ni botones, rotulados
  **«Documento no fiscal»** e **«Importes sin IVA»**.
- Ningún documento contiene costos internos ni ganancia, tenga o no `ver_costos` quien imprime.
- Con `service_tecnico` en **lectura** se pueden imprimir ambos documentos.

## Límites y fuera de alcance

| Tema | Estado |
|---|---|
| KPIs «En reparación / Listas para entregar / Esperando repuesto» | Fuera de alcance: MSF-124 (seguimiento y reportes). |
| Descuento de repuestos del depósito y existencias | Fuera de alcance: MSF-217 (repuestos y stock). Los ítems P0 no mueven stock. |
| Avisos al cliente («Avisar al cliente») | Fuera de alcance: MSF-232 (cobro y avisos). Solo se guarda el indicador de los estados. |
| Catálogo de servicios de mano de obra (`ServicioCatalogo`) | Fuera de alcance: ninguna historia de la épica lo pide; el concepto se escribe a mano. |
| Edición de un ítem ya cargado | Fuera de alcance: se quita y se vuelve a cargar. |
| Corrección de un remito ya emitido | Fuera de alcance: la reparación entregada queda cerrada. |
| PDF generado en el servidor o impresión fiscal | No existe: la impresión es A4 desde el navegador y los documentos no son fiscales. |
| Reutilizar la impresión de Ventas (MSF-213) | No había mecanismo reutilizable al construir la épica; Service arma su vista A4 propia. |
| CUIT y domicilio fiscal de la empresa | No existen hoy en `dominio.empresas`: no se imprimen ni se inventan. |
| Datos de la empresa en la orden | Solo los cargados (nombre, dirección, WhatsApp y correo); lo que falta se omite. |

## Pendientes con dueño

- **Texto de condiciones de la orden de ingreso**: provisorio («Condiciones del servicio: pendiente de
  confirmar»); lo debe validar el negocio antes de usar la orden con clientes. Dueño: Producto / negocio.
- **Datos fiscales por empresa (CUIT, domicilio fiscal)**: no existen en el modelo; si se necesitan en los
  documentos, los tiene que definir Producto y agregar una migración en otra épica.
- **Vencidas**: hoy no tienen un período propio en el listado; si el taller las necesita, es una historia
  aparte.
- **Stock y avisos**: los cubren MSF-217 y MSF-232.
