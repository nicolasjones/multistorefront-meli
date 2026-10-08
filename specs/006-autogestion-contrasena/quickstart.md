# Quickstart: Validación de autogestión de contraseña

## Correo en produccion

Mailpit solo captura correos durante el desarrollo local. Antes de desplegar,
configurar un proveedor SMTP externo desde la configuracion segura de Supabase
o el gestor de secretos del entorno. No guardar credenciales SMTP, claves
administrativas ni contrasenas en este repositorio ni en archivos `.env` que se
versionen.

Para reforzar el cambio desde una sesion, habilitar tambien **Require current
password when updating** en la configuracion de Auth del proyecto alojado. La
aplicacion ya verifica la contrasena actual antes de actualizarla; ese ajuste
aporta la comprobacion nativa adicional de Supabase.

## Prerrequisitos

1. Ejecutar `pnpm dev:supabase` y aplicar los cambios de configuración local.
2. Ejecutar Refine con `pnpm dev:refine:host` o `pnpm dev:refine`.
3. Abrir Mailpit local y disponer de una dirección nueva para invitar y de una
   cuenta existente con contraseña conocida.

## 1. Aceptar invitación y crear contraseña

1. Invitar una dirección nueva desde Miembros.
2. Abrir el correo de invitación en Mailpit y seguir el enlace.
3. Definir una contraseña que cumpla el contrato de
   [actualizar-contrasena.md](./contracts/actualizar-contrasena.md).
4. Cerrar sesión e iniciar otra vez con el correo invitado y esa contraseña.

**Resultado esperado**: el segundo acceso funciona sin intervención del
administrador y el flujo completo demora menos de tres minutos.

## 2. Enlace fallido o no completado

1. Abrir un enlace vencido, usado o inválido.
2. Verificar que no hay sesión ni cambio de contraseña.
3. Solicitar un nuevo enlace para el mismo correo desde la pantalla ofrecida.
4. Repetir antes de 15 minutos y confirmar que se informa el límite.

**Resultado esperado**: la persona puede retomar el acceso por sí misma sin que
la interfaz revele el estado de la cuenta.

## 3. Recuperar contraseña

1. Desde el acceso, solicitar recuperación para una cuenta existente.
2. Confirmar que la respuesta también es neutral para una dirección inexistente.
3. Abrir el enlace recibido en Mailpit, definir una contraseña nueva y volver a
   iniciar sesión.
4. Confirmar que la contraseña anterior falla, la nueva funciona y llega el
   aviso de cambio.

**Resultado esperado**: el acceso se recupera en menos de cinco minutos y el
correo no expone contraseñas ni enlaces adicionales.

## 4. Cambiar contraseña desde sesión

1. Iniciar sesión con una cuenta existente y abrir su pantalla de contraseña.
2. Ingresar correctamente la contraseña actual, una nueva válida y su
   confirmación.
3. Confirmar que las demás sesiones ya no pueden renovarse y que la actual
   sigue operativa.
4. Repetir con contraseña actual incorrecta y comprobar que no se modifica.

**Resultado esperado**: solo la persona titular cambia su propia contraseña;
recibe un aviso por correo y la anterior deja de servir.

## 5. Validación automatizada y cierre

Ejecutar:

```text
pnpm test:web
pnpm test:db
pnpm lint
pnpm build
pnpm test
pnpm infra:config
```

**Resultado esperado**: los formularios y las rutas cubren los estados de
sesión, los errores no exponen cuentas ni secretos y todos los comandos
finalizan sin errores.
