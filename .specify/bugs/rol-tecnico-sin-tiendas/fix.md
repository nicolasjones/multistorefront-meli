# Bug Fix: El rol Técnico no puede operar en Service técnico

- **Slug**: rol-tecnico-sin-tiendas
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270202202000_tecnico_invitable_y_por_empresa.sql` | no tocado | El fix funcional (CHECK y `validar_asignaciones` con `tecnico`) llegó a `dokploy` por MSF-606 (PR #634). La migración propia de este bug era redundante y se eliminó de la rama. |
| `docs/permisos-por-rol.md` | modified | Documenta la asignación del Técnico a tiendas. |
| `supabase/tests/database/rol_tecnico_por_empresa.test.sql` | added | pgTAP del flujo completo. |

## Tests Added or Updated

- `rol_tecnico_por_empresa.test.sql`: asignar tienda con `asignar_empresas_usuario`, CHECK, y `crear_reparacion` ya sin 42501 (y 42501 en tienda no asignada).
