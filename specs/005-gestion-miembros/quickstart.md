# Quickstart: Validación de gestión de miembros

## Prerrequisitos

1. Ejecutar `pnpm dev:supabase` y aplicar las migraciones locales.
2. Ejecutar Refine con `pnpm dev:refine:host` o `pnpm dev:refine`.
3. Preparar dos organizaciones, dos administradores en la primera y una cuenta
   nueva disponible para invitación. Usar Mailpit local para inspeccionar el
   correo de invitación.

## 1. Listado aislado

1. Iniciar sesión como administrador de la organización Uno.
2. Abrir `Miembros`.
3. Confirmar que aparecen solo las membresías de Uno.
4. Repetir como miembro de Uno, administrador de Dos y superadmin sin/con
   organización activa.

**Resultado esperado**: solo administrador y superadmin con Uno activa ven el
listado de Uno; miembro no puede gestionarlo, Dos no ve Uno y superadmin sin
contexto vuelve a Organizaciones.

## 2. Incorporar una cuenta nueva

1. Como administrador de Uno, incorporar `nueva-persona@example.com` con rol
   `miembro`.
2. Verificar que el listado muestra la membresía con ese rol.
3. Abrir Mailpit y comprobar la invitación.
4. Confirmar un evento `invitacion_enviada` con actor, objetivo y organización.
5. Medir desde la confirmación del formulario hasta ver el resultado: debe ser
   menor a 2 minutos.

**Resultado esperado**: la persona no accede a datos antes de completar el
acceso; repetir la misma solicitud no crea otra membresía ni otro evento.

## 3. Asociar una cuenta existente sin membresía

1. Remover una cuenta de una organización o preparar una cuenta existente sin
   fila de membresía.
2. Como administrador de Uno, incorporarla con rol `miembro`.
3. Confirmar que aparece en Uno y que no se recibe correo nuevo.
4. Confirmar el evento `miembro_agregado`.

**Resultado esperado**: la persona puede usar sus credenciales existentes para
acceder a Uno; si aún pertenece a otra organización, la operación se rechaza.

## 4. Roles, remoción y último administrador

1. Promover un miembro de Uno a administrador y comprobar el nuevo permiso.
2. Degradar o remover al otro administrador mientras queda otro administrador.
3. Intentar degradar o remover al último administrador.
4. Remover un miembro y verificar que al volver a consultar no accede a Uno.

**Resultado esperado**: cada operación efectiva crea su evento; la última
operación se rechaza sin alterar datos ni auditoría.

## 5. Validación automatizada y cierre

Ejecutar:

```text
pnpm test:db
pnpm lint
pnpm build
pnpm test
pnpm infra:config
```

**Resultado esperado**: pgTAP prueba RLS, superadmin con contexto, último
administrador y auditoría; el resto de comandos termina sin errores.
