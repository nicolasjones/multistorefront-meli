---
owner: producto
sources:
  - specs
  - apps/web/src/pages/usuarios
  - apps/web/src/pages/roles
  - apps/web/src/pages/acceso-restringido
---

# Usuarios y roles (MSF-125)

**Épica:** MSF-125 · Acceso, organización y permisos. **Spec:** `specs/20261013-120000-usuarios-y-roles/spec.md`.
**Historias:** F-ROL-01, F-ROL-03, F-USR-01, F-USR-02, F-ROL-02. Construcción interna: [Usuarios y roles (técnico)](../tecnico/usuarios-y-roles.md).

## Qué resuelve

Un administrador invita, edita y suspende personas, y cada rol ve y hace solo lo que le corresponde, en pantalla y en la base de datos. El Administrador de cada organización ajusta qué puede hacer cada rol sin tocar código.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Administrador/a** | Invita, edita, suspende y reactiva personas; edita la matriz de permisos de su organización. No se lo puede restringir: siempre tiene edición en todas las secciones. |
| **Operador, Consulta, Mostrador, Depósito, Administración** | Ven y operan las secciones que la matriz de su organización les da (Edición, Solo lectura o Sin acceso). Las secciones sin acceso no aparecen en el menú. |
| **Técnico** | Rol de Service técnico (MSF-182): edita reparaciones, modelos y estados; ve Inicio, Clientes, Productos y Stock en solo lectura. Detalle: [Service técnico: alta, estados y permisos](service-tecnico-alta-estados-permisos.md). |
| **Persona invitada** | Recibe un correo, define su contraseña («Fuiste invitado como <rol>») y entra con el rol invitado. |

## Qué incluye

- **Seis roles de negocio** (`administrador`, `operador`, `consulta`, `mostrador`, `deposito`, `administracion`) con permisos por **sección** (16) y por **acción** (eliminar, exportar, ver costos). El rol **Técnico** de Service técnico se suma con MSF-182. Cada organización tiene su propia matriz; los valores iniciales salen de `Roles.dc.html`. Contrato para las demás épicas: [Permisos por rol](../permisos-por-rol.md).
- **Pantalla Roles y permisos** (`/roles`): grilla editable 16×6, columna Administrador bloqueada, «Guardar cambios» y «Restablecer valores iniciales». Con MSF-182 suma la columna **Técnico**, que es fija (no editable).
- **Pantalla Usuarios** (`/usuarios`): listado con estado y último acceso, diálogos «Invitar usuario», «Editar usuario» y «Suspender usuario», acción «Reactivar». Absorbe a la pantalla Miembros (`/miembros` redirige).
- **Invitaciones**: vencen a los **7 días**; se pueden reenviar y cancelar. Detalle: [Invitar usuarios](../invitar-usuarios.md).
- **Suspensión**: una persona suspendida pierde el acceso en la base de datos; reactivarla lo restituye. Siempre debe quedar al menos un Administrador.
- **Acceso restringido**: quien abre por URL una sección sin acceso ve «No tenés acceso a esta sección» con su rol y la sección reales, sin que se carguen datos.

## Varias tiendas por persona (MSF-121)

Una organización con más de una empresa puede dar a la misma persona un **rol distinto en cada tienda**
(por ejemplo, Operador en San Javucho y Consulta en Mundo JC), sin duplicar cuentas. Se administra desde
los diálogos Invitar y Editar usuario, en la lista de Usuarios se ve «Tienda: Rol», y la persona elige con
qué tienda trabaja desde el selector de la barra superior. El panel y la base aplican el rol de esa tienda
en Ventas, Consultas y Reportes; en las secciones compartidas (Productos, Stock, Clientes, Proveedores,
Cotización) rige el mejor rol que la persona tenga entre sus tiendas. Detalle:
[Usuarios y empresas](../usuarios-y-empresas.md) · [Empresa activa](../empresa-activa.md).

**Límites:** una persona sigue perteneciendo a **una sola organización**; el Administrador de la
organización accede siempre a todas las empresas; no hay Administrador limitado a una tienda. Las reglas
por empresa en Ventas, Consultas y Reportes llegan con sus épicas (MSF-139, MSF-275, MSF-156). Service
técnico usa la empresa activa para la tienda de cada reparación, pero su permiso es por organización
(MSF-182).

## Límites y fuera de alcance

- Una persona pertenece a **una sola organización**. El rol por empresa y la asignación de tiendas son de MSF-121 (ver arriba).
- «Solicitar acceso» desde la pantalla restringida es de MSF-148 (F-ROL-05): [Solicitar acceso](../solicitar-acceso.md).
- Los valores iniciales de las **acciones** y el diálogo de «Restablecer valores iniciales» **no están dibujados** en el prototipo: son propuestas a confirmar con el cliente (TODO dueño: producto).
- «Ver permisos de este rol →» del diálogo Invitar queda oculto hasta activarse (`PERMISOS_POR_ROL_DISPONIBLE`; TODO dueño: desarrollo).
- Pruebas E2E de editar/suspender, matriz y acceso restringido: no hay suite Playwright de la app; se cubrió con Vitest y pgTAP. Deuda trazada en **MSF-499**.
- Restablecer la contraseña de otra persona (F-USR-03) es de MSF-132: ver [Invitar usuarios](../invitar-usuarios.md).

## Administración de usuarios y organización (MSF-132)

- **Qué resuelve:** el administrador edita el nombre, el logo y la zona horaria de su organización en «Mi organización» (F-ORG-03) y, desde Usuarios, envía a otra persona el enlace para definir una contraseña nueva (F-USR-03). Detalle: [Administración de la organización](../administracion-organizacion.md) y [técnico](../tecnico/administracion-organizacion.md).
- **Para quién:** solo el administrador; operador, consulta y suspendidos no pueden editar.
- **Límites:** el administrador nunca ve ni fija la contraseña; a un usuario suspendido no se le ofrece el enlace (hay que reactivarlo antes). El alta de empresas no está acá (MSF-475). Ninguna de las dos pantallas está dibujada en el prototipo.
- **Fuera de alcance:** E2E de ambos flujos (MSF-499) y limpieza automática de logos huérfanos (sin historia todavía).
