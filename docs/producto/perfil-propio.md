---
owner: producto
sources:
  - specs
  - apps/web/src/pages/cuenta
  - apps/web/src/lib/passwordPolicy.ts
---

# Perfil propio y cambio de contraseña (MSF-148 · F-PRF-01)

**Épica:** MSF-148 · **Historia:** F-PRF-01 (MSF-290).
**Spec:** `specs/20261016-130000-perfil-y-permisos-avanzados/spec.md`.
**Origen:** el perfil y el cambio de contraseña ya venían del template (spec 008, `pages/cuenta/perfil` y
`pages/cuenta/cambiar-contrasena`). Esta épica **verifica la aceptación y ajusta textos**, sin reconstruir
la pantalla ni cambiar el esquema.

## Qué resuelve

- Cada persona autenticada mantiene al día **su nombre, su apellido y su foto** sin pedirle nada a un
  administrador.
- El **cambio de contraseña** exige la contraseña actual: una contraseña actual vacía o incorrecta no
  modifica la credencial.
- La contraseña nueva cumple una regla única y visible en pantalla: **12 caracteres como mínimo, con
  mayúscula, minúscula, número y símbolo**.
- El perfil no permite cambiar el **rol, la organización ni la pertenencia** de la persona. El cambio de
  correo tiene su propio flujo seguro y los avisos de seguridad se consultan en la misma pantalla.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Cualquier usuario autenticado** | Editar su nombre, apellido y foto; cambiar su contraseña; consultar los datos de su cuenta y sus últimas 20 acciones de seguridad |
| **Administrador/a** | No interviene: no hay que resetear datos personales ni contraseñas desde Usuarios para este caso |
| **Persona sin sesión** | No accede: la pantalla redirige al ingreso y no expone datos personales |

## Cómo se usa

### Perfil

Se llega desde **«Ver mi perfil»** en la pantalla general o desde **Cuenta → Perfil** en la barra superior
(`/cuenta/perfil`).

- **Datos personales:** nombre y apellido son obligatorios (se recortan los espacios); la foto se carga o se
  reemplaza y también se puede quitar. Se aceptan **JPG, PNG o WebP de hasta 2 MiB**; sin foto se muestra la
  inicial del nombre o del correo.
- **Datos de cuenta:** correo, fecha de creación, organización y rol se muestran **solo para lectura**.
- **Seguridad:** accesos a «Cambiar contraseña» y «Cambiar correo electrónico», más las **últimas 20
  acciones de seguridad** de la cuenta (inicios de sesión, contraseña y correo modificados).
- Al guardar se confirma «Tus datos personales fueron guardados»; si falta nombre o apellido se avisa y no
  se guarda nada.

### Cambio de contraseña

La pantalla vive en `/cuenta/cambiar-contrasena` y pide **contraseña actual, nueva y confirmación**.

1. La contraseña nueva se valida contra la regla antes de llamar a Supabase Auth.
2. La contraseña actual se verifica contra Auth; si no coincide, se avisa y se ofrece **«Recuperar acceso»**.
   La contraseña anterior sigue vigente.
3. Con la actual correcta y la nueva válida, se actualiza la credencial y se **cierran las demás sesiones**
   de la cuenta. La sesión actual vuelve al inicio.

## Reglas y límites

- **La regla de contraseña está a confirmar con el cliente.** Se centraliza en
  `apps/web/src/lib/passwordPolicy.ts`; ajustarla no requiere tocar cada pantalla. Dueño: Nicolás / Producto.
- **La pantalla de perfil no está dibujada en el prototipo.** Se usa la pantalla del template con el sistema
  de diseño; la estética no se inventó desde el prototipo. Validación visual pendiente: Producto.
- **El perfil no administra permisos.** Cambiar el rol o la organización es una acción de Administrador en
  Usuarios y permisos, no del titular.
- **No hay cambios de base de datos ni de contrato** por esta historia: `perfiles_usuario`,
  `eventos_seguridad_usuario` y el bucket `fotos-perfil` son del template/spec 008. La entrega son textos y
  pruebas de aceptación.
- **Fuera de alcance:** administrar sesiones activas, cerrar sesiones de otros o cambiar el correo desde el
  perfil (el correo tiene su flujo aparte).
- **Empresa activa: no aplica.** El perfil es de la persona y no filtra ni escribe datos por empresa; cambiar
  la empresa de la barra superior no altera esta pantalla.

## Estado

Verificado con Vitest: `apps/web/src/pages/cuenta/perfil.test.tsx`,
`apps/web/src/pages/cuenta/cambiar-contrasena.test.tsx` y
`apps/web/src/lib/passwordPolicy.test.ts`. El detalle de implementación está en
[Perfil y permisos avanzados (técnico)](../tecnico/perfil-y-permisos.md).

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
