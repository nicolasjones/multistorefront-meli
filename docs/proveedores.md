---
owner: producto
sources:
  - specs
  - apps/web/src
---

# Proveedores (MSF-205)

**Épica:** MSF-205 · **Historias:** F-PRV-01 (MSF-336), F-PRV-02 (MSF-351) y F-PRV-03 (MSF-367).
**Spec:** `specs/20261018-190000-proveedores-y-productos/`.
**Construcción interna:** [Proveedores: modelo, RPC y pantallas](tecnico/proveedores.md).

La organización guarda sus proveedores con CUIT y contacto, los busca desde el panel y asigna a cada
producto el proveedor que lo abastece. Es la base del ingreso de mercadería (MSF-219) y de los reportes
de reposición.

## Qué resuelve

- Antes no había una lista propia de proveedores ni forma de saber quién abastece cada producto.
- Ahora cada proveedor tiene una ficha con **razón social**, **CUIT**, persona de contacto, correo,
  teléfono, dirección y observaciones, y se puede **desactivar** sin perder sus datos.
- El listado permite encontrar un proveedor entre unos 135 por razón social o CUIT, incluso si está
  desactivado.
- Cada producto guarda **un proveedor principal** y el **código con que ese proveedor lo conoce**; la
  ficha del proveedor muestra los productos que abastece.
- Quien registra mercadería elige el proveedor por un selector mínimo (solo razón social), sin ver CUIT
  ni contacto.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Administrador/a y Administración** (`edicion` en Proveedores) | Crear, editar, desactivar y reactivar proveedores; ver la ficha y sus productos |
| **Con `lectura` en Proveedores** | Ver el listado y la ficha, sin acciones de alta, edición ni estado |
| **Operador** (`edicion` en Productos, `ninguno` en Proveedores) | Elegir proveedor y cargar el código del proveedor en el producto; no ve CUIT ni contacto |
| **Depósito** (registra ingresos) | Elegir proveedor por la vista mínima al ingresar mercadería (MSF-219); no ve CUIT ni contacto |
| **Mostrador, Consulta y demás roles sin Proveedores** | No ven la sección ni reciben filas de la tabla por la API |

La base vuelve a validar el permiso: ocultar botones es comodidad, no la autorización.
Detalle por rol: [Permisos por rol](permisos-por-rol.md).

**Empresa activa: no aplica.** El proveedor pertenece a la **organización** y se comparte entre sus
empresas; no hay columna de empresa ni filtro por empresa activa. Cambiar de empresa no recarga el
listado ni cierra diálogos por ese motivo (los diálogos siguen el ciclo normal de guardado).

## Cómo se usa

### Listado y búsqueda

La sección **Proveedores** vive en `/proveedores`, dentro del grupo **Clientes y proveedores** del menú.
Muestra las columnas **Razón social**, **CUIT**, **Correo** y **Teléfono**, ordenadas por razón social.

- **Buscar por razón social o CUIT:** filtra en el servidor por coincidencia parcial, sin distinguir
  mayúsculas ni tildes; el CUIT se encuentra con o sin guiones.
- **Estado:** por defecto solo se ven los **activos**; el filtro permite ver **Inactivos** o **Todos**
  para reactivar uno.
- **Paginación** de 25 por página, conservando búsqueda y filtro.
- **Nuevo proveedor** (solo con `edicion`) abre el diálogo de alta; **Ver ficha** abre la ficha.
- Estados: «Sin resultados», vacío inicial con la invitación a crear el primero, carga y error con
  **Reintentar**.

### Alta y edición

El diálogo pide **Razón social** y **CUIT** (obligatorios), más persona de contacto, correo, teléfono,
dirección y observaciones. El CUIT:

- se acepta con guiones, puntos o espacios y se guarda solo con dígitos;
- debe tener 11 dígitos y dígito verificador válido;
- se muestra como `XX-XXXXXXXX-X`;
- es **único por organización**, también entre proveedores desactivados.

Un CUIT repetido, un correo con formato inválido o una edición simultánea muestran un mensaje claro
junto al campo o sobre el diálogo, sin identificadores técnicos. Si otra persona modificó el proveedor
mientras lo editabas, se avisa del conflicto y no se pisa su cambio.

### Ficha, desactivar y reactivar

La ficha (`/proveedores/show/:id`) muestra todos los datos, el estado y la sección **Productos** con
**Producto**, **Código del proveedor** y **Ver producto**, paginada de 10 en 10.

- **Editar** abre el mismo diálogo con los datos cargados.
- **Desactivar** pide confirmación: el proveedor queda archivado, **no se elige en nuevos ingresos ni
  productos**, conserva sus datos y sus productos asignados, y se puede **Reactivar**.
- **No existe «Eliminar»**. El prototipo lo dibuja, pero manda el requisito: se desactiva, no se borra.
- Cada alta, edición, desactivación y reactivación queda en **Actividad** con quién, cuándo y qué
  proveedor (por razón social), sin CUIT ni identificadores internos.

### Proveedor en el producto

En el alta y la edición de producto hay dos campos opcionales:

- **Proveedor:** selector con búsqueda por razón social; solo ofrece proveedores activos para nuevas
  asignaciones.
- **Código del proveedor:** texto libre de hasta 80 caracteres; no se puede cargar sin proveedor.

Si se quita el proveedor, también se borra el código. Un producto ya asignado a un proveedor que luego
se desactiva **conserva la asignación** y se sigue mostrando; el proveedor desactivado no se ofrece para
nuevas asignaciones.

## Fuera de alcance

El prototipo muestra más de lo que esta épica entrega. Queda **fuera de alcance** y trazado como
seguimiento en Jira: condiciones de compra (condición de pago, moneda, plazo de entrega, compra mínima;
MSF-523), «Compra para» por tienda (MSF-524), «Enviar correo a proveedor» (MSF-525), importar y exportar
proveedores (MSF-526), N.º correlativo (MSF-527), Último ingreso y Costo en la ficha (MSF-528, dependen
de MSF-219/MSF-179), código de barras (MSF-529) y varios proveedores por producto (MSF-530).

El **costo del producto** vive en Catálogo y Precios (MSF-179), no en esta épica. El **ingreso de
mercadería** y los **reportes de reposición** son MSF-219 y siguientes: esta épica solo deja el contrato
de datos (`productos.proveedor_id` y `productos.codigo_proveedor`) y la vista mínima para elegir.

## Para seguir

- **[Catálogo de productos](catalogo.md)** — alta y edición del producto, donde se elige el proveedor.
- **[Ingreso de mercadería por proveedor](producto/ingreso-de-mercaderia.md)** — consumo del proveedor.
- **[Actividad e historial](actividad.md)** — eventos `proveedor.*`.
- **[Permisos por rol](permisos-por-rol.md)** — sección `proveedores` de la matriz.
