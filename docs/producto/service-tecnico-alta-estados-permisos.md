---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Service técnico: alta, estados y permisos (MSF-182)

Épica **MSF-182 · Service técnico · Service alta estados y permisos**. Historias: **F-SVC-01** (modelos y
estados configurables, MSF-254), **F-SVC-02** (alta y edición de reparación, MSF-283), **F-SVC-03** (cambio
de estado, historial y entrega, MSF-303) y **F-SVC-05** (permisos y rol Técnico, MSF-324). Spec:
`specs/20261020-100000-service-alta-estados-y-permisos/`. Implementación en la rama
`epic/MSF-182-service-tecnico-service-alta-estados-y-p` (release a STG `00f43e21`, PR #205), **pendiente de
merge a `main`** al momento de esta página. Detalle técnico:
[Service técnico: alta, estados y permisos](../tecnico/service-tecnico-alta-estados-permisos.md).

Esta entrega es la base del módulo: deja configurar el catálogo de equipos y las etapas de la reparación, dar
de alta y editar una reparación, cambiarle el estado con historial, registrar la entrega o anularla, y usar el
rol **Técnico**. El **listado** con filtros, los **ítems de mano de obra y repuestos** y la **impresión** son de
la épica siguiente, [Service técnico: listado, ítems e impresión](service-listado-items-impresion.md) (MSF-199).

## Qué resuelve y para quién

| Persona | Qué puede hacer |
|---|---|
| **Administrador/a** | Configurar modelos y estados, asignar el rol Técnico y operar todo el Service técnico. |
| **Técnico** | Crear y editar reparaciones, cambiar estados, registrar entregas y anular; ve **todas** las reparaciones de sus tiendas accesibles, pero no los costos internos. |
| **Operador** | Opera el Service técnico con el mismo nivel de edición que el Administrador. |
| **Mostrador, Administración y Consulta** | Ven las reparaciones, modelos y estados, y el historial, pero no crean ni modifican nada. |
| **Depósito** | Sin acceso a Service técnico. |

La sección de permisos `service_tecnico` es **por organización**, no por empresa: el rol no cambia al elegir
otra tienda. Lo que sí es por empresa es la **reparación**: cada una pertenece a la tienda que recibió el
equipo y lleva la numeración de esa tienda.

## Modelos de equipo

`/service-tecnico/modelos` muestra la tabla **Equipo**, **Modelo**, **Mano de obra base**, **Reparaciones**,
**Activo** y, con permiso de edición, la acción **Editar**.

- **Nuevo modelo** pide Equipo, Modelo y Mano de obra base (ARS, sin IVA). Equipo + Modelo no se repiten en la
  organización, aunque estén desactivados; el error se muestra en el campo.
- La mano de obra base pertenece al modelo; los costos internos de cada reparación se cargan aparte en el
  detalle.
- Cada organización recibe **siete modelos iniciales** (Nintendo Switch Estándar, Lite y OLED; Joystick Pro
  Controller y Joy-Con par; PlayStation 4 Slim —inactivo— y PlayStation 5 Estándar). El sembrado es idempotente
  y no pisa lo que la organización ya editó; el modelo propio se agrega desde la pantalla.
- La columna **Reparaciones** indica cuántas reparaciones usan cada modelo. Al **desactivar uno en uso** se
  avisa con esa cantidad y se pide confirmación; las reparaciones existentes lo conservan y deja de ofrecerse
  en altas nuevas.
- Con nivel de **lectura** la tabla se ve, pero no los botones de alta, edición ni el switch.
- **Fuera de alcance:** «Disponible en» por tienda. Los modelos son de toda la organización.

## Estados de reparación

`/service-tecnico/estados` muestra **Orden** (con Subir/Bajar), **Estado**, **Qué significa**,
**Reparaciones**, **Avisa al cliente**, **Cierra la reparación** y **Activo**.

- **Nuevo estado** pide Nombre, «Qué significa» y «Avisar al cliente al pasar a este estado». El nombre no se
  repite en la organización, aunque el estado esté desactivado.
- El **orden** define el flujo; se cambia con Subir/Bajar y se guarda en el servidor de forma atómica.
- **Avisa al cliente** y **Cierra la reparación** solo se guardan y se muestran: esta épica **no envía ningún
  aviso**. Un estado que cierra solo se alcanza registrando la entrega.
- Se siembran **siete estados**: Recibido, En diagnóstico, Esperando repuesto, En reparación, Listo para
  entregar, Entregado y Sin reparación. Cierran «Entregado» y «Sin reparación». El **octavo estado** que
  menciona la épica queda a definir con el cliente y se agrega desde la pantalla, sin migración.
- La columna **Reparaciones** y el aviso al desactivar en uso funcionan igual que en Modelos.
- Con **lectura** se ven la tabla y los valores, sin Subir/Bajar, switch de aviso, switch de activo ni Editar.

## Alta y edición de una reparación

`/service-tecnico/reparaciones/nueva` y `/service-tecnico/reparaciones/:id` comparten el formulario.

- **Cliente y equipo:** Tienda (por defecto, la empresa activa; en el alta se puede elegir otra tienda
  accesible), Cliente, Contacto, Consola o equipo, Modelo, N.º de serie (opcional), Accesorios recibidos y
  Falla informada.
- **Cliente:** se busca entre los clientes de la organización. Si no existe y la persona puede editar
  Clientes, **Nuevo cliente** abre el alta rápida con Nombre o razón social, Celular y Correo; reutiliza el
  alta de Clientes y deja el cliente elegido en la reparación. Al elegirlo, **Contacto** se completa con el
  celular, si no el teléfono y si no el correo, y queda editable.
- **Técnico y fechas:** Técnico (usuarios activos con edición en Service técnico), Ingreso y Entrega
  prevista. La **Entrega real** se muestra de solo lectura y la completa el diálogo de entrega.
- **Costo interno:** Costo mano de obra y Costo repuestos, en ARS sin IVA. Solo se ven y editan con la acción
  `ver_costos`; la base los devuelve nulos y rechaza escrituras sin esa acción.
- Al guardar, la reparación recibe el **próximo número de su tienda** (`R-0001`), el **primer estado activo**
  (Recibido) y la **fecha de ingreso de hoy** (hora de Argentina). La numeración es independiente por empresa
  y no tiene saltos ni repetidos aunque haya altas simultáneas.
- Si otra persona guardó antes, la pantalla avisa «Otra persona modificó esta reparación…» y ofrece recargar;
  no pisa el cambio.
- Una reparación **anulada** se ve marcada y de solo lectura; no se edita, no cambia de estado y no se entrega.
- Con **lectura** se ve el detalle, pero no se ofrece Guardar ni el alta.
- La **pestaña Reparaciones** de esta entrega solo ofrece «Nueva reparación» y lleva al detalle creado. El
  listado, los KPIs y los filtros llegan con MSF-199.

## Estado, historial, entrega y anulación

En el detalle de la reparación:

- **Estado:** selector con los estados activos y el «Qué significa» del elegido. Cambiar de estado deja un
  evento en el **Historial de estados** (estado · fecha · usuario, del más reciente al más antiguo). Elegir
  el mismo estado no duplica el historial.
- Se puede pasar a cualquier estado **activo**, también hacia atrás para corregir. Un estado que **cierra**
  no se elige desde el selector: abre el diálogo de **Entrega**.
- **Entrega:** pide la fecha (no anterior al ingreso ni futura) y quién retira o recibe el equipo. Al
  confirmar, guarda la Entrega real, cambia al estado que cierra y deja el evento en el historial.
- **Anulación:** pide un motivo obligatorio y avisa que es **irreversible**. La reparación queda marcada como
  anulada, de solo lectura, y el motivo aparece en el historial.
- Después de entregar o anular no se admiten más cambios de estado. Desactivar un estado no cambia las
  reparaciones que ya lo tienen (se muestra como desactivado).
- Con **lectura** se ven el estado y el historial, sin selector, entrega ni anulación.

## Permisos y rol Técnico

El rol **Técnico** es nuevo y se asigna desde **Usuarios → Editar usuario**. Su matriz es **fija** en el
lanzamiento: se muestra como columna en **Roles y permisos**, pero no se edita.

| Sección | Técnico |
|---|---|
| Service técnico | Edición |
| Inicio | Solo lectura |
| Clientes | Solo lectura |
| Productos | Solo lectura |
| Stock | Solo lectura |
| Resto de las secciones | Sin acceso |

El Técnico **no** tiene las acciones Eliminar, Exportar ni Ver costos. En Service técnico ve todas las
reparaciones de sus tiendas accesibles, pero los costos internos quedan ocultos. El Total al cliente es de
MSF-199; la ganancia estimada sigue exigiendo `ver_costos`. La matriz del resto de los roles no cambia y la
edición de esas columnas sigue como estaba (F-ROL-02). La migración del rol se aplica a organizaciones
existentes y a las nuevas.

## Empresa activa y alcance por tienda

**Empresa activa: aplica.** Service técnico es una sección **por organización**, así que el nivel de permiso
no cambia al cambiar de tienda; lo que cambia es el alcance de los datos:

- En una **reparación nueva**, la **Tienda** arranca con la empresa activa y se puede elegir otra tienda
  accesible. En la edición, la Tienda no se cambia: la numeración y la pertenencia quedaron fijadas en el alta.
- Solo se ven y se pueden abrir reparaciones de **tiendas accesibles** (con el rol de empresa que
  corresponda). Una reparación de otra tienda se trata como inexistente.
- Al **cambiar la empresa activa** con una pantalla abierta, la pantalla se vuelve a montar: se recargan los
  datos y la selección, se descartan las filas de la empresa anterior y un diálogo abierto se cierra. El alta
  nueva toma la nueva empresa activa como Tienda por defecto.
- Modelos, estados y el rol Técnico **no** dependen de la empresa activa: son de toda la organización.

## Límites y fuera de alcance

| Tema | Estado |
|---|---|
| Listado de reparaciones, KPIs y filtros por período/serie/técnico | Fuera de alcance: MSF-199, ya construido en su rama. |
| Mano de obra y repuestos, Total al cliente, ganancia estimada e impresión | Fuera de alcance: MSF-199. |
| Aviso real al cliente de los estados con «Avisa al cliente» | Fuera de alcance: solo se guarda el indicador; MSF-232. |
| Descuento de repuestos del depósito y stock | Fuera de alcance: MSF-217. |
| Catálogo de servicios de mano de obra (`ServicioCatalogo`) | Fuera de alcance: ninguna historia de la épica lo pide. |
| «Disponible en» por tienda para los modelos | Fuera de alcance: los modelos son por organización. |
| Edición de la matriz del rol Técnico | Fuera de alcance: matriz fija en el lanzamiento. |
| Migración de reparaciones históricas | Fuera de alcance: la carga inicial es de otra épica. |
| Reabrir una reparación entregada o anulada | No existe: entregadas y anuladas quedan cerradas. |
| Octavo estado y su mensaje | Pendiente de definición del cliente; se carga desde la pantalla. |
| Ver solo las reparaciones asignadas al Técnico | Hoy el Técnico ve todas las de sus tiendas accesibles; decisión de producto pendiente. |

## Pendientes con dueño

- **Octavo estado y su mensaje:** definir con el cliente y cargarlo desde Estados. Dueño: Producto / negocio.
- **Reapertura de una reparación entregada:** hoy no se puede. Si el taller la necesita, es un cambio chico en
  la RPC de estado. Dueño: Producto.
- **Alcance del Técnico:** confirmar si debe seguir viendo todas las reparaciones o solo las asignadas, y si
  corresponde que vea algún importe. Dueño: Producto.
- **Reparaciones históricas:** definir la carga inicial en la épica de migración. Dueño: Producto / Migración.
- **Stock y avisos reales:** los cubren MSF-217 y MSF-232.

> **Revisión de fuentes:** 2026-10-26 — documentación de la épica MSF-182; se verificaron las migraciones
> `supabase/migrations/20261020*`, la UI de `apps/web/src/pages/service-tecnico/` y las pruebas pgTAP/Vitest de
> la rama de la épica.
