---
owner: producto
sources:
  - specs
---

# Avisos por correo y listas configurables (MSF-189)

**Épica:** MSF-189 · **Historias:** F-NOT-01 (avisos por correo configurables) y F-CFG-01 (listas configurables).
**Spec:** `specs/20261024-120000-avisos-y-listas-configurables/`.

Cada persona elige **qué avisos recibe por correo** y los avisos repetidos llegan **agrupados en un solo
correo**. El Administrador adapta las **listas del negocio**: los motivos de stock y los estados de consulta.

## Qué resuelve

- Antes, el aviso de una consulta nueva salía siempre a una dirección de la empresa y no se podía apagar.
  Ahora cada persona decide qué tipos de aviso quiere, y el sistema deja de enviarle los que apagó.
- Varios avisos del mismo tipo en pocos minutos ya no llenan la casilla: se resumen en un correo.
- Las listas que antes estaban fijas en el código o en otra pantalla se editan desde un solo lugar, sin
  tocar datos ya cargados.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Cualquier usuario con acceso a una sección que genera avisos** | Ver y cambiar sus propios avisos por correo en **Cuenta → Avisos por correo** |
| **Administrador/a** | Editar **Motivos de stock** y **Estados de consulta** en **Administración → Listas configurables** |
| **Operación, Mostrador, Depósito, Técnico, Consulta** | Reciben solo los avisos de las secciones a las que tienen acceso; no editan las listas |

Las preferencias son **de la persona**: no dependen de la empresa activa de la barra superior. Las listas son
**de la organización**: tampoco cambian al cambiar de empresa.

## Avisos por correo

La pantalla vive en **Cuenta → Avisos por correo** (`/cuenta/avisos`).

- Lista **solo los tipos de aviso de las secciones que la persona puede ver**. Un usuario sin acceso a
  Consultas no ve «Consulta nueva».
- Cada tipo tiene un **interruptor**. Si nunca se guardó una preferencia, el tipo aparece **encendido**.
- Al cambiar un interruptor se confirma en pantalla. Si el guardado falla, el interruptor vuelve a como
  estaba y se muestra un mensaje claro; nunca queda en un estado falso.
- Los avisos de **seguridad** de la cuenta (invitación, recuperación de contraseña) **no aparecen** y no se
  pueden apagar: los sigue enviando el servicio de autenticación.
- Los avisos del mismo tipo para la misma persona se agrupan en una **ventana de 15 minutos** (propuesta
  pendiente de confirmar con el cliente). Al vencer, llega **un solo correo** con la cantidad y el detalle de
  cada aviso; un aviso solo llega como correo individual.
- Un tipo apagado **no se envía** y los avisos de ese tipo que ya estaban esperando se descartan antes de
  salir.
- Si el correo falla, se reintenta con espera creciente. Agotados los intentos, el aviso queda **fallido**
  con el error registrado; la operación de la plataforma puede revisarlo. La entrega es **al menos una vez**:
  en una falla poco frecuente podría llegar un correo repetido.

En esta entrega el único tipo registrado es **«Consulta nueva»**. Stock, Precios y dólar y Mercado Libre
registran sus propios tipos en sus épicas; el mecanismo ya queda listo para sumarlos.

## Listas configurables

La pantalla vive en **Administración → Listas configurables** (`/configuracion/listas`) y es **solo para el
Administrador**. Un rol que no administra ve el acceso restringido y la base rechaza la escritura.

| Lista | Qué se puede hacer | Dónde más se edita |
|---|---|---|
| **Motivos de stock** | Agregar, renombrar, elegir a qué movimientos aplica y activar/desactivar | También en **Stock → Motivos** (`/stock/motivos`) |
| **Estados de consulta** | Agregar, renombrar y activar/desactivar | Solo desde esta pantalla |

- El nombre no puede quedar vacío ni repetirse dentro de la lista (sin distinguir mayúsculas ni espacios en
  los extremos).
- Los ítems **no se borran**: se **desactivan**. Un ítem desactivado deja de ofrecerse para nuevas
  selecciones, pero se sigue mostrando en los registros que ya lo usaban, y se puede reactivar.
- **Motivos de stock es la misma lista** que la de Stock: no hay copia ni dos versiones que se puedan
  desincronizar.
- Los **estados de consulta** se pueden crear y ordenar por alta, pero **la bandeja de Consultas todavía usa
  los tres estados fijos** (Nueva, En curso, Resuelta) definidos en MSF-122. La lista existe y se administra,
  pero **todavía no gobierna** las opciones de la bandeja: conectarlas queda como seguimiento.

## Límites y fuera de alcance

- **Campanita de avisos** en la barra superior: es de MSF-224, que reutiliza estos avisos. No se entrega acá.
- **Reordenar o borrar** ítems de las listas: fuera de alcance; los ítems se desactivan.
- **Preferencias por empresa:** se guardan **por persona**, no por persona y empresa. Si más adelante hace
  falta separarlas, se agrega la empresa a la clave con una migración aditiva.
- **Proveedor de correo de negocio:** el envío usa el SMTP genérico de la plataforma; elegir el proveedor
  concreto y su remitente (SPF/DKIM) es una decisión operativa todavía abierta.
- **Ventana de agrupación:** los 15 minutos son una propuesta a confirmar con el cliente.
- **Avisos de seguridad:** siempre se envían y no son configurables.
- **Estados de consulta:** la pantalla no reordena, no borra y todavía no alimenta la bandeja (ver arriba).
- No hay **historial de correos enviados** para el usuario ni una pantalla para reenviar un aviso fallido.

## Estado de la entrega

Implementado en la rama de la épica `epic/MSF-189-plataforma-avisos-y-listas-configurables`, pendiente de
merge a `main` en este repositorio. Cubre las dos historias y el cierre (documentación, grants, seguridad y
recorrido de aceptación).

Detalle técnico: [Avisos y listas: modelo, RPC y flujos](../tecnico/avisos-y-listas.md).
