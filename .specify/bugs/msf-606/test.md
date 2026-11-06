# Verificación: MSF-606

- Vitest `DialogoInvitarUsuario.test.tsx` y `pages/usuarios`: 48 pasan (siete roles en el diálogo, invitar con Técnico, Técnico como rol por empresa).
- `pnpm test:edge:invitar-miembro`: 27 pasan (incluye `tecnico` hacia `registrar_invitacion`).
- pgTAP `asignar_empresas_usuario.test.sql` (+4 aserciones: asignar Técnico por empresa, listarlo, `registrar_invitacion('tecnico')`, `administrador` sigue rechazado): NO se corrió localmente (sin acceso a Docker en el entorno); queda al CI.
- `pnpm lint` (solo warnings previos) y `pnpm build`: OK.
