---
owner: producto
sources:
  - specs
---

# Consultas de las tiendas

**Épica:** MSF-122 · **Historias:** F-CON-01 (bandeja) y F-CON-03 (aviso por correo).

Cada consulta que un visitante envía desde una tienda queda registrada en el panel. El equipo la ve en una
**bandeja** con estados, responsable y nota interna, y las personas de la empresa con acceso a Consultas
reciben un **correo de aviso** (configurable y agrupado desde MSF-189).

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

Al abrir una fila se muestra:

- Empresa, origen, estado y fecha.
- Contacto del visitante, producto de interés y mensaje.
- **Estado**, **Responsable** y **Nota interna** (editables con permiso de edición).
- **Responder por correo / WhatsApp**: abre el cliente externo. El panel **no envía nada al visitante**.
- Aviso de éxito al guardar y mensaje claro si otra persona modificó la consulta antes.

### Aviso por correo

- Desde **MSF-189**, el aviso de una consulta nueva llega a las **personas de la empresa** con acceso a
  Consultas que no lo hayan apagado en **Cuenta → Avisos por correo**. Ya no sale a una única dirección de
  la empresa.
- Respeta la **agrupación**: varias consultas nuevas en 15 minutos llegan en **un solo correo** con la
  cantidad y el detalle de cada una.
- Si el envío falla, la consulta queda registrada igual y el aviso se reintenta con un tope.
- La antigua **dirección de avisos de la empresa** (ficha de la empresa, pestaña **General**) ya no se usa
  para las consultas nuevas: solo queda para drenar avisos encolados por el camino anterior. Detalle:
  [Avisos por correo y listas configurables](avisos-y-listas.md).

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
- Los tres estados siguen siendo **fijos en la bandeja**. La pantalla **Listas configurables** (MSF-189) ya
  permite administrar una lista de estados de consulta, pero **todavía no gobierna** las opciones de la
  bandeja: conectarlas queda como seguimiento.
- El aviso por correo **sí es configurable por persona** desde MSF-189 (y llega agrupado). Ver
  [Avisos por correo y listas configurables](avisos-y-listas.md).
- **Retención pendiente:** todavía no hay política definida para conservar o borrar consultas y datos
  personales. Esta entrega no borra ni expira nada.
- El **proveedor de correo transaccional** y el dominio de envío (SPF/DKIM) todavía no están definidos; los
  configura el equipo técnico. Cambiar de proveedor no cambia el flujo.
- La entrega de correo es **al menos una vez**: un reintento podría duplicar un aviso ya enviado. Se prefiere
  eso a perderlo.

## Estado de la entrega

Implementado en la rama de la épica (spec `20261023-120000-consultas-bandeja-y-aviso`): bandeja MSF-186,
aviso MSF-207 y cierre con E2E y revisión de seguridad. El aviso configurable y agrupado se suma en MSF-189
(spec `20261024-120000-avisos-y-listas-configurables`). Pendiente de merge a `main` en este repositorio.

Detalle técnico: [Consultas: modelo, RPC y aviso](../tecnico/consultas.md).
