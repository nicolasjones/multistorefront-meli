---
owner: producto
sources:
  - specs
---

# Consultas de las tiendas

**Épicas:** MSF-122 (bandeja y aviso: F-CON-01 y F-CON-03) y **MSF-130** (F-CON-02 *interés por WhatsApp* y
F-CON-04 *responder desde el panel*).

Cada consulta que un visitante envía desde una tienda queda registrada en el panel. El equipo la ve en una
**bandeja** con estados, responsable y nota interna, y las personas de la empresa con acceso a Consultas
reciben un **correo de aviso** (configurable y agrupado desde MSF-189).

## Qué resuelve

Antes, una consulta del formulario de contacto o del botón de WhatsApp de una tienda se perdía fuera del
panel. Con esta entrega:

- Toda consulta queda guardada y asociada a la empresa dueña del dominio de la tienda.
- El equipo puede verla, buscarla, filtrarla y atenderla desde un solo lugar.
- La empresa se entera de cada consulta nueva sin mirar el panel, por correo.

Las dos entradas que generan esas consultas las entrega **MSF-212** (Tiendas online): el formulario
«Escribinos» de la página «Contacto» y el botón «Consultar por WhatsApp» de la ficha, con origen
`formulario` o `whatsapp`. Ver [Tiendas online](tiendas-online.md).

## Para quién

- **Administración y operación** de cada empresa: ven y atienden las consultas de las tiendas a las que
  tienen acceso.
- **Mostrador**: puede atender las consultas si su rol tiene la sección `consultas`.
- **Consulta (solo lectura)**: ve la bandeja y el detalle, pero no asigna, no anota ni cambia el estado.

El acceso respeta la **empresa activa** y los permisos por empresa: cada persona ve solo las consultas de
las empresas que le corresponden dentro de su organización.

MSF-130 suma dos cosas sobre esa misma pantalla: el **conteo de interés por WhatsApp** (F-CON-02) y la
**respuesta con un clic** desde el detalle (F-CON-04). Las dos respetan la empresa activa: el conteo muestra
solo la empresa de la barra superior (o todas las accesibles con «Todas mis empresas») y, al cambiarla, el
diálogo abierto se cierra con aviso y se recarga.

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
  Desde MSF-130 abre con un texto inicial y deja la consulta atendida (ver «Responder desde el panel»).
- Aviso de éxito al guardar y mensaje claro si otra persona modificó la consulta antes.

### Interés por WhatsApp (F-CON-02, MSF-130)

Cuenta **cuántas veces se tocó «Consultar por WhatsApp» en cada producto** de la tienda: sirve para saber qué
producto despierta interés aunque nadie escriba.

- Botón **Interés por WhatsApp** en la pantalla de Consultas (visible con permiso de lectura o más). Abre un
  diálogo con **Producto**, **Tienda** (columna que aparece solo con «Todas mis empresas»), **Veces** y
  **Último interés**, ordenado de mayor a menor.
- **No guarda datos de quien tocó**: ni nombre, ni teléfono, ni correo, ni dirección IP, ni mensaje. Cada toque
  es una fila con empresa, producto y fecha.
- Si todavía no hubo ningún toque, se muestra el estado vacío con una explicación; si la carga falla, se puede
  reintentar.
- La lista sigue la **empresa activa**: con una empresa concreta muestra solo esa; con «Todas mis empresas»
  muestra las accesibles con la columna **Tienda**. Al cambiar de empresa se recarga y, si el diálogo estaba
  abierto, se cierra con aviso para no dejar datos de la empresa anterior.

### Responder desde el panel (F-CON-04, MSF-130)

El botón **Responder por correo / WhatsApp** del detalle abre el cliente externo **con un texto inicial** y
deja la consulta atendida en el panel.

- El canal sale del formato del contacto: si es un correo abre el gestor de correo, si es un teléfono abre
  WhatsApp. El enlace se abre en una pestaña nueva y **todo el texto va codificado**.
- El **texto inicial** saluda por el nombre, nombra la tienda y, si la consulta tiene producto, lo nombra. La
  persona lo edita en la aplicación externa antes de mandarlo.
- **El panel no manda el mensaje**: solo abre la aplicación. El sistema no sabe si el mensaje salió, y la
  pantalla nunca afirma que se envió.
- Al responder, una consulta **Nueva** pasa a **En curso** y queda **quien respondió** como responsable. Una
  consulta ya «En curso» o «Resuelta» **no cambia de estado**, no se reabre y **no se pisa** el responsable que
  ya tenía.
- Si el registro falla (otra persona la editó, falta permiso o no hay red), el panel avisa con un mensaje
  claro y ofrece **Reintentar** (registra otra vez, sin reabrir la aplicación) o **Recargar** (trae los datos
  nuevos).
- El aviso de éxito dice **cómo quedó la consulta** («Consulta En curso a tu nombre»), no que el mensaje salió.
- Con permiso de **solo lectura** el botón aparece deshabilitado con la ayuda «Necesitás permiso de edición».

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

La única excepción es **Responder desde el panel** (F-CON-04, MSF-130): responder mueve a **En curso** una
consulta que estaba **Nueva** y deja a quien respondió como responsable. No reabre una resuelta, no cambia una
que ya está en curso y no pisa a otro responsable.

## Límites y fuera de alcance

- La bandeja es **solo un registro**: la respuesta al visitante se da por correo o WhatsApp, fuera del
  sistema. El panel no manda mensajes.
- El **formulario de la tienda** y el botón «Consultar por WhatsApp» son de **Tiendas online**
  (MSF-212), que ya construyó las dos entradas: la página «Contacto» con el formulario «Escribinos» y
  el botón de WhatsApp en la ficha. Esta épica entrega la recepción, la validación en el servidor y la
  bandeja; la protección contra el abuso del lado de la tienda es el **límite de 5 envíos por hora por
  visitante y empresa** (MSF-212), no un campo trampa. Detalle:
  [Tiendas online](tiendas-online.md).
- **El conteo de interés por WhatsApp todavía no lo dispara la tienda.** MSF-130 entrega el registro y su
  lectura en el panel; la llamada desde el botón de la ficha es **F-TDA-14** (MSF-212). Hasta que la tienda
  llame a la RPC, el conteo queda en cero.
- **El sistema no sabe si el mensaje salió**: abrir WhatsApp o el correo no es enviarlo, y no hay confirmación
  de entrega. Quien responde manda el mensaje desde la aplicación externa.
- **El texto inicial es una plantilla fija.** Las **respuestas rápidas** (F-CON-06, MSF-144) y los
  **contactos** del equipo son de otra épica: cuando lleguen, reemplazan la plantilla sin cambiar el botón.
- **Teléfonos sin código de país:** el enlace de WhatsApp usa los dígitos tal cual (acepta de 7 a 15). Si el
  número no trae código de país, el chat puede no resolver. No se asume un país: es una decisión abierta.
- **El reporte de «productos más consultados»** (F-REP-04) es de Inicio, reportes y rentabilidad: esta épica
  solo deja el dato y su lectura, no el tablero.
- **El anti-spam de los toques en «Consultar por WhatsApp»** es de la tienda (MSF-212), igual que en el
  formulario: cada toque suma un interés.
- Los tres estados siguen siendo **fijos en la bandeja**. La pantalla **Listas configurables** (MSF-189) ya
  permite administrar una lista de estados de consulta, pero **todavía no gobierna** las opciones de la
  bandeja: conectarlas queda como seguimiento.
- El aviso por correo **sí es configurable por persona** desde MSF-189 (y llega agrupado). Ver
  [Avisos por correo y listas configurables](avisos-y-listas.md).
- **Retención pendiente:** todavía no hay política definida para conservar o borrar consultas y datos
  personales. Esta entrega no borra ni expira nada. Los intereses por WhatsApp no guardan datos personales,
  pero sus filas tampoco tienen política de vencimiento.
- El **proveedor de correo transaccional** y el dominio de envío (SPF/DKIM) todavía no están definidos; los
  configura el equipo técnico. Cambiar de proveedor no cambia el flujo.
- La entrega de correo es **al menos una vez**: un reintento podría duplicar un aviso ya enviado. Se prefiere
  eso a perderlo.

## Estado de la entrega

- **MSF-122** (spec `20261023-120000-consultas-bandeja-y-aviso`): bandeja MSF-186, aviso MSF-207 y cierre con
  E2E y revisión de seguridad. El aviso configurable y agrupado se suma en MSF-189 (spec
  `20261024-120000-avisos-y-listas-configurables`).
- **MSF-130** (spec `20261024-140000-consultas-seguimiento-y-whatsapp`): F-CON-02 (interés por WhatsApp,
  MSF-226: tabla, RPC pública, vista de lectura y diálogo del panel, con pgTAP y Vitest) y F-CON-04 (responder
  desde el panel, MSF-244: sin migración, con pgTAP, Vitest y E2E). Ambos quedan pendientes de merge a `main`
  en este repositorio.

## Pendientes

| Qué falta | Por qué | Dueño |
|---|---|---|
| Que la tienda llame a la RPC de interés al tocar «Consultar por WhatsApp» | Es la historia F-TDA-14 de Tiendas online; el contrato ya está | Tiendas online (MSF-212) |
| E2E que llama a la RPC como lo hace la tienda | La RPC hoy está cubierta por pgTAP y el diálogo por Vitest | responsable de plataforma (cierre de MSF-130) |
| **Respuestas rápidas** y contactos del equipo | F-CON-06 reemplaza la plantilla fija del texto inicial | Consultas y ventas (MSF-144) |
| Reporte de «productos más consultados» | F-REP-04 consume la vista que deja esta épica | Inicio, reportes y rentabilidad |
| Política de retención de las filas de interés (y de las consultas) | Hoy no se borra ni expira nada | Producto |
| Regla de código de país para los teléfonos | El enlace usa los dígitos tal cual; sin regla no se puede corregir el chat | Producto |

Detalle técnico: [Consultas: modelo, RPC y aviso](../tecnico/consultas.md).
