# Data model: Gestión del perfil personal

## \`perfiles_usuario\`

| Campo | Regla |
|---|---|
| \`user_id\` | UUID, PK y FK a \`auth.users(id)\`, cascada al eliminar la cuenta. |
| \`nombre\` | Texto opcional hasta que la persona lo complete; una actualización exige contenido no vacío junto con apellido. |
| \`apellido\` | Texto opcional hasta que la persona lo complete; una actualización exige contenido no vacío junto con nombre. |
| \`foto_path\` | Ruta opcional al único objeto del bucket privado del titular. |
| \`created_at\` / \`updated_at\` | Timestamps de creación y última modificación. |

**Relaciones y acceso**:

- El titular puede seleccionar e insertar/actualizar solo su fila.
- Una persona puede leer su propia fila aunque no pertenezca a una organización.
- Ninguna persona puede seleccionar la fila de perfil de otra, incluso si comparten organización; así nombre, apellido y la ruta de la foto permanecen privados.
- Nombre, apellido y foto no se usan para decisiones de autorización.

## Storage \`fotos-perfil\`

| Atributo | Regla |
|---|---|
| Visibilidad | Bucket privado; nunca usar URL pública. |
| Nombre de objeto | \`<user_id>/avatar\`, una única foto reemplazable por titular. |
| Contenido | JPG, PNG o WebP; hasta 2 MiB. |
| Escritura | Solo el titular en su carpeta: INSERT, SELECT y UPDATE para reemplazo; DELETE para quitarla. |
| Lectura | Titular o integrante de la misma organización que el titular; prohibida entre organizaciones. |

La vista de miembros construye la ruta estable desde el \`user_id\` que ya puede consultar por su membresía y solicita únicamente el objeto de Storage; no lee la fila \`perfiles_usuario\` ajena. La eliminación de la foto borra el objeto y establece \`foto_path\` en nulo. Una fallida de carga o eliminación no actualiza la referencia existente.

## \`eventos_seguridad_usuario\`

| Campo | Regla |
|---|---|
| \`id\` | Identidad monotónica, PK. Desempata eventos del mismo instante. |
| \`user_id\` | UUID, FK a \`auth.users(id)\`; es el titular que puede leerlo. |
| \`tipo\` | Uno de \`inicio_sesion\`, \`contrasena_modificada\`, \`correo_modificado\`. |
| \`created_at\` | Timestamp de la acción efectiva. |

**Acceso y ciclo de vida**:

- El titular solo puede seleccionar sus eventos; no tiene INSERT, UPDATE ni DELETE directo.
- El hook de Auth agrega inicios de sesión nuevos y excluye renovaciones de token. El trigger interno agrega cambios efectivos de contraseña/correo.
- La interfaz consulta \`order(created_at desc, id desc).limit(20)\`; los eventos anteriores siguen siendo internos y no forman parte de la vista de perfil.
- No se persisten contraseña, token, enlace, IP, user agent, correo anterior ni correo nuevo.

## Datos de cuenta derivados

No se duplica \`auth.users\`. La pantalla compone:

- correo y fecha de creación desde el usuario autenticado de Auth;
- organización y rol desde la membresía propia existente;
- condición de superadmin y organización activa mediante los recursos ya protegidos por sus policies.

Estos datos son de solo lectura y no habilitan modificación de rol, organización ni pertenencia.
