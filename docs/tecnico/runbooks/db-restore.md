---
owner: operacion
sources:
  - .github/workflows
  - infra
---

# Restaurar base de datos

**Trigger:** pérdida/corrupción de datos, migración destructiva o restore solicitado.
**Impacto:** datos no disponibles o inconsistentes; el panel puede seguir leyendo datos viejos.
**Dueño:** operación/DB.

## Pasos

1. **Detener escrituras** del panel/workers para el producto (o ponerlo en mantenimiento).
2. Elegir el backup más reciente **anterior** al incidente y verificar su integridad (`gzip -t`, checksum).
3. Restaurar en una base **temporal** primero; validar conteos y tablas críticas.
4. Recién entonces restaurar la base real (o promover la temporal).
5. Verificar RLS/roles/grants y volver a habilitar escrituras.

## Verificación

- Conteos de tablas críticas y última actividad coherentes.
- Login y una operación de lectura/escritura funcionan.
- `rls_en_toda_tabla` / pgTAP de aislamiento en verde.

## Escalado

Si el backup no cubre el incidente o falla la restauración: escalar a operación/CTO; no improvisar un `drop`/`truncate`.

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).
