---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Cuenta web del cliente (MSF-237)

Épica **MSF-237 · Clientes y proveedores: cuenta web del cliente**. Historias: **F-CLI-05** (cuenta y acceso
a la tienda), **F-CLI-06** (ingreso y recuperación de contraseña) y **F-CLI-07** (precios según el tipo de
cliente). Spec: `specs/20261024-051500-cuenta-web-del-cliente/spec.md`. Implementación en la rama
`epic/MSF-237-clientes-y-proveedores-cuenta-web-del-cl` (commits `2f9d44f`, `8bc7cd5`, `457bc7f`,
`3f30298`, `a71a052` y cierre `27f480b`), **pendiente de merge a `main`** al momento de esta página.
Detalle técnico: [Cuenta web del cliente](../tecnico/cuenta-web-cliente.md).

Esta página cubre el **acceso del cliente a la tienda** y los **precios de su escala**. El alta y la ficha
del cliente (datos, documento, tipo) vienen de **MSF-180** ([Clientes](../clientes.md)); la tienda navegable
y su catálogo, de **MSF-167** ([Tiendas online](tiendas-online.md)); la regla de precio de la empresa y el
IVA, de **MSF-114**.

## Qué resuelve

- Un operador de Clientes **habilita a un cliente en una tienda** y le **crea una cuenta web por
  invitación**, sin darlo de alta como usuario del panel.
- El cliente **define su contraseña**, **ingresa** a la tienda de esa empresa y **recupera su contraseña**
  si la olvida.
- Con la cuenta activa, el cliente ve **los precios de su escala**: minorista, el precio de lista (`x1`);
  mayorista, las escalas `x1`, `x5`, `x10` y `x50` con su rango de unidades.
- El operador puede **suspender y reactivar** el acceso, **restablecer la clave** y consultar el
  **correo de acceso** y el **último ingreso**.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Operador/a de Clientes** | Habilita tiendas, crea la cuenta web, suspende/reactiva, restablece la clave y ve el estado por tienda en la ficha y el listado. |
| **Cliente con cuenta web** | Define su contraseña desde el enlace, ingresa a la tienda, recupera la contraseña y ve los precios de su escala. |
| **Dueño/a o responsable de la empresa** | Define el tipo del cliente (minorista/mayorista) y la regla de precio e IVA de la empresa; la tienda aplica esas reglas. |
| **Visitante sin cuenta** | No cambia nada: ve el mismo precio público de siempre. |

## Cómo se usa desde el panel

### Ficha del cliente

La ficha (`/clientes/show/:id`) suma dos bloques:

- **Tiendas** — por tienda, el interruptor «Habilitado en la tienda», el texto «Compra con su tipo y
  escala» o «No ve ni compra en esta tienda» y el chip con el estado de la cuenta. Deshabilitar la tienda
  **no borra la cuenta**: el estado pasa a «No habilitado» y, al rehabilitarla, la cuenta vuelve a su
  estado anterior.
- **Cuenta web** — una pestaña por tienda con el estado, el **Correo de acceso**, el **Último ingreso** (si
  hay cuenta) y las acciones que corresponden. «Crear cuenta web» queda deshabilitada con el motivo
  «Cargá un correo para crear la cuenta» si el cliente no tiene correo.

| Estado | Qué significa | Acciones |
|---|---|---|
| **Activa** | «Puede ingresar a las tiendas con su correo.» | Restablecer clave · Suspender acceso |
| **Suspendida** | «No puede ingresar hasta que la reactives.» | Reactivar acceso |
| **Sin cuenta** | «El cliente compra sin registrarse.» | Crear cuenta web |
| **No habilitado** | «El cliente no puede comprar en esta tienda.» | Habilitar en la tienda |

Mensajes de confirmación: «Cuenta creada en <Tienda>: se envió el enlace para definir la clave»,
«Enlace para definir una nueva clave enviado», «Cuenta web suspendida en <Tienda>», «Cuenta web
reactivada en <Tienda>», «Cliente habilitado/deshabilitado en <Tienda>».

### Listado y formulario

- **Listado** (`/clientes`): la columna **Cuenta web** muestra el chip (Activa / Suspendida / Sin cuenta)
  y el filtro **Con cuenta web** deja los clientes con cuenta activa y habilitados en la tienda.
  - Con una tienda elegida, la columna muestra el estado de esa tienda.
  - En «Todas mis empresas» se muestra **Activa** si alguna tienda lo está; si no, **Suspendida** si
    alguna lo está; si no, **Sin cuenta** (D4).
- **Alta/edición**: el formulario agrega el campo **Cuenta web** (Sin cuenta / Activa / Suspendida) con su
  nota y la casilla **«Enviar invitación por correo al crear la cuenta»**. Al guardar con «Activa», la
  cuenta se crea en **cada tienda tildada** en «Habilitado en». Las cuentas que ya existían no reciben otra
  invitación: se suspenden o reactivan solo si el operador cambia el campo.
- **Errores parciales**: si el cliente se guarda pero falla la cuenta web en alguna tienda, se avisa en la
  ficha («no se pudo crear/actualizar la cuenta web en N tiendas») sin deshacer el alta del cliente.

### Empresa activa

La ficha, el listado y el formulario siguen la **empresa activa** de la barra superior (Principio VIII):
al cambiarla se recargan los datos, la paginación vuelve a la primera página, se descarta la selección de
filas y la ficha abre la pestaña de la nueva tienda. Un formulario abierto se reencuadra y no guarda datos
de la empresa anterior.

## Cómo se usa en la tienda

La tienda pública resuelve la empresa por el **dominio** (sin selector de empresa) y suma tres rutas:

| Ruta | Qué hace |
|---|---|
| `/ingresar` | Ingreso con correo y contraseña; el encabezado muestra «Ingresar» o «Salir». |
| `/definir-contrasena` | Atiende el enlace de invitación o de restablecimiento, pide la nueva contraseña con la política del template y deja al cliente ingresado. |
| `/recuperar-contrasena` | Pide el correo y muestra siempre el mismo aviso, exista o no la cuenta. |

- **Solo entra una cuenta activa y habilitada en esa tienda.** Credenciales incorrectas, cuenta
  suspendida, sin cuenta o no habilitada muestran el **mismo mensaje genérico** («Correo o contraseña
  incorrectos.») y no dejan sesión abierta.
- La **suspensión rige al instante**: el estado se consulta en cada carga, no viaja en el token. La
  próxima llamada a la tienda cierra la sesión.
- El **enlace vencido o ya usado** muestra un aviso claro con salida a «Recuperar contraseña».
- La recuperación **no revela si el correo tiene cuenta**: responde igual en todos los casos y solo envía
  el correo si la cuenta está activa en esa tienda.
- El bloqueo por intentos fallidos del template sigue vigente para el correo del cliente.

## Precios de la tienda según el tipo de cliente

| Quién mira | Qué ve |
|---|---|
| Visitante sin sesión, cuenta suspendida, sin cuenta o no habilitada | El **precio público de siempre**; nada cambia para él. |
| Cliente **minorista** con cuenta activa | El precio final de la escala **x1** de la empresa («Tu precio»). |
| Cliente **mayorista** con cuenta activa | En la **ficha** del producto, «Tus precios por cantidad» con **x1, x5, x10 y x50** y su rango de unidades (1–4, 5–9, 10–49, 50 o más). |
| Mayorista en el **catálogo** | Las tarjetas siguen mostrando el precio **x1** (D3). |

- El precio se calcula en el servidor con la **misma regla de la empresa** y el interruptor **con/sin IVA**
  que el precio público; una escala sin precio cargado usa el **x1**.
- El **tipo y el estado del cliente mandan en cada carga**: cambiar el tipo o suspender la cuenta se
  refleja en la próxima apertura de la tienda, sin caché de escala en la sesión.
- Si un precio no se puede calcular, la ficha muestra «Consultar» en esa escala.
- La respuesta no expone costos, margen, existencias ni `organizacion_id`, y el cliente no puede pedir la
  escala de otro tipo.
- El cliente **no puede elegir** la escala ni la cantidad: la tienda no cobra ni tiene carrito en esta
  entrega; solo muestra los precios que le corresponden.

## Reglas de negocio

- **Una cuenta de Auth por cliente, una cuenta por tienda.** El cliente usa su correo y una sola
  contraseña; con ella entra a las tiendas donde su cuenta esté activa. No se crea un usuario por tienda
  (D1).
- **La cuenta web no es un usuario del panel.** No tiene fila en `usuarios_organizacion` y no puede leer ni
  escribir datos del panel; un cliente que intente entrar al panel recibe «Acceso restringido».
- **Solo por invitación.** No hay auto-registro público ni aprobación del mayorista: la cuenta nace desde
  el panel (D2). `enable_signup` sigue en `false`.
- **El correo de acceso sale del correo del cliente.** Sin correo no se puede crear la cuenta; si ese
  correo ya pertenece a un usuario del panel, la invitación se rechaza con un mensaje genérico (D5).
- **No se mezclan identidades.** Un mismo correo no puede ser a la vez usuario del panel y cuenta web, ni
  servir a dos clientes.
- **Cada acción queda registrada** en Actividad con actor, cliente y tienda: cuenta creada, suspendida,
  reactivada y restablecida. No se guarda el correo ni datos de contacto en el detalle.
- **La cuenta sobrevive a la deshabilitación de la tienda**; si se archiva o elimina el cliente, sus
  cuentas dejan de dar acceso (al eliminarlo, la fila se borra en cascada).

## Límites y fuera de alcance

Queda **fuera de esta épica** y no debe leerse como hecho:

- **Auto-registro público y aprobación del mayorista** (D2).
- **Historial de compras, favoritos y datos personales editables** de la cuenta: F-CLI-20 (MSF-450, P3).
- **Compra, carrito y cobro en línea** (MSF-176): las tiendas no cobran; la cuenta solo da acceso a
  precios y a los datos del cliente.
- **Tipo «Distribuidor»**: la base solo admite minorista y mayorista; los tipos de cliente se administran
  en otra historia (F-CLI-03).
- **Selección automática de escala por cantidad en ventas internas** (F-VTA-06): acá solo se muestran las
  escalas.
- **Cambio de correo y de contraseña desde la tienda** más allá de definir/recuperar.

## Decisiones y supuestos (D1–D6)

| | Supuesto adoptado | Estado |
|---|---|---|
| **D1** | Una cuenta de Auth por cliente y una fila por `(cliente, tienda)`; la misma contraseña sirve en las tiendas donde esté activa. | Implementado; confirmar con Nicolás si un cliente debe entrar a las dos marcas con la misma cuenta. |
| **D2** | Solo invitación desde el panel; sin auto-registro ni aprobación del mayorista. | Implementado; abierto si el negocio necesita auto-registro. |
| **D3** | El mayorista ve las escalas en la ficha; las tarjetas del catálogo siguen en x1. | Implementado; si Producto pide otra cosa, se cambia solo la tarjeta. |
| **D4** | En «Todas mis empresas», la columna agregada es Activa > Suspendida > Sin cuenta. | Implementado. |
| **D5** | Correo de usuario del panel ⇒ rechazo con mensaje genérico; nunca se mezclan identidades. | Implementado. |
| **D6** | Las pantallas públicas de ingreso/recuperación **no están dibujadas** en el prototipo: se construyeron con el sistema de diseño, sin inventar elementos. | Pendiente que Nicolás las dibuje. |

Contradicciones anotadas para el PR: las pantallas públicas no existen en `design/pantallas` (D6); el
prototipo dibuja tipos Minorista, Mayorista y **Distribuidor**, pero la base solo tiene los dos primeros; la
ficha del prototipo es la fuente de los bloques Tiendas/Cuenta web, y el diálogo de alta/edición se
resolvió con el formulario existente.

## Estado y pendientes

**Implementado en la rama de la épica** (MSF-422, MSF-428, MSF-432 y cierre MSF-559), **pendiente de merge a
`main`**. Tiene pgTAP, Vitest/axe y un E2E escrito (`apps/web/e2e/cuenta-web-cliente.e2e.ts`) que requiere
el stack local.

| Pendiente | Dueño |
|---|---|
| Dibujar las pantallas públicas de Ingresar, Definir contraseña y Recuperar contraseña en «Tiendas públicas» (D6). | Nicolás / Producto |
| Resolver el conflicto de roadmap: el «Roadmap a diciembre» no menciona la cuenta web y Tiendas online deja las cuentas de cliente en P3 (F-TDA-27), mientras esta épica es P0. Rige el roadmap hasta que se defina. | Producto / planificación |
| Confirmar D1 (una cuenta para las dos marcas) y D2 (solo invitación o auto-registro con aprobación). | Nicolás / cliente |
| Confirmar si el mayorista debe ver algo distinto de x1 en las tarjetas del catálogo (D3). | Producto |
| Historial de compras y favoritos de la cuenta. | F-CLI-20 · MSF-450 (P3) |
| Si F-CLI-07 no entra antes del 31 de diciembre, pasa a Etapa 2 según la épica (riesgo de plan, no requisito). | Planificación |

## Ver también

- [Clientes](../clientes.md) — alta, búsqueda, tipo y ficha del cliente.
- [Tiendas online](tiendas-online.md) — catálogo, ficha y rutas públicas.
- [Acceso: ingreso, recuperación y sesión](../acceso-ingreso.md) — flujo del panel y reglas de Auth.
- [Cuenta web del cliente (técnico)](../tecnico/cuenta-web-cliente.md) — datos, RPC, Edge Functions y
  operación.

> **Revisión de fuentes:** 2026-10-25 — se sincronizó el prototipo `design/pantallas/AdminHeader.dc.html`; esta página se revisó y su contenido no cambia.
