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
| **Persona invitada** | Recibe un correo, define su contraseña («Fuiste invitado como <rol>») y entra con el rol invitado. |

## Qué incluye

- **Seis roles de negocio** (`administrador`, `operador`, `consulta`, `mostrador`, `deposito`, `administracion`) con permisos por **sección** (16) y por **acción** (eliminar, exportar, ver costos). Cada organización tiene su propia matriz; los valores iniciales salen de `Roles.dc.html`. Contrato para las demás épicas: [Permisos por rol](../permisos-por-rol.md).
- **Pantalla Roles y permisos** (`/roles`): grilla editable 16×6, columna Administrador bloqueada, «Guardar cambios» y «Restablecer valores iniciales».
- **Pantalla Usuarios** (`/usuarios`): listado con estado y último acceso, diálogos «Invitar usuario», «Editar usuario» y «Suspender usuario», acción «Reactivar». Absorbe a la pantalla Miembros (`/miembros` redirige).
- **Invitaciones**: vencen a los **7 días**; se pueden reenviar y cancelar. Detalle: [Invitar usuarios](../invitar-usuarios.md).
- **Suspensión**: una persona suspendida pierde el acceso en la base de datos; reactivarla lo restituye. Siempre debe quedar al menos un Administrador.
- **Acceso restringido**: quien abre por URL una sección sin acceso ve «No tenés acceso a esta sección» con su rol y la sección reales, sin que se carguen datos.

## Límites y fuera de alcance

- Una persona pertenece a **una sola organización**. El rol por empresa y la asignación de tiendas son de MSF-121; allí el selector ofrece los seis roles.
- «Solicitar acceso» desde la pantalla restringida es de MSF-148 (F-ROL-05): [Solicitar acceso](../solicitar-acceso.md).
- Los valores iniciales de las **acciones** y el diálogo de «Restablecer valores iniciales» **no están dibujados** en el prototipo: son propuestas a confirmar con el cliente (TODO dueño: producto).
- «Ver permisos de este rol →» del diálogo Invitar queda oculto hasta activarse (`PERMISOS_POR_ROL_DISPONIBLE`; TODO dueño: desarrollo).
- Pruebas E2E de editar/suspender, matriz y acceso restringido: no hay suite Playwright de la app; se cubrió con Vitest y pgTAP. Deuda trazada en **MSF-499**.
- Restablecer la contraseña de otra persona (F-USR-03) es de MSF-132: ver [Invitar usuarios](../invitar-usuarios.md).
