# Feature Specification: Lote 34 · interfaz, textos, roles y estados de pantalla

**Épica**: MSF-585 (hallazgos del dataset demo y del manual) · **Spec**: `lote-34-interfaz-textos-y-roles` · **Prioridad**: P3
**Alcance de entrega**: `refine` (sin SQL; sin `supabase`, `kestra`, `superset` ni `workers`).
**Estado**: implementada en el PR del lote. Reúne arreglos chicos de interfaz; cada ítem enlaza su criterio y su prueba.
**Fuente**: decisiones registradas como «Decisión tomada» en cada ticket (MSF-594, 609, 615, 617, 620, 633, 664, 701, 717, 718, 719, 783, 927), `docs/clientes.md`, `docs/stock.md`, `design/pantallas/`.

## Objetivo

Quitar textos de plantilla, alinear pantallas con el rol que las usa, mostrar importes y fechas de forma única y correcta, y cerrar estados de error que dejaban la pantalla en un estado engañoso.

## Criterios de aceptación

- CA-L34-1 (MSF-717): un único formateador de importes (`lib/formatoImporte.ts`): entero sin decimales, con centavos siempre dos decimales («$ 64.200,50»), punto de miles también en cuatro dígitos. Los formateadores de precios, promociones, historial, ranking, gastos, comprobantes y service lo usan.
- CA-L34-2 (MSF-718): cobros, pagos y contrarreembolsos muestran el día de calendario de Buenos Aires de la marca de tiempo (`fechaDeMarca`), sin el corrimiento UTC posterior a las 21:00.
- CA-L34-3 (MSF-615): una reparación entregada no ofrece «Anular» ni «Guardar».
- CA-L34-4 (MSF-617, 927): el panel de marca del ingreso muestra «Ingresá a tu panel» y «© 2026 · Gestión comercial», sin nombres de tiendas ni «Panel interno»; el título del documento y `index.html` no nombran la plantilla; `lang="es"` y meta description (MSF-695).
- CA-L34-5 (MSF-783): `/stock/motivos` exige administrador (`RequiereAdministrador`); la base ya limitaba la escritura a `puede_escribir()`.
- CA-L34-6 (MSF-633): `/empresas` y `/empresas/edit/:id` exigen acceso a la sección `empresas`.
- CA-L34-7 (MSF-620): el selector de «Toma de inventario» no sale vacío para Depósito; la política de lectura de `dominio.categorias` la trae el PR #1136 (dependencia de base).
- CA-L34-8 (MSF-719): la toma muestra el depósito principal sobre el que opera y ofrece «Sin categoría».
- CA-L34-9 (MSF-701): documento del cliente = DNI de 7 u 8 dígitos o CUIT con dígito verificador (solo si se modifica); CUIT de empresa con `validarCuit`; el chat IA devuelve el texto y retira el mensaje local si el envío falla, «Confirmar» se deshabilita mientras corre y el botón flotante solo lo ve quien puede escribir.
- CA-L34-10 (MSF-594): campo «Condición de IVA» en la ficha (selector de condiciones habituales + «Otra») y columna en el importador de clientes.
- CA-L34-11 (MSF-723): un costo ya cargado no se puede vaciar en la ficha del producto (la base lo leería como «sin cambio»): se pide 0.
- CA-L34-12 (MSF-635): la ausencia de foto de perfil (NoSuchKey) o una firma que falla se ve como inicial/sin foto, sin `console.error`.
- CA-L34-13 (MSF-686): `vencimientoSesion` tolera `localStorage` bloqueado.
- CA-L34-14 (MSF-616, 619): detalle de reparación de solo lectura sin «Todavía no cargaste…»; Recuperar acceso dice «Correo electrónico»; Mi perfil muestra el rol con su etiqueta; Mi organización muestra la zona horaria legible; las tarjetas de rol separan descripción y conteo.

- CA-L34-15 (MSF-664): se mantienen `/stock/faltantes` (A pedido) y `/ventas/faltantes` (despacho con avisos); nombres «Faltantes de stock (A pedido)» y «Faltantes de despacho» en menú, pestañas y títulos, con enlace cruzado.
- CA-L34-16 (MSF-609): sin cambios: las secciones de envío y responsables se ocultan hasta factura viva y Documentos explica el motivo; no se dibujan acciones deshabilitadas que el prototipo no tiene.

- CA-L34-17 (MSF-612): dominio real y enlace en la ficha de empresa; ayuda de «Visible en» veraz; sin «Precio: —» vacío en «Empresas que lo venden».
- CA-L34-18 (MSF-640): un solo selector de empresa en `/empresas/edit/:id`.
- CA-L34-19 (MSF-686, 611, 616): errores de carga con «Reintentar» en IA; tooltips de Productos veraces; diálogo «Interés por WhatsApp» honesto.

## Modelo de datos (DER)

Sin cambios de esquema.

## Matriz pantalla↔criterios

`pnpm prototipo:inventario` se corrió. El prototipo manda: se actualizaron `Login`, `DefinirContrasena` y `RecuperarContrasena` (panel de marca) y `ClienteFicha` y `Clientes` (campo «Condición de IVA»); sus inventarios están al día.

| Ítem | Dueño | Nota |
|---|---|---|
| Panel de marca: «Ingresá a tu panel» y pie «Gestión comercial» | CA-L34-4 | Prototipo actualizado; se quitó la fila de tiendas |
| Ficha de cliente: campo «Condición de IVA» (selector + «Otra») | CA-L34-10 | **Adición declarada** al prototipo (`ClienteFicha`, `Clientes`); «Otra condición» aparece solo al elegir «Otra» |
| Importar clientes: columna «Condición de IVA» | CA-L34-10 | La plantilla CSV sale de la definición de la entidad; el diálogo del prototipo no lista columnas |
| Toma de inventario: depósito de solo lectura y opción «Sin categoría» | CA-L34-8 | Pantalla no dibujada en el prototipo (se arma con el sistema de diseño); elegir otro depósito necesita un parámetro en la RPC (pendiente de SQL) |
| Menú y pestañas «Faltantes de stock» / «Faltantes de despacho», títulos y enlace cruzado | CA-L34-15 | Prototipo actualizado (`AdminSider`, pestañas, `VentasFaltantes`); el enlace cruzado es una **adición declarada** |
| Ficha de empresa: «Dominio» con valor real; encabezado con un solo selector de empresa | CA-L34-17, CA-L34-18 | Sin elementos nuevos |
| Reparación entregada, Mi perfil, Mi organización, Roles, Recuperar acceso | CA-L34-3, CA-L34-14 | Ajustes de texto y de acciones visibles; sin elementos nuevos |
| **Empresa activa** | CA-L34-2, CA-L34-8, CA-L34-10 | Las pantallas tocadas conservan su comportamiento con la empresa activa (invalidación y recarga ya vigentes). Toma de inventario: no aplica, el stock es único por organización. Ficha de cliente: el cliente es de la organización. |

## Fuera de alcance / pendiente

- MSF-719 (elegir depósito) y MSF-723 (borrar un costo): requieren cambiar RPC; quedan para el lote de SQL.
- MSF-616 (consultas de origen WhatsApp, MSF-993), MSF-611 «Stock bajo» en el listado y MSF-701 (precios de la tienda al centavo, tras #1136): requieren SQL o dependen de otro PR.
- MSF-619: qué pantallas de Ventas ve cada rol (decisión de producto).
