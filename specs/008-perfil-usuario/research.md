# Research: Gestión del perfil personal

## Datos personales y autorización

**Decision**: crear \`public.perfiles_usuario\` en lugar de almacenar nombre, apellido o foto en \`auth.users.raw_user_meta_data\`.

**Rationale**: la metadata de usuario puede cambiarla la propia persona y no es apta para decisiones de autorización. Una tabla pública permite RLS explícito y relacionar la foto con el titular sin exponer \`auth.users\`; su fila permanece legible solo por el titular. La foto se comparte de forma acotada por organización directamente mediante Storage. La identidad, correo y creación de la cuenta siguen siendo responsabilidad de Supabase Auth.

**Alternatives considered**:

- Metadata de Auth: no permite una lectura por organización mediante Data API y no debe participar en autorización.
- Copiar correo y fecha de creación a la tabla: duplicaría datos de Auth y crearía riesgos de desincronización.

## Fotos de perfil

**Decision**: usar un bucket privado \`fotos-perfil\`, con una ruta estable por titular (\`<user_id>/avatar\`) y una referencia opcional desde el perfil.

**Rationale**: Storage no permite subidas sin policies. La ruta estable evita objetos huérfanos al reemplazar una foto; un bucket privado y policies sobre \`storage.objects\` permiten que solo el titular escriba y que solo personas en la misma organización lean. La carga acepta imágenes JPG, PNG o WebP de hasta 2 MiB; la interfaz valida antes de enviar y el bucket impone el límite real.

**Alternatives considered**:

- Bucket público: contradice la visibilidad limitada a la organización.
- URL externa guardada en el perfil: perdería el control de acceso y la validación de contenido.
- Una ruta nueva por cada carga: requeriría limpieza adicional y podría dejar fotos obsoletas accesibles.

## Cambio de correo

**Decision**: verificar primero la contraseña actual mediante el helper ya existente y llamar a \`auth.updateUser({ email }, { emailRedirectTo })\` con la ruta autenticada de perfil como retorno. Configurar \`auth.email.double_confirm_changes = false\` y habilitar \`auth.email.notification.email_changed\`.

**Rationale**: \`updateUser\` es la operación para actualizar el correo del usuario autenticado. Con la doble confirmación desactivada, Auth exige solo la confirmación de la dirección nueva, tal como requiere la spec. La notificación de correo cambiado incluye la dirección anterior y nueva y satisface el aviso al correo anterior después del cambio efectivo.

**Alternatives considered**:

- Mantener doble confirmación: obligaría a confirmar desde ambas direcciones y contradice el flujo aclarado.
- Usar \`auth.admin.updateUserById\`: aplica cambios directos y requeriría una clave administrativa, que nunca debe llegar al navegador.

## Historial de seguridad

**Decision**: proyectar eventos mínimos en \`public.eventos_seguridad_usuario\`. Un Custom Access Token Hook inserta un \`inicio_sesion\` para métodos de autenticación que emiten una sesión nueva y excluye \`token_refresh\`; un trigger en \`auth.users\` registra \`contrasena_modificada\` y \`correo_modificado\` tras el cambio efectivo. La UI pide los últimos 20 por \`created_at\` e \`id\` descendentes.

**Rationale**: los Auth Audit Logs registran eventos de autenticación, pero pueden tener demora y su consulta está orientada al dashboard. La proyección propia ofrece una vista inmediata, limitada y protegida por RLS para el titular. El hook recibe el método de autenticación y permite excluir la renovación silenciosa de tokens, que no representa una acción de inicio de sesión del usuario.

**Alternatives considered**:

- Registrar desde el frontend: una falla de red posterior a un login exitoso omitiría el evento y no cubriría enlaces de invitación/recuperación.
- Exponer \`auth.audit_log_entries\`: es un esquema interno, con configuración y retención ajenas al contrato del producto.
- Registrar refresh tokens: saturaría el listado sin representar una acción explícita del usuario.

## Seguridad del hook y RLS

**Decision**: crear el hook como función de Postgres con permisos de ejecución solo para \`supabase_auth_admin\`, revocados de roles públicos. Dar a ese rol el mínimo acceso de inserción necesario en la tabla de eventos; habilitar el hook solo después de crear función, tabla, RLS y grants.

**Rationale**: si el hook falla, Auth puede impedir un inicio de sesión. El orden de la migración y los permisos explícitos reducen ese riesgo y evitan que la función sea un RPC público. Cada tabla pública nueva recibe RLS y GRANT explícito porque \`auto_expose_new_tables\` está desactivado.

**Alternatives considered**:

- \`SECURITY DEFINER\` expuesto a \`authenticated\`: ampliaría innecesariamente la superficie de privilegio.
- Sin hook: no se podría garantizar que cada inicio de sesión exitoso aparezca en el historial.

## References

- [Supabase Auth updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser)
- [Configuración Auth del CLI](https://supabase.com/docs/guides/local-development/cli/config)
- [Plantillas y notificaciones de correo](https://supabase.com/docs/guides/local-development/customizing-email-templates)
- [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Auth Hooks: modelo de seguridad](https://supabase.com/docs/guides/auth/auth-hooks)
- [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Auth Audit Logs](https://supabase.com/docs/guides/auth/audit-logs)
