# Data model: Autogestión de contraseña

No se crea una tabla de aplicación. La identidad y las credenciales se
mantienen en Supabase Auth; los datos siguientes describen el contrato de uso.

## Cuenta de usuario

- **Identificador**: identidad existente de Auth.
- **Correo**: destinatario de invitaciones, recuperación y avisos.
- **Contraseña**: secreto administrado por Auth; nunca se devuelve, persiste ni
  audita en texto legible desde la aplicación.
- **Relación**: puede tener una membresía de organización ya creada por la
  invitación, pero esta feature no modifica la membresía.

## Enlace de acceso

- **Tipos**: invitación o recuperación.
- **Propietario**: una cuenta y su correo.
- **Vigencia**: una hora desde su emisión.
- **Uso**: único; al validarse crea una sesión temporal para definir una nueva
  contraseña.
- **Transición**: emitido → usado o vencido. Los estados inválido, vencido o
  usado no permiten actualizar credenciales.

## Sesión

- **Sesión del flujo**: la sesión que abrió un enlace válido o que ya estaba
  autenticada y completó un cambio; se conserva tras el éxito.
- **Otras sesiones**: se invalidan para renovación tras un cambio efectivo de
  contraseña. Un token de acceso emitido puede durar hasta una hora.

## Solicitud de recuperación

- **Entrada**: dirección de correo.
- **Límite**: una emisión por dirección cada 15 minutos.
- **Respuesta pública**: siempre neutral, sin confirmar si existe una cuenta.
