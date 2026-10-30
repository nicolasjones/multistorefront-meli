---
owner: producto
sources:
  - specs
  - apps/web/src
---

# Clientes (MSF-180)

**Épica:** MSF-180 — Clientes y proveedores · Clientes alta y búsqueda.
**Historias:** F-CLI-01 (MSF-262), F-CLI-02 (MSF-282), F-CLI-03 (MSF-301), F-CLI-04 (MSF-318).
**Spec:** `specs/20261016-130000-clientes-alta-y-busqueda/`.
**Construcción interna:** [Clientes: modelo, RPC y pantallas](tecnico/clientes.md).

El equipo puede dar de alta, editar, buscar y exportar los clientes de la organización, cada uno con
su tipo minorista o mayorista, y existe el **Consumidor final** para el mostrador, listos para que
Ventas los use.

## Qué resuelve

- Antes el panel solo traía el esqueleto de clientes del panel anterior: sin datos de contacto, sin
  búsqueda, sin tipos y sin forma de darlos de baja.
- Ahora hay una **ficha de cliente** de la organización con nombre o razón social, DNI/CUIT, correo,
  teléfono, celular, dirección, código postal, localidad y provincia, y un **número correlativo** por
  organización que se lo asigna el sistema (nadie lo escribe a mano).
- El listado **busca y pagina en el servidor**: con miles de clientes no hay que traerlos todos para
  filtrar en el navegador.
- Cada cliente tiene **tipo** (minorista o mayorista), que es lo que después define la escala de precio
  en Ventas.
- Cada organización tiene un **Consumidor final**: el cliente de mostrador, para vender en el local sin
  cargar un cliente cada vez.
- El cliente **se archiva, no se borra**: deja de verse en el listado pero conserva sus datos y sus
  comprobantes, y se puede restaurar.
- Los clientes que coincidan con la búsqueda se **exportan a una planilla de Excel**.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Administrador/a, Administración, Operador y Mostrador** (`edicion` en Clientes) | Ver el listado, dar de alta, editar, archivar y restaurar clientes |
| **Consulta** (`lectura` en Clientes) | Ver el listado y la ficha; no cambia nada, ni desde la pantalla ni llamando directo a la base |
| **Miembro** (`lectura` en Clientes) | Igual que Consulta |
| **Depósito** (`ninguno` en la matriz vigente) | No ve la sección ni recibe filas de clientes por la API |
| **Con la acción `exportar`** (Administrador, Administración y Operador por defecto) | Además, descargar los clientes a Excel |

La matriz de roles y el detalle de permisos están en [Permisos por rol](permisos-por-rol.md).

!!! note "La base manda, no la pantalla"
    Ocultar un botón es comodidad, no autorización: las políticas de `public.clientes` vuelven a
    comprobar organización y nivel de sección en cada lectura y escritura.

## La ficha del cliente

| Campo | Qué es |
|---|---|
| **Número** | Correlativo de la organización. Lo asigna el sistema; no se edita. |
| **Nombre o razón social** | Obligatorio. Se guarda recortado. **No** es único: dos clientes con el mismo nombre pueden coexistir. |
| **DNI/CUIT** | Opcional. **Único por organización** (se comparan solo letras y dígitos: sin puntos, guiones ni espacios) e incluye los archivados, para que restaurar nunca choque. Repetirlo se rechaza en el campo. |
| **Correo, teléfono, celular** | Contacto. |
| **Dirección, código postal, localidad, provincia** | Domicilio. |
| **Tipo** | Minorista o Mayorista. Obligatorio; Minorista por defecto. |
| **Estado** | Activo o Archivado. |

Desde **MSF-232** la ficha tiene dos pestañas: **«Datos»** (lo de siempre, sin cambios) y **«Reparaciones»**, que
lista las reparaciones del cliente (número, tienda, equipo, estado, ingreso, entrega y total), paginadas y filtradas
por la empresa activa. La pestaña solo aparece con acceso a Service técnico. Detalle: [Service técnico: cobro,
avisos y ficha del cliente](producto/service-cobro-y-avisos.md).

## Alta y edición

- «Nuevo cliente» abre el formulario con nombre o razón social, DNI/CUIT, correo, teléfono, celular,
  dirección, código postal, localidad, provincia y tipo. Al guardar se confirma **«Cliente creado»**;
  al editar, **«Cliente guardado»**.
- Si el nombre queda vacío, el error aparece en el campo y no se guarda.
- Si el DNI/CUIT ya lo usa otro cliente de la organización, el error aparece en el campo
  («Ya existe un cliente con ese DNI/CUIT») y no se guarda.
- Si el guardado falla, el formulario muestra el error («No se guardó el cliente»), deja el botón listo
  para volver a guardar y **conserva lo escrito**.
- El botón se deshabilita mientras envía: un doble clic no crea dos clientes.
- La ficha del cliente muestra los datos, el tipo y el estado, con «Editar» para quien puede editar.

## Listado, búsqueda, filtros y paginación

- Columnas: Cliente (nombre, N.º y DNI/CUIT), Tipo, Contacto (correo y teléfono), Localidad, más
  Expreso preferido y las columnas «Tiendas» y «Cuenta web», que hoy se muestran como «—» porque esas
  capacidades son de la cuenta web del cliente (MSF-237).
- El buscador espera ≈300 ms antes de consultar (no busca en cada tecla) y filtra por coincidencia
  parcial, sin distinguir mayúsculas, sobre **nombre, DNI/CUIT, correo, teléfono, localidad y número**.
- Filtros combinables: **Todos / Minorista / Mayorista** y **Activos / Archivados** (Activos por
  defecto).
- La paginación es del servidor (25 por página) y muestra el total; cambiar de página conserva la
  búsqueda y los filtros.
- Estados vacíos con salida: si hay filtros y no hay coincidencias, «No encontramos clientes con esos
  criterios» con la sugerencia de probar otro texto o quitar un filtro; si no hay ningún cliente
  cargado, «Todavía no hay clientes cargados.» y el botón «Nuevo cliente» queda a mano (si hay
  permiso). Un error de carga muestra el estado compartido con «Reintentar».
- En pantallas angostas (320 px) el listado pasa a tarjetas; funciona con teclado y lector de pantalla
  y no muestra identificadores técnicos.

## Archivar y restaurar

- Archivar pide confirmación y el cliente **deja de verse en el listado por defecto**. No se pierde
  ningún dato y sigue siendo legible por sus comprobantes históricos.
- Con el filtro «Archivados» se ven los archivados; «Restaurar» los devuelve al listado activo con
  sus datos y su número.
- **No existe «Eliminar»** en ninguna pantalla. Archivar un cliente ya archivado no duplica nada.

## Tipo minorista y mayorista

- El tipo se elige entre **Minorista** y **Mayorista**, con una explicación breve de cada uno.
- Hoy el tipo define la **escala de precios** que Ventas y Service técnico van a leer: minorista
  `x1` (siempre precio de lista), mayorista `por_cantidad` (escala según la cantidad).
- Al cambiar el tipo de un cliente existente, el panel avisa que «Al cambiar el tipo, las próximas
  ventas usarán la escala de precios del nuevo tipo. Lo ya vendido no cambia», y el cambio queda
  registrado en Actividad.
- La regla de la escala es **provisoria**: la define Precios más adelante. Si cambia, no cambia la
  forma de usarla.

!!! warning "No se crean tipos"
    Los tipos son fijos (minorista y mayorista) y no se pueden crear ni borrar. La pantalla «Tipos de
    cliente» del prototipo, con descuento adicional y condición de pago, **no** se construyó.

## Consumidor final

- Cada organización tiene **exactamente un** cliente «Consumidor final», de tipo minorista, creado
  automáticamente. Sirve para vender en el mostrador sin cargar un cliente cada vez.
- No se puede editar, archivar ni cambiarle el tipo: la base lo rechaza aunque alguien la llame
  directo.
- Aparece en el listado y en las exportaciones como un cliente más; la ficha lo marca como **«Cliente
  de mostrador»**.
- En organizaciones nuevas es el cliente N.º 1; en las que ya tenían clientes, toma el siguiente
  número libre.

## Exportar clientes

- El botón «Exportar» aparece solo para quien tiene la acción `exportar`; sin ese permiso, la
  descarga se rechaza en el servidor aunque se la pida a la base directamente.
- Descarga **todas** las filas que coinciden con la búsqueda y los filtros (no solo la página visible),
  en una planilla **Excel `.xlsx`** con una columna por campo: N.º, nombre o razón social, DNI/CUIT,
  tipo, correo, teléfono, celular, dirección, código postal, localidad, provincia y estado.
- La descarga se arma por lotes, muestra el progreso y se puede cancelar; si falla, se reintenta.
- Los valores que empiezan con `=`, `+`, `-` o `@` se guardan como texto y se neutralizan, para que
  la planilla no los ejecute como fórmula. **Costo aceptado:** el apóstrofo queda visible (un teléfono
  «+54…» se ve «'+54…»).

## Límites y fuera de alcance

Lo que **no** hace esta épica (pertenece a otras historias o épicas):

- **Cuenta web del cliente**, invitación, «Tiendas / Habilitado en» y el filtro «Con cuenta web»
  (MSF-237). Lo entregado está en [Cuenta web del cliente](producto/cuenta-web-cliente.md).
- **Ranking por facturación** (MSF-126), **correo masivo a seleccionados** (MSF-155), **Importar
  clientes** (MSF-142) y **etiquetas**.
- La pantalla «Tipos de cliente» (crear tipos, descuento adicional, condición de pago).
- «Expreso preferido» y los datos de comprobantes (Facturado, Participación) son de Ventas y despacho
  (MSF-159). La columna «Expreso preferido» ya se ve en el listado, pero la agregó después un cambio
  de fidelidad al prototipo (`20261017120001_clientes_expreso_preferido.sql`), fuera de MSF-180.
- El filtro por empresa o tienda del cliente: **los clientes son de la organización**, compartidos
  entre sus empresas.
- **Eliminar** cliente (se archiva).
- Las mejoras de clientes y proveedores (MSF-445) y los **Proveedores** (MSF-205).

## Fidelidad al prototipo

La pantalla de referencia es `design/pantallas/Clientes.dc.html` (con `ClienteFicha.dc.html` y
`TiposCliente.dc.html`). El prototipo muestra más que esta historia: se implementó solo lo que pedían
los requisitos.

| Qué muestra el prototipo | Qué se entregó |
|---|---|
| Tabla de clientes, buscador, filtros de tipo, paginación | Igual, con la búsqueda y la paginación en el servidor |
| Diálogo «Nuevo/Editar cliente» | Formulario de alta y edición, con los campos del prototipo |
| Diálogo «Eliminar cliente» | **No**: se archiva y se restaura, con su confirmación |
| Pestaña «Ranking por facturación» | No (MSF-126) |
| Diálogo «Importar clientes» | No en esta épica (MSF-142) |
| Diálogo «Enviar correo a seleccionados» | No (MSF-155) |
| Columnas «Tiendas» y «Cuenta web» | Se muestran como «—»; las entrega MSF-237 |
| Pantalla «Tipos de cliente» (crear tipos, descuento, condición de pago) | No: los tipos son fijos |
| «Expreso preferido» | No en esta épica: la columna se ve, pero la agregó después un cambio de fidelidad al prototipo (fuera de MSF-180); el dato es de Ventas (MSF-159) |

## Ver también

- [Clientes: modelo, RPC y pantallas](tecnico/clientes.md) — cómo está construido.
- [Service técnico: cobro, avisos y ficha del cliente (producto)](producto/service-cobro-y-avisos.md) — la pestaña
  «Reparaciones» de la ficha (MSF-232).
- [Cuenta web del cliente](producto/cuenta-web-cliente.md) — la cuenta del cliente en la tienda (MSF-237).
- [Permisos por rol](permisos-por-rol.md) — qué puede hacer cada rol.
- [Actividad e historial](actividad.md) — los eventos `cliente.*`.
- [Migración inicial de datos](producto/migracion-inicial-de-datos.md) — carga masiva de clientes del
  panel anterior (MSF-142).
