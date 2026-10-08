# Contrato de interfaz: Perfil personal

**Consumidor**: persona autenticada desde la aplicación web.

## Lectura del perfil

La pantalla carga en paralelo el usuario autenticado, su \`perfiles_usuario\`, su propia membresía/contexto y sus hasta 20 \`eventos_seguridad_usuario\` más recientes. Si no existe perfil todavía, muestra nombre, apellido y foto vacíos sin crear datos hasta que la persona guarde.

| Dato | Origen | Escritura desde perfil |
|---|---|---|
| Nombre / apellido / foto | \`perfiles_usuario\` | Sí, solo titular. |
| Correo / fecha de creación | Auth | Correo mediante flujo confirmado; fecha no. |
| Organización / rol | Membresía y contexto | No. |
| Últimas 20 acciones | \`eventos_seguridad_usuario\` | No. |

## Guardar datos personales

| Entrada | Regla |
|---|---|
| \`nombre\` | Obligatorio al guardar; sin contenido tras quitar espacios. |
| \`apellido\` | Obligatorio al guardar; sin contenido tras quitar espacios. |
| \`foto\` | Opcional; JPG, PNG o WebP de hasta 2 MiB. |

**Resultado**: se actualiza solo la fila cuyo \`user_id\` coincide con la sesión. Una foto se sube primero a la ruta del titular y se persiste en el perfil solo si la carga es correcta. Al quitarla, se elimina el objeto y se limpia la ruta.

## Solicitar cambio de correo

| Entrada | Regla |
|---|---|
| \`contrasena_actual\` | Debe verificarse contra el correo de la sesión antes de pedir el cambio. |
| \`nuevo_correo\` | Válido, distinto al vigente y no asociado a otra cuenta. |

**Resultado pendiente**: Auth envía una confirmación a la dirección nueva y el correo anterior continúa siendo el de acceso. La aplicación informa que el cambio está pendiente y retorna al perfil tras la confirmación.

**Resultado efectivo**: Auth cambia el correo, notifica al correo anterior y el trigger agrega \`correo_modificado\`. En caso de enlace inválido/vencido, contraseña incorrecta, correo duplicado o fallo temporal no se cambian los datos y se muestra un error útil sin revelar cuentas ajenas.

## Acciones de seguridad

La vista muestra, de más reciente a más antigua, solo:

- \`inicio_sesion\` por una autenticación que creó sesión, sin refresh silencioso;
- \`contrasena_modificada\` tras éxito;
- \`correo_modificado\` tras confirmación efectiva.

Cada fila expone tipo y momento. No incluye eventos de clientes, usuarios, membresías u operación; tampoco permite listar, ubicar o cerrar sesiones.

## Foto en el listado de miembros

El listado de miembros usa el \`user_id\` de cada membresía ya autorizada para solicitar la ruta estable \`<user_id>/avatar\` del bucket privado. No consulta \`perfiles_usuario\` de otra persona ni muestra nombre, apellido, correo, cuenta o avisos ajenos. Si no hay foto o no puede obtenerse, muestra la representación neutra sin interrumpir el listado.

## Autorización verificable

- Una petición directa por otro \`user_id\` a perfiles o eventos devuelve cero filas o se rechaza por RLS; esto incluye integrantes de la misma organización.
- Una persona de otra organización no puede obtener una foto por Storage.
- Una persona de la misma organización solo puede obtener el objeto de foto autorizado; no puede obtener la fila de perfil de su integrante.
- El titular conserva acceso a su foto aunque se quede temporalmente sin membresía; nadie más obtiene esa foto sin organización compartida.
