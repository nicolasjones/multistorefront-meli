# Mapeo pantalla implementada ↔ prototipo

Criterio: para cada pantalla implementada en `apps/web/src/pages/**` se busca su
equivalente en `design/pantallas/*.dc.html` y se anota qué se hizo. Lo que no
tiene prototipo queda cubierto por el tema y las piezas compartidas
(`EncabezadoPagina`, `BarraHerramientas`, tarjetas y tablas).

## Con equivalente directo

| Pantalla implementada | Prototipo | Estado |
|---|---|---|
| `login.tsx` | `Login` | Marco de acceso de dos paneles (`MarcoAcceso` + `PanelMarca`). |
| `acceso/definir-contrasena.tsx` | `DefinirContrasena` | Marco de acceso; título `.t1` y descripción `.bl`. |
| `acceso/solicitar-recuperacion.tsx` | `RecuperarContrasena` | Marco de acceso; enlace «Volver al ingreso». |
| `acceso-restringido/AccesoRestringido.tsx` | `AccesoRestringido` | Encabezado `.t1` + tarjeta centrada (ya lo usaba). |
| `clientes/list.tsx` | `Clientes` (listado) | Encabezado, barra de herramientas, píldoras y tabla. |
| `clientes/show.tsx` | `ClienteFicha` | Encabezado y tarjetas de la ficha. |
| `clientes/create.tsx`, `edit.tsx` | `Clientes` (ficha) | Encabezado de página compartido. |
| `productos/list.tsx` | `Productos` | Encabezado, miniatura, barra de herramientas y tabla. |
| `productos/create.tsx` | `ProductoAlta` | Encabezado de página compartido. |
| `productos/edit.tsx` | `ProductoEditar` | Encabezado de página compartido. |
| `empresas/list.tsx` | `Stores` | Encabezado, logo en la fila, barra de herramientas y tabla. |
| `empresas/edit.tsx` | `StoreGeneral`/`StorePrecios`/`StoreIdentidad`/`StoreML`/`StoreCatalogo`/`StoreContenido`/`StorePublicacion` | Encabezado de página compartido (el resto es contenido con dueño de datos). |
| `usuarios/list.tsx` | `Usuarios` | Encabezado, avatar en la identidad, barra de herramientas y tabla. |
| `usuarios/create.tsx` | `Usuarios` (invitación) | Abre el diálogo «Invitar usuario» del prototipo. |
| `roles/list.tsx` | `Roles` | Encabezado, tarjetas de rol y matriz con la escala del prototipo. |
| `actividad/list.tsx` | `Actividad` | Encabezado, filtros y texto de ayuda. |
| `cuenta/perfil.tsx` | — (sin prototipo) | Encabezado `.t1` y títulos internos `.t3`. |
| `cuenta/cambiar-contrasena.tsx`, `cambiar-correo.tsx` | — (sin prototipo) | Título `.t1`. |

## Aproximadas (prototipo de otra sección, mismo patrón)

| Pantalla | Prototipo cercano | Estado |
|---|---|---|
| `analitica/list.tsx`, `administrar.tsx`, `permisos.tsx` | `Rentabilidad*` | Usan las piezas compartidas; la paridad fina espera su épica. |
| `conexiones/*`, `conexiones-oauth/*`, `integraciones-oauth/*` | `MLConexion`, `MLVincular`, `MLCuenta` | Usan el tema; los formularios van sobre `Create`/`Edit` de Refine. |
| `ejecuciones/list.tsx`, `show.tsx` | `Historial` | Usan el tema; sin prototipo exacto. |

## Sin prototipo (interno)

`features/administrar.tsx`, `ia/*`, `organizacion/edit.tsx`,
`organizaciones/{list,create}.tsx`, `servidores/{list,create}.tsx`. Quedan
cubiertos por el tema y las piezas compartidas; no hay diseño de referencia.

## Prototipos sin pantalla implementada (features con otro dueño)

`Categorias`, `Consultas`, `Cotizacion`, `CuentasCobro`, `Depositos`,
`Historial`, `IngresoMercaderia`, `Newsletter`, `Opiniones`, `ProductosCarga`,
`ProveedorFicha`, `Proveedores`, `Stock*`, `TiposCliente`, `Ventas*`,
`MLImportaciones`, `MLPublicaciones`, `MLSincronizacion`, `Servicio*`,
`MJC_*`/`SJ_*` (tiendas públicas) y `Rentabilidad*`. No se implementan acá:
no tienen dueño de datos todavía.
