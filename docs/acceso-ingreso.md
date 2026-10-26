---
owner: producto
sources:
  - specs
---

# Acceso: ingreso, recuperación y sesión (MSF-119)

Épica **MSF-119 · Acceso, organización y permisos · Acceso y organización**. Spec:
`specs/20261012-140000-acceso-y-organizacion/`. Historias: F-ACC-01 (ingreso), F-ACC-02 (recuperar y definir
contraseña), F-ACC-03 (cierre y vencimiento de sesión) y F-ORG-01 (aislamiento por organización).

Detalle técnico (modelo, contratos, pruebas y operación): [Acceso y organización (técnico)](tecnico/acceso.md).

## Qué resuelve

Que una persona invitada **entre al panel, recupere su contraseña, cierre sesión y solo vea los datos de su
organización**. Sin esto, el equipo no puede usar el panel: no hay registro propio (toda cuenta llega por
invitación) y no hay forma de recuperar el acceso sin intervención de un administrador.

Es **adecuación sobre el template**, no construcción: el login, las rutas protegidas, la invitación, definir y
recuperar contraseña y el aislamiento por RLS ya venían del template (specs 003 y 006). Esta épica ajusta textos,
reglas y el menú de cuenta, y agrega lo que faltaba: estado de la membresía, «Mantener la sesión iniciada», bloqueo
por intentos fallidos, vencimiento de sesión por inactividad, las reglas de contraseña del producto y la prueba
que exige RLS en toda tabla nueva.

## Supuestos vigentes (a confirmar con el cliente)

| Supuesto | Valor | Dónde se aplica |
|---|---|---|
| S1 · Bloqueo por intentos | 5 fallos por correo → 15 min de espera | `public.intentos_acceso` + Auth Hook |
| S2 · Contraseña | 12+ caracteres, mayúscula, minúscula, número y símbolo | `apps/web/src/lib/passwordPolicy.ts` |
| S3 · Enlaces de recuperación | de un solo uso, vencen a la hora | `supabase/config.toml` (`otp_expiry = 3600`) |
| S4 · Sesión | 12 h de inactividad; 30 días con «Mantener la sesión iniciada» | `apps/web/src/lib/vencimientoSesion.ts` + `[auth.sessions] timebox = "720h"` |
| S5 · Membresía | una persona pertenece a una sola organización | `user_id` es clave primaria de `usuarios_organizacion` |

Todos son **supuestos a confirmar con el cliente**: viven como configuración, no como código disperso.

## Ingreso con correo y contraseña (F-ACC-01)

**Pantalla**: «Ingresar» con correo electrónico, contraseña, la casilla «Mantener la sesión iniciada», el enlace
«¿Olvidaste tu contraseña?» y el botón «Ingresando...» mientras espera. No hay registro propio: toda cuenta llega
invitada.

**Qué ve la persona si algo sale mal** (los mensajes son idénticos a propósito, para no revelar si un correo
existe):

| Situación | Qué ve |
|---|---|
| Correo o contraseña incorrectos | «Revisá el correo y la contraseña e intentá de nuevo.» |
| Cuenta suspendida | Lo mismo que arriba, y su sesión se cierra: no entra ni conserva acceso. |
| 5 intentos fallidos | «Demasiados intentos. Esperá unos minutos antes de volver a intentar.» No puede entrar ni con la contraseña correcta hasta que pasan los 15 minutos. |
| Problema del servicio (red caída, saturación) | «No pudimos verificar tu ingreso por un problema del servicio. Intentá de nuevo en unos minutos.» No cuenta como fallo. |

El aviso aparece como notificación de la pantalla, no como un bloque de error dentro del formulario.

**«Mantener la sesión iniciada»**: sin la casilla, la sesión muere al cerrar la pestaña; con la casilla, sobrevive
al cierre del navegador y dura hasta 30 días.

**Rutas protegidas**: quien abre una pantalla del panel sin sesión es llevado al ingreso; al volver a atrás no ve
datos.

## Recuperar y definir contraseña (F-ACC-02)

- **Pedir el enlace**: la respuesta es siempre la misma, exista o no la cuenta: «Si existe una cuenta para ese
  correo, enviamos un enlace para continuar.» Un enlace vencido o ya usado avisa «El enlace vencio o ya se uso.
  Solicita uno nuevo para continuar.» y permite pedir otro.
- **Definir la contraseña**: la pantalla muestra cada regla con su estado (cumple o falta) y pide confirmación:
  12+ caracteres, una mayúscula, una minúscula, un número y un símbolo. Si las contraseñas no coinciden, avisa
  «Las contraseñas no coinciden.» y no cambia nada.
- **El mismo flujo sirve para una invitación**: a quien fue invitado le aparece además el rol con el que entra.
  Detalle: [Invitar usuarios](invitar-usuarios.md).
- **Caducidad**: el enlace dura una hora y sirve una sola vez.

## Cierre y vencimiento de sesión (F-ACC-03)

- **«Cerrar sesión»** está en el menú de cuenta de la barra superior, junto a Perfil, Cambiar contraseña y Cambiar
  correo electrónico. Cierra la sesión y vuelve al ingreso.
- **Vencimiento por inactividad**: sin «Mantener la sesión iniciada», la sesión se cierra a las 12 horas sin
  actividad y hay que ingresar de nuevo. Con la casilla, la sesión dura hasta 30 días.
- **Suspensión**: al pasar la cuenta de una persona a «suspendido», su sesión abierta se corta y no puede seguir
  leyendo datos.

## Aislamiento por organización (F-ORG-01)

Cada persona ve **únicamente los datos de su organización**. No es una convención: una prueba automática recorre
todas las tablas expuestas y **falla si alguna queda sin protección**, así que no se puede entregar una tabla
nueva expuesta sin RLS. Un usuario sin membresía o suspendido no ve ninguna fila.

La regla para escribir una tabla nueva está en [Aislamiento por organización](aislamiento-por-organizacion.md).

## Límites y fuera de alcance

- **Empresa activa: no aplica.** Las pantallas de esta épica (ingreso, recuperación, definición de contraseña y
  menú de cuenta) son previas a la sesión: no leen ni escriben datos de empresa, y por eso no muestran selector de
  empresa. La empresa activa es un concepto de la sesión del panel (MSF-121 · F-ROL-06) y se documenta en
  [Empresa activa](empresa-activa.md).
- Un usuario pertenece a **una sola** organización (`user_id` es clave primaria). En el lanzamiento hay una
  organización con dos empresas.
- **Administrar el estado (activo/suspendido) desde pantalla** es de la épica MSF-125 (F-USR-02), no de esta.
- **Alta de organizaciones nuevas** es de la épica MSF-162 (F-ORG-02), no de esta.
- **La cuenta web del cliente** es otra épica (MSF-237) y tiene su propio ingreso: [Cuenta web del cliente
  (producto)](producto/cuenta-web-cliente.md).
- El bloqueo por intentos se aplica por correo: cualquiera puede pedir el bloqueo del correo de otra persona
  durante 15 minutos. Es un riesgo aceptado y documentado.
- El mensaje de bloqueo **no** dice cuántos intentos faltan: la cifra daría información al atacante.

## Pendientes

- **Valores de bloqueo, caducidad de enlaces y duración de sesión**: a confirmar con el cliente. Dueño: Producto.
- **Plan de Supabase**: confirmar que el plan contratado admite el tope de sesión de 30 días antes de producción.
  Dueño: responsable de plataforma. Detalle y checklist: [Acceso y organización (técnico)](tecnico/acceso.md#operacion-limites-y-pendientes).
- **Activación del bloqueo por intentos en cada entorno**: el hook se habilita en la configuración del entorno, no
  por migración; checklist en
  [Acceso y organización (técnico)](tecnico/acceso.md#activacion-por-entorno-checklist) y en
  [Entornos y despliegue](deployment.md).
- **Pantallas públicas sin prototipo**: las pantallas de ingreso, recuperación y definición de contraseña se
  construyeron con el sistema de diseño; falta que Producto las valide contra el prototipo. Dueño: Producto.
- **Recorridos E2E con sesión**: los recorridos críticos quedan en la suite de E2E de la app (MSF-499). Dueño:
  responsable de plataforma.
