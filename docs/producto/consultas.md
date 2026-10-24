---
owner: producto
sources:
  - specs
---

# Consultas de las tiendas

**Épica:** MSF-122 · **Historias:** F-CON-01 (bandeja) y F-CON-03 (aviso por correo).

Cada consulta que un visitante envía desde una tienda queda registrada en el panel. El equipo la ve en una
**bandeja** con estados, responsable y nota interna, y la empresa recibe un **correo de aviso** con un enlace
directo a la consulta.

## Qué resuelve

Antes, una consulta del formulario de contacto o del botón de WhatsApp de una tienda se perdía fuera del
panel. Con esta entrega:

- Toda consulta queda guardada y asociada a la empresa dueña del dominio de la tienda.
- El equipo puede verla, buscarla, filtrarla y atenderla desde un solo lugar.
- La empresa se entera de cada consulta nueva sin mirar el panel, por correo.

## Para quién

- **Administración y operación** de cada empresa: ven y atienden las consultas de las tiendas a las que
  tienen acceso.
- **Mostrador**: puede atender las consultas si su rol tiene la sección `consultas`.
- **Consulta (solo lectura)**: ve la bandeja y el detalle, pero no asigna, no anota ni cambia el estado.

El acceso respeta la **empresa activa** y los permisos por empresa: cada persona ve solo las consultas de
las empresas que le corresponden dentro de su organización.

## Qué incluye

### Bandeja

- Menú **Canales → Consultas**, con un contador de consultas nuevas de las empresas visibles.
- Listado con las columnas **Estado**, **Cuándo**, **Empresa**, **Contacto**, **Producto** y **Origen**.
- Filtros por **tienda**, **estado** y **rango de fechas**, más búsqueda por nombre, producto o mensaje.
- Chips de estado: **Todas**, **Nuevas (n)**, **En curso** y **Resuelta**.
- Paginación y pie con el total de consultas del filtro.
- Estados de carga, vacío y error con reintento; operable con teclado y lector de pantalla.

### Detalle de una consulta

Al abrir una fila (o el enlace `?consulta=<id>` del correo) se muestra:

- Empresa, origen, estado y fecha.
- Contacto del visitante, producto de interés y mensaje.
- **Estado**, **Responsable** y **Nota interna** (editables con permiso de edición).
- **Responder por correo / WhatsApp**: abre el cliente externo. El panel **no envía nada al visitante**.
- Aviso de éxito al guardar y mensaje claro si otra persona modificó la consulta antes.

### Aviso por correo

- Se envía **un** correo por consulta nueva, en texto plano, con empresa, origen, nombre, contacto, producto,
  mensaje y un enlace a la consulta.
- La dirección de avisos se edita en la ficha de la empresa, pestaña **General** (campo **Correo para avisos
  de consultas**). Mientras no se edite, se usa el correo de contacto de la empresa.
- Si el envío falla, la consulta queda registrada igual y el aviso se reintenta con un tope. Sin dirección,
  el aviso queda como **sin destinatario** y se retoma cuando la empresa carga un correo.

## Estados

Los tres estados son **fijos** en esta etapa y se cambian **a mano**:

| Estado | Qué significa |
|---|---|
| **Nueva** | Llegó y nadie la tomó todavía. |
| **En curso** | Alguien la está atendiendo. |
| **Resuelta** | Se respondió al visitante fuera del panel. |

Asignar un responsable o escribir una nota **no** cambia el estado: el cambio es siempre una acción de una
persona. Reabrir una consulta resuelta es posible volviendo a **Nueva** o **En curso**.

## Límites y fuera de alcance

- La bandeja es **solo un registro**: la respuesta al visitante se da por correo o WhatsApp, fuera del
  sistema. El panel no manda mensajes.
- El **formulario de la tienda**, el botón «Consultar por WhatsApp» y la protección contra spam (campo
  trampa y límite por IP) son de **Tiendas online** (MSF-212). Esta épica entrega la recepción y validación
  en el servidor.
- Los tres estados no se editan desde configuración; eso llega con F-CFG-01.
- El centro de avisos configurable por usuario (F-NOT-01) es posterior: aquí el aviso va a la dirección de la
  empresa.
- **Retención pendiente:** todavía no hay política definida para conservar o borrar consultas y datos
  personales. Esta entrega no borra ni expira nada.
- El **proveedor de correo transaccional** y el dominio de envío (SPF/DKIM) todavía no están definidos; los
  configura el equipo técnico. Cambiar de proveedor no cambia el flujo.
- La entrega de correo es **al menos una vez**: un reintento podría duplicar un aviso ya enviado. Se prefiere
  eso a perderlo.

## Estado de la entrega

Implementado en la rama de la épica (spec `20261023-120000-consultas-bandeja-y-aviso`): bandeja MSF-186,
aviso MSF-207 y cierre con E2E y revisión de seguridad. Pendiente de merge a `main` en este repositorio.

Detalle técnico: [Consultas: modelo, RPC y aviso](../tecnico/consultas.md).
