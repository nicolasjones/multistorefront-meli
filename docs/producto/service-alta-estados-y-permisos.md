---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Service técnico: alta, estados y permisos (MSF-182)

Épica **MSF-182 · Service técnico · Service alta estados y permisos**. Historias: **F-SVC-01** (modelos y estados
configurables), **F-SVC-02** (alta y edición de reparación), **F-SVC-03** (cambio de estado, historial y entrega)
y **F-SVC-05** (permisos y rol Técnico). Spec: `specs/20261020-100000-service-alta-estados-y-permisos/spec.md`
(rama `epic/MSF-182-service-tecnico-service-alta-estados-y-p`). Detalle técnico:
[Service técnico: alta, estados y permisos](../tecnico/service-alta-estados-y-permisos.md).

Esta épica es la base del Service técnico: sin alta ni estados no hay service. Las épicas siguientes la completan
([listado, ítems e impresión](service-listado-items-impresion.md), [repuestos y stock](service-repuestos-y-stock.md),
[cobro y avisos](service-cobro-y-avisos.md)).

## Qué resuelve y para quién

| Persona | Qué puede hacer |
|---|---|
| **Técnico** (rol nuevo) | Dar de alta y editar reparaciones, cambiar su estado, registrar la entrega y anularlas. Ve todas las reparaciones de la organización, pero no los costos internos. |
| **Administrador / Operador** | Todo lo anterior y además configurar modelos y estados. |
| **Consulta, Mostrador, Administración** | Ver Service técnico (`lectura`); no ven controles de escritura. |
| **Depósito** | Sin acceso a Service técnico (`ninguno`). |

- **Modelos de equipo y estados de reparación** son configurables y valen para **toda la organización**; la
  **numeración** (`R-0001`, `R-0002`…) es **por empresa**. Cada organización arranca con siete modelos y siete
  estados del panel actual.
- **Alta de reparación:** cliente (con alta rápida si no existe), equipo, modelo, N.º de serie, accesorios, falla,
  técnico y fechas. La Tienda por defecto es la empresa activa.
- **Estado con historial:** se puede pasar a cualquier estado activo, también hacia atrás; cada cambio queda con
  estado anterior, nuevo, usuario y fecha. Elegir el estado actual no duplica el historial.
- **Entrega:** al elegir un estado que cierra («Entregado», «Sin reparación») se pide fecha y quién entregó.
- **Anulación:** con motivo obligatorio; la reparación queda de solo lectura y no se revierte.
- **Costos internos** (mano de obra y repuestos): solo los ven y cargan quienes tienen la acción `ver_costos`.
- **Desactivar un modelo o estado en uso** avisa cuántas reparaciones lo usan y pide confirmación; las
  reparaciones existentes no cambian.
- **Rol Técnico:** `service_tecnico` = edición; Inicio, Clientes, Productos y Stock = lectura; el resto, ninguno.
  Sin eliminar, exportar ni ver costos. La matriz es **fija** (la edición de la matriz es de enero).

### Empresa activa

La pantalla de Reparaciones/alta usa la empresa activa como **Tienda** por defecto de la reparación nueva; los
modelos y estados son de la organización (Empresa activa: no aplica a Modelos ni Estados, no son datos de
empresa). `service_tecnico` es una sección a nivel organización.

## Límites y fuera de alcance

- «Disponible en» (modelos por tienda): fuera de alcance; los modelos son de la organización.
- **Listado de reparaciones** con filtros, ítems e impresión: MSF-199. Aquí la pestaña Reparaciones solo ofrece
  «Nueva reparación».
- **Avisos reales al cliente:** los indicadores «Avisa al cliente» y «Cierra la reparación» se guardan y se muestran,
  pero esta épica **no envía ningún aviso**.
- **Matriz de permisos editable:** enero (MSF-121 / F-ROL-02).
- Migración de reparaciones históricas del panel actual y apagado del panel (31/12): no se especifican aquí
  (TODO dueño: Nicolás, decisión de negocio).
- La lista completa de estados con su mensaje se define con el cliente (TODO dueño: Nicolás).

## Cómo probarlo

### Prerrequisitos

- Entorno DEV o local (`pnpm dev:supabase` y la app), funcionalidad `service-tecnico` encendida para la organización.
- Un usuario **Administrador** y otro con rol **Técnico**; otro con **Consulta** (`lectura`).
- Un cliente existente en Clientes y una empresa activa elegida en la barra superior.
- Los modelos y estados iniciales se siembran solos.

### Pasos

1. Entrá como Administrador a `/service-tecnico/modelos`. Debés ver la tabla Equipo, Modelo, Mano de obra base,
   Reparaciones y Activo con los siete modelos. Tocá «Nuevo modelo», completá Equipo, Modelo y mano de obra base y
   «Crear modelo»: aparece «Modelo creado» y la fila nueva.
2. Repetí el mismo equipo y modelo: el diálogo muestra el error de duplicado en el campo.
3. En `/service-tecnico/estados` usá Subir/Bajar sobre un estado: el orden cambia y persiste al recargar. Creá un
   estado con «Nuevo estado».
4. En `/service-tecnico/reparaciones` tocá «Nueva reparación». Elegí Cliente (o creá uno con el alta rápida:
   queda seleccionado), completá equipo, modelo, N.º de serie y «Guardar». Debés llegar al detalle `R-000N` con el
   primer estado activo y la entrada «alta» en el historial.
5. Creá otra reparación en la misma empresa: el número es el siguiente, sin saltos. Con otra empresa activa, la
   numeración es independiente.
6. En el detalle cambiá el Estado a otro: el historial suma una fila (estado · fecha · usuario, la más reciente
   primero). Volvé a elegir el estado actual: no se agrega fila.
7. Elegí «Entregado»: se abre el diálogo de entrega. Sin «quién entregó» muestra error; con fecha y entregador
   guarda, queda «Entrega real» y el historial registra la entrega.
8. En otra reparación tocá «Anular», dejá el motivo vacío (error), luego cargalo: queda marcada como anulada y
   todos los campos de solo lectura.
9. Volvé a Modelos y apagá el switch Activo de un modelo usado: aviso con la cantidad de reparaciones y pedido de
   confirmación.
10. Entrá como Técnico: puede crear, cambiar estado y entregar, pero no ve Costo mano de obra / Costo repuestos.
    En `/roles` aparece la columna «Técnico» sin edición y en Usuarios «Técnico» es asignable.
11. Entrá como Consulta: ve las pantallas sin botones de crear, editar, mover, entregar ni anular.

### Resultado esperado

- **Given** una organización con Service técnico encendido, **When** el taller da de alta una reparación con
  cliente, equipo y N.º de serie, **Then** queda numerada por empresa con su primer estado y su historial.
- **Given** una reparación abierta, **When** se cambia el estado o se entrega, **Then** el historial lo registra y
  la entrega guarda fecha y entregador; una reparación entregada o anulada ya no cambia de estado.
- **Given** un Técnico o un usuario de solo lectura, **Then** el sistema respeta su nivel: el Técnico edita sin ver
  costos y `lectura` no escribe.

### Cómo automatizarlo

Pendiente de automatizar. La spec prevé un E2E `apps/web/e2e/service-tecnico.e2e.ts` (tarea T039 de
`specs/20261020-100000-service-alta-estados-y-permisos/tasks.md`) que crea una reparación, la pasa por tres estados
y la entrega; rótulo previsto `[MSF-182:T039]`. Los pasos 1–3, 9 y 10–11 no tienen E2E previsto (los cubren
Vitest y pgTAP: T012, T027, T038, T044).
