---
owner: producto
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

## Precios, dólar e IVA

**Qué resuelve:** definir el precio de lista en pesos o dólares, la regla de cada empresa, el IVA y la
cotización del dólar con la que se convierten los precios en dólares.

- **Precio y costo en pesos o dólares** (MSF-114): precio de lista y costo con margen, regla de precio por
  empresa, IVA por categoría con interruptor «Con/Sin IVA», escalas x1/x5/x10/x50 y el contrato
  `precio_para` para Ventas.
- **Dólar y recálculo (MSF-116):** el administrador carga el dólar del día a mano, ve la vista previa de
  qué precios cambian **por empresa**, confirma y todos los precios en dólares se recalculan juntos
  (umbral fijo de 1 %: por debajo la cotización se registra pero no cambia precios), con historial
  inmutable y aviso cuando hoy no se cargó. Detalle: [Precios y dólar](precios-dolar.md).
- **Precios de la tienda por tipo de cliente (MSF-237):** el cliente con cuenta web activa ve su escala:
  minorista x1; mayorista x1/x5/x10/x50 en la ficha, con la regla de la empresa y su interruptor de IVA.
  Detalle: [Cuenta web del cliente](cuenta-web-cliente.md).
- **Límites:** la configuración del alcance, umbral, redondeo y aviso (F-PRE-06) y las publicaciones de
  Mercado Libre en el historial son Etapa 2; el historial importado del panel anterior es otra pantalla
  (MSF-275). Decisiones abiertas anotadas en [Precios y dólar](precios-dolar.md#límites-y-fuera-de-alcance).
- **Estado:** implementado en las ramas de las épicas (MSF-114, PR #281; MSF-116, merge `872f09a`, PR
  #304), pendiente de merge a `main`. Detalle técnico:
  [Dólar y recálculo](../tecnico/dolar-y-recalculo.md).

## Tiendas online

**Qué resuelve:** la vidriera pública de cada empresa, con acceso opcional de clientes que tengan cuenta
web: catálogo navegable, ficha y disponibilidad, con el precio final de esa empresa (o el de la escala
del cliente) y sin datos internos.

- **Dominio, identidad y vidriera (MSF-147):** cada empresa tiene una tienda en su dominio, con acceso
  anónimo seguro; el administrador define colores, tipografías, logo y banners, escribe los textos
  comerciales y elige qué categorías y productos se muestran y se destacan. Detalle:
  [Tienda online: dominio, identidad y vidriera](tienda-dominio-e-identidad.md).
- **Navegación por categorías** (MSF-167): menú y pie con las categorías visibles de la tienda, página de
  categoría con migas y una 404 amable para lo que no existe o no se publica.
- **Catálogo con filtros y orden** (MSF-167): «Solo con stock», precio máximo, tres órdenes, paginación de
  a 24 y URL compartible que restaura filtros, orden y página.
- **Ficha de producto** (MSF-167): galería ampliable, descripción, SKU, categoría, precio, compatibilidad
  opcional y «Ver más productos».
- **Disponibilidad visible** (MSF-167): solo «Disponible» / «Sin stock»; nunca cantidades ni «últimas
  unidades».
- **Cuenta web del cliente (MSF-237):** ingreso y recuperación de contraseña en el dominio de la tienda y
  precios según el tipo de cliente; la cuenta se crea por invitación desde Clientes. Detalle:
  [Cuenta web del cliente](cuenta-web-cliente.md).
- **Límites:** buscador, inicio y móvil dedicado (MSF-191); WhatsApp y contacto (MSF-212); compra y carrito
  (MSF-176); «Productos relacionados»; slugs de categoría y subcategorías agregadas. El rendimiento en
  celular todavía no se midió (seguimiento MSF-552).
- **Estado:** implementado en las épicas (MSF-147, PR #260; MSF-167, PR #317); pendiente de merge a
  `main`. La base (dominio, identidad, catálogo visible) es de MSF-147. Detalle:
  [Tiendas online: catálogo y ficha](tiendas-online.md).

## Clientes y proveedores

**Qué resuelve:** una ficha única de cliente/proveedor, compartida por las tiendas, con búsqueda, historial de compras y exportación.

- Alta y búsqueda de clientes; tipos y escalas.
- Empresas/tiendas asociadas a cada cliente.
- **Cuenta web del cliente (MSF-237):** invitación desde el panel, estados Activa/Suspendida/Sin cuenta/No
  habilitado, ingreso y recuperación en la tienda y precios por tipo; la cuenta no es un usuario del panel
  y no hay auto-registro. Detalle: [Cuenta web del cliente](cuenta-web-cliente.md).
- Historial de compras y ranking por facturación; historial y favoritos de la cuenta quedan en F-CLI-20
  (MSF-450, P3).
- Proveedores y productos de proveedor.
- **Estado:** base implementada (MSF-180/205/126); cuenta web en la rama de MSF-237, pendiente de merge a
  `main`.

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
- **Listado de reparaciones** con filtros por período (Hoy / Semana / Mes) sobre la entrega prevista, búsqueda por N.º de serie y filtro por técnico; paginado y acotado a la empresa activa. Incluye estado vacío «No hay reparaciones en este período» y «A presupuestar» cuando no hay ítems.
- **Ítems de mano de obra y repuestos** en el detalle, con subtotales y **Total al cliente** copiable; los repuestos pueden venir del catálogo (opcional) o ser libres. Los ítems no mueven stock.
- **Impresión A4** de la **orden de ingreso** (sin importes) y del **remito de entrega** (solo si la reparación está entregada y no anulada), rotulados «Documento no fiscal» e «Importes sin IVA», sin costos internos ni ganancia.
- **Costos internos** (mano de obra y repuestos, ARS sin IVA): solo los ve y edita quien tiene la acción `ver_costos`. Con esa acción también se ve la **Ganancia estimada** (Total al cliente − costo interno).
- **Rol Técnico**: edición solo en Service técnico, matriz fija en el lanzamiento (la matriz editable llega en enero).
- **Fuera de alcance** (otras historias): KPIs y seguimiento (MSF-124), descuento de repuestos del depósito (MSF-217), avisos reales al cliente (MSF-232), catálogo de servicios de mano de obra (`ServicioCatalogo`), edición de un ítem ya cargado (se quita y se vuelve a cargar), corrección de un remito emitido y datos fiscales (CUIT/domicilio) en los documentos.
- **Estado:** MSF-182 y MSF-199 implementadas en las ramas de sus épicas; pendientes de merge a `main` (MSF-254, MSF-283, MSF-303, MSF-324; MSF-342/362/379/538; specs `20261020-100000-service-alta-estados-y-permisos` y `20261022-100000-service-listado-items-e-impresion`). Detalle de producto: [Service técnico: listado, ítems e impresión](service-listado-items-impresion.md).

## Consultas y Mercado Libre

**Qué resuelve:** atender las consultas que llegan desde las tiendas y publicar/actualizar en Mercado Libre.

- **Bandeja de consultas (MSF-122):** cada consulta del formulario o del botón de WhatsApp de una tienda
  queda registrada para su empresa. El equipo la ve en **Canales → Consultas** con contador de nuevas,
  búsqueda, filtros por tienda, estado y fecha, y un detalle con **Estado** (Nueva / En curso / Resuelta),
  **Responsable** y **Nota interna**. La bandeja es solo un registro: la respuesta se da por correo o
  WhatsApp fuera del panel y el estado lo cambia una persona.
- **Aviso por correo (MSF-122):** cada consulta nueva dispara un correo a la dirección de avisos de la
  empresa (editable en la ficha, pestaña General; si no, el correo de contacto) con un enlace a la consulta.
  Si el envío falla, la consulta igual queda registrada y el aviso se reintenta con un tope.
- **Empresa activa y permisos:** la bandeja respeta la empresa de la barra superior y los permisos por
  empresa: `edicion` asigna, anota y cambia estado; `lectura` solo ve; `ninguno` no accede.
- **Límites:** el formulario de la tienda, el botón de WhatsApp y el anti-spam son de Tiendas online
  (MSF-212); los estados editables llegan con F-CFG-01; la retención de consultas y datos personales está
  pendiente. Detalle: [Consultas de las tiendas](consultas.md).
- Consultas con seguimiento y respuestas rápidas (MSF-130) y Mercado Libre (conexión de cuentas,
  publicaciones, precios y stock por canal) siguen especificados / en construcción (MSF-129/143/175, entre
  otras).
- **Estado:** bandeja y aviso implementados en la rama de la épica (MSF-186/207; spec
  `20261023-120000-consultas-bandeja-y-aviso`), pendiente de merge a `main`.

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
