---
owner: producto
sources: []
---

# Glosario de negocio

Términos que usa MSF en pantallas, reportes y conversaciones. La definición técnica está en la sección [Técnico](../tecnico/README.md).

| Término | Qué significa |
|---|---|
| **Organización** | La empresa dueña de los datos. Agrupa empresas/tiendas, usuarios y configuración. |
| **Empresa / Tienda** | Cada local o marca dentro de la organización (por ejemplo, San Javucho, Mundo JC). Se elige como **empresa activa** para trabajar. |
| **Sección** | Área del panel (Productos, Clientes, Ventas, Stock, etc.). Los permisos se definen por sección. |
| **Rol** | Conjunto de permisos de una persona. Puede ser distinto en cada empresa. |
| **Administrador** | Rol que ve y administra toda la organización y todas las empresas. |
| **Operador / Mostrador / Depósito / Administración / Consulta** | Roles operativos con distinto alcance por sección. |
| **Técnico** | Rol de Service técnico: ve y gestiona reparaciones. |
| **RLS** | Regla de la base que limita qué filas puede ver o modificar cada usuario. No es solo una restricción de pantalla. |
| **Comprobante** | Documento de venta (factura o presupuesto) con número, cliente, fecha, estado y total. |
| **Presupuesto** | Comprobante que no cuenta como venta hasta que se convierte/confirma. |
| **Cuenta de cobro** | Medio/cuenta por el que se cobra una venta. |
| **Depósito** | Ubicación física donde está el stock. |
| **Movimiento** | Entrada, salida o ajuste de stock; queda en un historial que no se edita. |
| **Lote de stock** | Remito de mercadería que entra: agrupa varias entradas de productos bajo un mismo número de lote. El proveedor es texto libre. |
| **Número de lote** | Correlativo que asigna el sistema por organización y comparten todos los movimientos del lote. No se escribe a mano. |
| **Toma de inventario** | Conteo de los productos de una categoría contra el stock del sistema. Las diferencias se corrigen con ajustes y el conteo no queda guardado como borrador. |
| **Ingreso de mercadería** | Compra recibida de un proveedor, con empresa, fecha, comprobante opcional y líneas de producto/cantidad/costo USD. Mueve el stock con una entrada por producto y se corrige anulándolo, no editándolo (MSF-219). |
| **Reparación** | Equipo recibido en Service técnico, con modelo, cliente, N.º de serie, estado y técnico. Se numera por empresa (`R-0001`). |
| **Ítem de reparación** | Mano de obra o repuesto que se le cobra al cliente por una reparación. Tiene cantidad, precio unitario y subtotal; el repuesto puede vincularse a un producto del catálogo o ser libre. No mueve stock (MSF-199). |
| **Total al cliente** | Suma de la mano de obra y los repuestos de una reparación, en ARS sin IVA. No es el costo interno; se copia a mano en Ventas hasta que exista el cobro integrado (MSF-199). |
| **A presupuestar** | Texto que muestra el listado cuando una reparación todavía no tiene ítems cargados y su total es cero (MSF-199). |
| **Orden de ingreso** | Documento A4 que se le da al cliente al dejar el equipo. Lleva los datos de la reparación y las condiciones, sin importes. No es fiscal (MSF-199). |
| **Remito de entrega** | Documento A4 que se le da al cliente al retirar el equipo entregado, con los ítems y el total sin IVA. No es fiscal (MSF-199). |
| **Documento no fiscal** | Rótulo de la orden de ingreso y del remito: no reemplazan una factura y los importes se muestran sin IVA (MSF-199). |
| **Modelo de equipo** | Catálogo de equipos que el taller repara (equipo, modelo, mano de obra base). Es por organización. |
| **Estado de reparación** | Paso configurable del flujo (orden, «Qué significa», si avisa al cliente, si cierra). Un estado que cierra se alcanza solo con la entrega. |
| **Anulación** | Marca irreversible de una reparación, con motivo; queda de solo lectura. |
| **Estado** | Situación de una reparación (por ejemplo, Pendiente, Reparada, Retirada). Algunos estados registran entrega. |
| **Entrega** | Acto de devolver el equipo al cliente; guarda fecha y responsable. |
| **Historial** | Datos del panel anterior, importados una sola vez a tablas de archivo. Solo lectura; no afecta stock, saldos ni estados. |
| **Actividad** | Registro de eventos importantes (quién hizo qué y cuándo). |
| **Empresa activa** | La tienda con la que se está trabajando; define el rol y los datos en las secciones por empresa. |
| **Cuenta web del cliente** | Acceso de un cliente a la tienda con su correo y contraseña, creado por invitación desde el panel. No es un usuario del panel y no habilita la compra en línea (MSF-237). |
| **Cliente minorista / mayorista** | Tipo de cliente que define la escala de precio en la tienda: minorista ve x1; mayorista ve las escalas por cantidad (MSF-180/MSF-237). |
| **Escala de precio** | Tramo de precio por cantidad (x1, x5, x10, x50) definido por la empresa. En la tienda, el mayorista con cuenta activa las ve en la ficha del producto (MSF-114/MSF-237). |
| **Consulta** | Mensaje que un visitante envía desde una tienda por el formulario de contacto o por WhatsApp (MSF-122). |
| **Bandeja de consultas** | Listado del panel donde el equipo ve y atiende las consultas de sus empresas. Es solo un registro: no responde al visitante. |
| **Aviso de consulta** | Correo que recibe cada persona con acceso a Consultas cuando entra una consulta nueva, con el detalle para reconocerla. Es configurable por persona y los repetidos se agrupan (MSF-189). |
| **Aviso por correo** | Mensaje que la plataforma envía a una persona cuando ocurre un hecho de una sección a la que tiene acceso. Cada persona elige qué tipos recibe en **Cuenta → Avisos por correo**; los de seguridad de la cuenta no se pueden apagar (MSF-189). |
| **Lista configurable** | Lista del negocio que el Administrador adapta sin tocar código: motivos de stock y estados de consulta. Los ítems se desactivan, no se borran (MSF-189). |
| **Estado de consulta** | Situación de una consulta en la bandeja. En esta entrega la bandeja usa **Nueva**, **En curso** y **Resuelta**; la lista administrable ya existe, pero todavía no gobierna la bandeja (MSF-122/MSF-189). |
| **Cotización del dólar** | Valor en pesos por dólar que se carga a mano una vez por día y se usa para calcular los precios de los productos en dólares. Es **una por organización** (MSF-116). |
| **Cotización pendiente** | Dólar cargado que todavía no se confirmó. No cambia precios y vence a las 24 h. |
| **Cotización vigente** | La última cotización confirmada o, si no hay ninguna, la cotización inicial de la organización. Es la referencia para medir la variación. |
| **Cotización aplicada** | La cotización con la que se calculan hoy los precios en dólares; se mueve al confirmar una variación que alcanza el umbral. |
| **Umbral de recálculo** | Variación mínima (1 %) para que una carga nueva recalcule los precios. Por debajo, la cotización se registra pero los precios no cambian. |
| **Variación inusual** | Aviso (no bloqueante) cuando la carga varía más del 15 % respecto de la anterior. |
