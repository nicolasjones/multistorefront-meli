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
- **Perfil y permisos avanzados (MSF-148):** cada persona edita su nombre, apellido y foto y cambia su contraseña pidiendo la actual; quien no tiene acceso a una sección puede pedir acceso desde la pantalla restringida, con un pedido por persona, sección y día y un aviso por correo al administrador. Detalle: [Perfil propio](perfil-propio.md) · [Solicitar acceso](../solicitar-acceso.md).
- **Aislamiento:** cada persona solo ve los datos de su organización; una prueba automática falla si una tabla nueva queda sin protección.
- **Límites:** un usuario pertenece a una sola organización; los valores de bloqueo, enlaces y sesión son supuestos a confirmar con el cliente. En MSF-148 no hay bandeja de solicitudes: aprobar el pedido sigue siendo una acción de Administrador en Usuarios y permisos. Detalle: [Acceso](../acceso-ingreso.md).
- **Estado:** base implementada (MSF-121/125/138) y perfil/permisos avanzados implementados (MSF-148, merge PR #110).
- **Alta de organizaciones (MSF-162):** solo el superadmin de la plataforma crea organizaciones nuevas (nombre + correo del fundador); el fundador recibe una invitación y queda como administrador de su organización, aislada de las demás. Sin autoservicio ni facturación propia. Detalle: [Alta de organizaciones](../alta-de-organizaciones.md).
- **Aislamiento:** cada persona solo ve los datos de su organización; una prueba automática falla si una tabla nueva queda sin protección.
- **Límites:** un usuario pertenece a una sola organización; los valores de bloqueo, enlaces y sesión son supuestos a confirmar con el cliente. Detalle: [Acceso](../acceso-ingreso.md).
- **Estado:** base implementada (MSF-121/125/138/162).

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
- **Página de inicio (MSF-191):** banner, categorías con «N productos», destacados con precio final y
  disponibilidad, y «Catálogo en preparación» cuando la tienda no tiene productos visibles.
- **Búsqueda de productos (MSF-191):** campo en el encabezado con hasta 6 sugerencias mientras se escribe,
  tolerante a tildes, mayúsculas y errores de tipeo; los resultados reutilizan el catálogo en
  `/catalogo?q=…`; límite de pedidos por visitante y minuto.
- **Versión móvil completa (MSF-191):** menú desplegable, panel de filtros con «Precio máximo», ficha en
  una columna y error con reintento, verificado de 360 a 1024 px. Detalle:
  [Tiendas online](tiendas-online.md) y [técnico](../tecnico/tienda-inicio-busqueda-movil.md).
- **Límites:** buscador externo o por SKU/descripción (MSF-191), WhatsApp y contacto (MSF-212), compra y
  carrito (MSF-176), «Productos relacionados», slugs de categoría y subcategorías agregadas. El rendimiento
  en celular todavía no se midió (seguimientos MSF-552 y MSF-560).
- **Estado:** implementado en las épicas (MSF-147, PR #260; MSF-167, PR #317; MSF-191, PR #349); pendiente
  de merge a `main`. La base (dominio, identidad, catálogo visible) es de MSF-147. Detalle:
  [Tiendas online: catálogo y ficha](tiendas-online.md).

## Clientes y proveedores

**Qué resuelve:** una ficha única de cliente/proveedor, compartida por las tiendas, con búsqueda, historial de compras y exportación.

- **Clientes (MSF-180):** alta y edición con número correlativo y DNI/CUIT único por organización,
  listado con búsqueda, filtros y paginación en el servidor, archivado/restaurado (no se borra),
  tipo minorista/mayorista, un **Consumidor final** por organización para el mostrador y exportación a
  Excel. Detalle: [Clientes](../clientes.md).
- **Cuenta web del cliente (MSF-237):** invitación desde el panel, estados Activa/Suspendida/Sin cuenta/No
  habilitado, ingreso y recuperación en la tienda y precios por tipo; la cuenta no es un usuario del panel
  y no hay auto-registro. Detalle: [Cuenta web del cliente](cuenta-web-cliente.md).
- Historial de compras y ranking por facturación; historial y favoritos de la cuenta quedan en F-CLI-20
  (MSF-450, P3).
- **Proveedores (MSF-205):** alta y edición con CUIT validado y contacto, listado con búsqueda y filtro de
  estado, y proveedor principal + código del proveedor en cada producto; la ficha del proveedor lista sus
  productos. Quien registra mercadería lo elige por un selector mínimo, sin ver CUIT ni contacto. Detalle:
  [Proveedores](../proveedores.md).
- **Migración inicial de datos (MSF-142):** carga de clientes y proveedores del panel anterior por
  identificador externo, vínculos proveedor ↔ producto, archivo de solo lectura del historial de
  ingresos y ensayo/conciliación con plan de corte. Solo Administrador; los datos reales se cargan en
  producción. Detalle: [Migración inicial de datos](migracion-inicial-de-datos.md).
- **Estado:** base implementada (MSF-180/205/126); la cuenta web está en la rama de MSF-237, pendiente de
  merge a `main`, y la migración inicial (MSF-142) en la de su épica.

## Stock

**Qué resuelve:** saber cuánto hay, dónde y por qué cambió.

- Existencias por depósito; stock único y alertas.
- Ingresos, egresos y ajustes con historial inmutable.
- **Ingreso de mercadería por proveedor** con fecha, comprobante, costo unitario USD e historial filtrable;
  un ingreso se anula con motivo y el stock vuelve (MSF-219).
- Movimientos y reservas; cola de eventos.
- **Carga en lote (MSF-131 · F-STK-10):** un remito completo con varios productos bajo un mismo número de lote,
  todo o nada e idempotente, con historial de lotes y detalle de movimientos.
- **Toma de inventario (MSF-131 · F-STK-11):** conteo por categoría que muestra la diferencia y la corrige con ajustes
  con motivo «Toma de inventario», sin editar el historial.
- **Estado:** base implementada (MSF-136/231/292); lotes e inventario implementados en la rama de la épica MSF-131,
  pendientes de merge. Detalle: [lotes e inventario](stock-lotes-e-inventario.md).
- **Estado:** base implementada (MSF-136/231/292; ingreso por proveedor en la rama de MSF-219).

## Ventas y despacho

**Qué resuelve:** emitir comprobantes, cobrar, despachar y anular con trazabilidad.

- **Comprobantes internos (MSF-159):** factura y presupuesto por tienda, con numeración correlativa,
  cliente o Consumidor final, líneas con precio por escala (`x1`/`x5`/`x10`/`x50`), depósito de salida y
  stock disponible. Al confirmar la factura, el stock baja del depósito de cada línea; los productos «A
  pedido» reservan y el presupuesto no mueve stock. Presupuestos: listar, aceptar, copiar y modificar.
  Detalle: [Ventas · comprobantes](ventas-comprobantes.md).
- Cobros, cuentas de cobro y estados.
- Listado, anulación, despacho, faltantes y transportes.
- Historial del panel anterior (solo consulta).
- **Estado:** comprobantes y presupuestos implementados en la rama de la épica (MSF-159; historias
  MSF-273/295/317/331), pendiente de merge a `main`. Listado, anulación, cobro y despacho siguen en
  construcción (MSF-177/195); historial MSF-275.

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
- **Aviso por correo (MSF-122 + MSF-189):** cada consulta nueva avisa a las personas de la empresa con
  acceso a Consultas que no lo hayan apagado; el aviso es **configurable por persona** y los repetidos
  llegan **agrupados** en 15 minutos. Si el envío falla, la consulta igual queda registrada y el aviso se
  reintenta con un tope. Detalle: [Avisos por correo y listas configurables](avisos-y-listas.md).
- **Empresa activa y permisos:** la bandeja respeta la empresa de la barra superior y los permisos por
  empresa: `edicion` asigna, anota y cambia estado; `lectura` solo ve; `ninguno` no accede.
- **Límites:** el formulario de la tienda, el botón de WhatsApp y el anti-spam son de Tiendas online
  (MSF-212); la lista de estados de consulta se administra (MSF-189) pero **todavía no gobierna la
  bandeja**, que usa los tres estados fijos; la retención de consultas y datos personales está pendiente.
  Detalle: [Consultas de las tiendas](consultas.md).
- Consultas con seguimiento y respuestas rápidas (MSF-130) y Mercado Libre (conexión de cuentas,
  publicaciones, precios y stock por canal) siguen especificados / en construcción (MSF-129/143/175, entre
  otras).
- **Estado:** bandeja y aviso implementados en la rama de la épica (MSF-186/207; spec
  `20261023-120000-consultas-bandeja-y-aviso`); el aviso configurable y agrupado se suma en MSF-189.
  Pendiente de merge a `main`.

## Avisos y listas configurables

**Qué resuelve:** que cada persona elija qué avisos recibe por correo y que el Administrador adapte las
listas del negocio sin tocar código.

- **Avisos por correo (MSF-189):** un interruptor por tipo de aviso de las secciones a las que la persona
  tiene acceso, en **Cuenta → Avisos por correo**. Sin preferencia guardada, el tipo está encendido. Los
  avisos de seguridad de la cuenta no se pueden apagar.
- **Agrupación (MSF-189):** los avisos del mismo tipo para la misma persona en 15 minutos llegan en un solo
  correo con la cantidad y el detalle. La ventana es una propuesta a confirmar con el cliente.
- **Listas configurables (MSF-189):** **Administración → Listas configurables**, solo Administrador, con
  **Motivos de stock** (la misma lista de Stock) y **Estados de consulta** (alta, renombre y
  activar/desactivar; no se borran).
- **Límites:** la campanita es de MSF-224; reordenar o borrar ítems queda fuera; las preferencias son por
  persona (no por empresa); el proveedor de correo de negocio sigue sin definir; la lista de estados de
  consulta todavía no alimenta la bandeja. Detalle:
  [Avisos por correo y listas configurables](avisos-y-listas.md).
- **Estado:** implementado en la rama de la épica MSF-189, pendiente de merge a `main`.

## Inicio, reportes y rentabilidad

**Qué resuelve:** ver el estado del negocio sin armar planillas.

- **Rentabilidad (MSF-120):** pantalla `/rentabilidad` (menú Análisis) con margen por producto y tienda sobre
  el precio sin IVA. Tiene **Resumen** (tarjetas por empresa, Consolidado, aviso de productos de margen bajo o
  negativo, «Cómo se calcula») y **Por producto** (tabla con filtros de estado y canal, búsqueda y contador).
  El **umbral de margen bajo** (10 % por defecto) lo edita solo el Administrador y deja evento en Actividad.
  La calcula la base en vistas del esquema `analitica` y la muestran tableros de Superset embebidos.
  - **Límites:** sin Mercado Libre (Etapa 2), sin impuestos, envíos ni otros costos; el consolidado pondera
    una unidad de cada producto; no depende de la empresa activa porque compara todas las empresas.
  - **Estado:** implementado en la rama de la épica (spec `rentabilidad-margen`), pendiente de merge a
    `main`. Detalle: [Rentabilidad](rentabilidad.md).
- Inicio con alertas y avisos, reportes de ventas e inventario, analítica avanzada y resumen por correo.
- **Estado del resto:** especificado / en construcción.

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
