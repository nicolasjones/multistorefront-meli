# Corrección: MSF-606

- `apps/web/src/lib/rolesUsuarios.ts`: `tecnico` entra en `ROLES_INVITABLES` (con su descripción); se quita la entrada duplicada de `NOMBRES`.
- `apps/web/src/lib/asignacionesEmpresas.ts`: `tecnico` en `ROLES_POR_EMPRESA`.
- `supabase/functions/invitar-miembro/handler.ts`: `tecnico` en `ROLES` (sin cambio de contrato: la lista de roles válidos no figura en `openapi/`).
- `supabase/migrations/20270121121100_tecnico_invitable_y_por_empresa.sql`: amplía el CHECK `usuarios_empresas_rol_por_empresa`, `registrar_invitacion` y `private.validar_asignaciones`. Aditiva; reversión documentada en la cabecera de la migración. Esquema: `public` (plataforma), sin tablas nuevas.
- `docs/usuarios-y-empresas.md`: el selector de Editar usuario cuenta siete roles.
