---
sources:
  - specs
---

# Capacidades

MSF se construye por módulos. Esta página explica **qué resuelve cada uno**; el detalle técnico vive en la sección [Técnico](../tecnico/README.md).

!!! note "Estado"
    El producto está en construcción por hitos. “Base” significa que el módulo ya tiene cimientos en el repo; “en curso” que se está trabajando; “especificado” que está definido pero puede no estar implementado. No se listan como hechas cosas que no lo están.

## Acceso, organización y permisos

**Qué resuelve:** que cada persona entre con su cuenta, pertenezca a una organización y tenga el rol correcto en cada empresa y sección.

- Organización y empresas/tiendas.
- Usuarios, invitaciones y roles: Administrador, Operador, Mostrador, Depósito, Administración, Consulta.
- Permisos por sección y por empresa; empresa activa.
- Actividad: registro de acciones.
- **Ingreso y sesión (MSF-119):** ingreso con correo y contraseña con mensaje de error genérico y bloqueo de 15 min tras 5 intentos fallidos; recuperar/definir contraseña (12+ caracteres con mayúscula, minúscula, número y símbolo; enlaces de un solo uso que vencen a la hora); «Mantener la sesión iniciada»; «Cerrar sesión»; la sesión vence a las 12 h de inactividad (30 días si se mantuvo). Una persona suspendida no entra y se le corta la sesión abierta.
- **Aislamiento:** cada persona solo ve los datos de su organización; una prueba automática falla si una tabla nueva queda sin protección.
- **Límites:** un usuario pertenece a una sola organización; los valores de bloqueo, enlaces y sesión son supuestos a confirmar con el cliente. Detalle: [Acceso](../acceso-ingreso.md).
- **Estado:** base implementada (MSF-121/125/138).

## Catálogo

**Qué resuelve:** un catálogo único de productos, con categorías de hasta dos niveles, visibilidad por tienda y precios por empresa.

- Productos, SKU, imágenes, estados activo/inactivo.
- Categorías y subcategorías; orden y visibilidad por tienda.
- “Empresas que lo venden” por producto.
- **Estado:** en construcción (MSF-160/456/179).

## Clientes y proveedores

**Qué resuelve:** una ficha única de cliente/proveedor, compartida por las tiendas, con búsqueda, historial de compras y exportación.

- Alta y búsqueda de clientes; tipos y escalas.
- Empresas/tiendas asociadas a cada cliente.
- Historial de compras y ranking por facturación.
- Proveedores y productos de proveedor.
- **Estado:** base implementada (MSF-180/205/126).

## Stock

**Qué resuelve:** saber cuánto hay, dónde y por qué cambió.

- Existencias por depósito; stock único y alertas.
- Ingresos, egresos y ajustes con historial inmutable.
- Movimientos y reservas; cola de eventos.
- **Estado:** base implementada (MSF-136/231/292).

## Ventas y despacho

**Qué resuelve:** emitir comprobantes, cobrar, despachar y anular con trazabilidad.

- Comprobantes y presupuestos; precios por escala/tipo de cliente.
- Cobros, cuentas de cobro y estados.
- Listado, anulación, despacho, faltantes y transportes.
- Historial del panel anterior (solo consulta).
- **Estado:** en construcción (MSF-159/177/195; historial MSF-275).

## Service técnico

**Qué resuelve:** recibir un equipo, repararlo y entregarlo, con estados, historial y responsables.

- **Modelos y estados configurables** (por organización): el sembrado trae siete modelos y siete estados del panel actual; el octavo estado se define con el cliente y se agrega desde la pantalla. Se pueden crear, editar, reordenar (estados) y desactivar; al desactivar uno en uso se avisa con la cantidad de reparaciones.
- **Alta y edición de reparación** con cliente (búsqueda y alta rápida), equipo, N.º de serie opcional, accesorios, falla, técnico y fechas. La numeración (`R-0001`) es **por empresa**.
- **Cambio de estado con historial** (estado · fecha · usuario), **entrega** (fecha y quién entregó) y **anulación** con motivo (irreversible).
- **Costos internos** (mano de obra y repuestos, ARS sin IVA): solo los ve y edita quien tiene la acción `ver_costos`.
- **Rol Técnico**: edición solo en Service técnico, matriz fija en el lanzamiento (la matriz editable llega en enero).
- **Fuera de alcance** (MSF-199 u otra historia): listado con KPIs y filtros, ítems de mano de obra y repuestos, Total al cliente, «Imprimir orden», envío real de «Avisar al cliente» (solo se guarda el indicador), «Disponible en» por tienda y el catálogo de servicios (`ServicioCatalogo`).
- **Estado:** implementado en la rama de la épica; pendiente de merge a `main` (MSF-254, MSF-283, MSF-303, MSF-324; spec `20261020-100000-service-alta-estados-y-permisos`).

## Consultas y Mercado Libre

**Qué resuelve:** atender consultas de clientes y publicar/actualizar en Mercado Libre.

- Consultas, seguimiento y respuestas rápidas.
- Conexión de cuentas, publicaciones, precios y stock por canal.
- **Estado:** especificado / en construcción (MSF-123/129/143/175, entre otras).

## Inicio, reportes y rentabilidad

**Qué resuelve:** ver el estado del negocio sin armar planillas.

- Inicio con alertas y avisos.
- Reportes de ventas, inventario y rentabilidad.
- Analítica avanzada y resumen por correo.
- **Estado:** especificado / en construcción.

## Plataforma

**Qué resuelve:** lo transversal que hace que todo lo anterior funcione.

- Sistema de diseño (identidad del panel y mecanismo de tema por empresa para tiendas; ver [catálogo](../sistema-de-diseno.md)), panel operable, importaciones y monitoreo.
- Seguridad, backups, CI/CD y ambientes.
- **Estado:** base implementada.

## Roles (resumen)

| Rol | Alcance |
|---|---|
| Administrador | Toda la organización y todas las empresas |
| Operador | Edición en las secciones habilitadas de su empresa |
| Mostrador | Operación de local (ventas/consultas) |
| Depósito | Stock y depósitos |
| Administración | Cobros/administración |
| Consulta | Solo lectura |
| Técnico | Service técnico (edición; sin acceso al resto de las secciones). Matriz fija |

El detalle de qué puede hacer cada rol está en **[Permisos por rol](../permisos-por-rol.md)** y en la spec de permisos por empresa.
