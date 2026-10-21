---
owner: operacion
sources:
  - .github/workflows
  - infra
---

# Deploy fallido

**Trigger:** el deploy de DEV/STG/PRD falla, el `Deployment Status` queda en `Deploy Failed` o el panel no refleja el merge.
**Impacto:** la versión nueva no está disponible; la anterior puede seguir viva.
**Dueño:** operación/SDLC.

## Pasos

1. Identificar el entorno y el commit: `gh pr view <PR>`, `Deployment Status`, logs de Dokploy.
2. Si el deploy falló **antes** de tocar datos: reintentar el deploy del mismo commit; no re-mergear.
3. Si falló **después** de una migración: no reintentar a ciegas; verificar `schema_migrations` y el estado de la base.
4. Si el panel quedó en una versión rota: rollback al deploy anterior (Dokploy) o revert del merge en `main` (PR de revert).
5. Confirmar que los jobs/workers no quedaron a mitad: revisar la cola y ejecuciones.

## Verificación

- `GET /health` (o el endpoint de salud del producto) responde 200.
- La pantalla principal carga y una ruta crítica responde.
- `Deployment Status` coincide con la realidad; no se declara “deployed” sin verificar.

## Escalado

Si el rollback no aplica o hay datos inconsistentes: escalar a orquestación/CTO y abrir incidente. No borrar datos para “destrabar”.
