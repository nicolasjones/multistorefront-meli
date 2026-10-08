# Research: Autogestión de contraseña

## Decisión: Reutilizar enlaces de Auth para invitación y recuperación

**Rationale**: una invitación de Supabase crea una cuenta no confirmada y el
enlace permite completarla, incluso definiendo una contraseña. La recuperación
envía un enlace a una ruta pública de la aplicación y no revela si existe la
cuenta. Ambos enlaces son de un solo uso y se ajustan a la expiración de Email
OTP, configurada en una hora.

**Alternatives considered**:

- Asignar una contraseña temporal: descartado porque la persona no controlaría
  su credencial y se expondría un secreto innecesario.
- Crear enlaces propios en la base de datos: descartado porque duplicaría la
  identidad, expiración y validación segura que ya realiza Auth.

## Decisión: Usar una única ruta de definición de contraseña autenticada por el enlace

**Rationale**: la invitación y la recuperación llegan con una sesión temporal
validada por Auth. La misma pantalla permite definir la contraseña nueva; el
origen solo cambia el texto mostrado. La ruta no confía en parámetros del
navegador para autorizar el cambio: exige una sesión válida entregada por el
enlace.

**Alternatives considered**:

- Formularios separados con lógica duplicada: descartado por repetir controles
  de seguridad y validación.
- Pedir contraseña actual tras una recuperación: descartado porque contradice
  el propósito de recuperar acceso.

## Decisión: Confirmar contraseña actual al cambiarla desde sesión normal

**Rationale**: la versión de cliente instalada admite verificar la contraseña
actual junto con la nueva. Así, una sesión abierta por otra persona no puede
cambiar silenciosamente la credencial.

**Alternatives considered**:

- Permitir cambio solo con una sesión existente: descartado por menor protección
  ante una sesión comprometida.
- Exigir un nuevo correo para todo cambio: descartado por hacer innecesariamente
  lento el caso normal; la recuperación ya cubre a quien no recuerda la actual.

## Decisión: Cerrar otras sesiones y avisar por correo tras el cambio

**Rationale**: después de cambiar la contraseña se cierra el resto de sesiones
sin interrumpir la que completó el flujo, y Auth envía el aviso de contraseña
modificada. Un token de acceso emitido antes de la revocación puede durar hasta
su expiración de una hora, pero no puede renovarse.

**Alternatives considered**:

- Mantener sesiones en otros dispositivos: descartado por el riesgo de acceso
  persistente después de una recuperación.
- Cerrar también la sesión actual: descartado por interrumpir el flujo exitoso.

## Decisión: Configurar límites y correo aptos para producción

**Rationale**: el proyecto configura 15 minutos entre correos por usuario, una
hora de vigencia de enlaces, requisitos de contraseña robusta y notificación de
cambio. El proveedor de correo predeterminado de Supabase no alcanza para este
flujo en producción; se requiere SMTP configurado fuera de Git. En local,
Mailpit permite validarlo sin secretos.

**Alternatives considered**:

- Mantener el intervalo local de un segundo: descartado porque no cumple el
límite aclarado ni reduce abusos.
- Implementar un limitador propio: descartado porque Auth ya aplica el control
por correo sin introducir datos nuevos.
