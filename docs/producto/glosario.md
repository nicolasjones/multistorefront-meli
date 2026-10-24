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
| **Reparación** | Equipo recibido en Service técnico, con modelo, cliente, N.º de serie, estado y técnico. Se numera por empresa (`R-0001`). |
| **Modelo de equipo** | Catálogo de equipos que el taller repara (equipo, modelo, mano de obra base). Es por organización. |
| **Estado de reparación** | Paso configurable del flujo (orden, «Qué significa», si avisa al cliente, si cierra). Un estado que cierra se alcanza solo con la entrega. |
| **Anulación** | Marca irreversible de una reparación, con motivo; queda de solo lectura. |
| **Estado** | Situación de una reparación (por ejemplo, Pendiente, Reparada, Retirada). Algunos estados registran entrega. |
| **Entrega** | Acto de devolver el equipo al cliente; guarda fecha y responsable. |
| **Historial** | Datos del panel anterior, importados una sola vez a tablas de archivo. Solo lectura; no afecta stock, saldos ni estados. |
| **Actividad** | Registro de eventos importantes (quién hizo qué y cuándo). |
| **Empresa activa** | La tienda con la que se está trabajando; define el rol y los datos en las secciones por empresa. |
| **Consulta** | Mensaje que un visitante envía desde una tienda por el formulario de contacto o por WhatsApp (MSF-122). |
| **Bandeja de consultas** | Listado del panel donde el equipo ve y atiende las consultas de sus empresas. Es solo un registro: no responde al visitante. |
| **Aviso de consulta** | Correo que recibe la empresa cuando entra una consulta nueva, con un enlace para abrirla en el panel. |
| **Precio neto** | Precio de la tienda sin IVA. Es la base sobre la que se calcula el margen. |
| **Margen** | Lo que queda después de restar el costo y la comisión al precio neto: `margen = precio neto − costo − comisión`. En esta versión la comisión de las tiendas es 0. |
| **Margen %** | El margen expresado como porcentaje del precio neto: `margen ÷ precio neto`. |
| **Margen bajo** | Producto cuyo margen % está entre 0 y el umbral de la organización, sin incluirlo. |
| **Margen negativo** | Producto que se vende por debajo del costo: margen % menor a 0. |
| **Umbral de margen bajo** | Porcentaje a partir del cual un producto deja de considerarse «bajo». Es por organización, 10 % por defecto, y lo edita solo el Administrador (MSF-120). |
| **Consolidado** | Resumen de toda la organización que pondera una unidad de cada producto y tienda: suma de márgenes ÷ suma de precios netos. |
