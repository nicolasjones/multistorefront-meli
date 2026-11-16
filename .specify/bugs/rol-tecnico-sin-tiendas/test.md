# Bug Test: El rol Técnico no puede operar en Service técnico

- **Slug**: rol-tecnico-sin-tiendas
- **Ticket**: MSF-597

## Verification

- pgTAP `rol_tecnico_por_empresa.test.sql`: no se pudo correr localmente (sin acceso a Docker en el worktree); queda al CI `database`.
- Lint/build/tests web del área: ver el reporte del PR.
