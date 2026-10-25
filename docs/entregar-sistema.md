---
owner: producto
sources: []
---
# Entregar el sistema: checklist

Lista para dejar el sistema funcionando en manos de otro equipo o cliente. Marcar cada
ítem con evidencia (comando, captura o enlace). Cómo se opera luego:
[operar-sistema.md](operar-sistema.md).

## Código y documentación
- [ ] Todo el trabajo está en git y mergeado a `main` (merge commit, sin squash).
- [ ] `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test` y `pnpm docs:check` en verde.
- [ ] El [índice de docs](index.md) enlaza una guía por cada función entregada.

## Variables y secretos
- [ ] Cada variable nueva está en el `.env.example` correspondiente, sin valores reales.
- [ ] No hay secretos en git (`.env` ignorados); los valores viven en los GitHub Environments
  y en el gestor de Dokploy, uno por ambiente (staging y producción no comparten).
- [ ] La clave `service-role` de Supabase no llega nunca al navegador.
- [ ] Secretos de Kestra, Superset y Nango entregados por canal seguro al nuevo dueño.

## Ambientes
- [ ] `dev`, `stg` y `prd` responden en sus URLs ([deployment.md](deployment.md)).
- [ ] Migraciones aplicadas en cada ambiente y verificadas ([ambientes-verificacion.md](ambientes-verificacion.md)).
- [ ] Flows de Kestra publicados y dashboards de Superset importados desde git.

## Copias
- [ ] Copias diarias de base e imágenes activas y registradas (`docs/copias-y-restauracion.md`).
- [ ] Simulacro de restauración hecho en staging y firmado por el propietario
  (`docs/simulacro-restauracion.md`).
- [ ] Correo de soporte y SMTP configurados para recibir avisos de fallo.

## Accesos
- [ ] Existe al menos un superadmin del nuevo dueño; se revocaron accesos del equipo anterior.
- [ ] Acceso al repositorio, a los runners ([adoptar-runners-locales.md](adoptar-runners-locales.md)) y al VPS transferido.
- [ ] Roles de la organización revisados ([permisos-por-rol.md](permisos-por-rol.md)).
