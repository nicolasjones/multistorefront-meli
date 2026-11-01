# Bug Fix: El rol Técnico no puede operar en Service técnico

- **Slug**: rol-tecnico-sin-tiendas
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270121121100_rol_tecnico_por_empresa.sql` | added | Amplía el CHECK y `private.validar_asignaciones` con `tecnico`. Aditiva; reversión documentada en el encabezado. Esquema `public`, sin tablas nuevas. |
| `apps/web/src/lib/asignacionesEmpresas.ts` | modified | `ROLES_POR_EMPRESA` incluye `tecnico` para que Usuarios pueda asignarlo. |
| `docs/permisos-por-rol.md` | modified | Documenta la asignación del Técnico a tiendas. |
| `supabase/tests/database/rol_tecnico_por_empresa.test.sql` | added | pgTAP del flujo completo. |

## Tests Added or Updated

- `rol_tecnico_por_empresa.test.sql`: asignar tienda con `asignar_empresas_usuario`, CHECK, y `crear_reparacion` ya sin 42501 (y 42501 en tienda no asignada).
