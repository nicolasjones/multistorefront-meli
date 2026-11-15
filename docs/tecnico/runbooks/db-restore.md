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
2. Elegir el backup más reciente **anterior** al incidente y verificar su integridad. El dump de la
   base es formato custom de `pg_dump` (se lista con `pg_restore --list`); el de imágenes es una
   carpeta copiada con rclone, no un `.gz`: no hay nada que descomprimir.
3. Restaurar en una base **temporal** primero; validar conteos y tablas críticas.
4. Recién entonces restaurar la base real (o promover la temporal). El restore documentado en
   [copias-y-restauracion.md](../../copias-y-restauracion.md#procedimiento-guiado-de-restauración)
   usa `pg_restore --no-privileges`: el paso 5 de esa sección A (reaplicar privilegios) es obligatorio.
5. **Reaplicar los privilegios**: `select private.reaplicar_privilegios_copias();` con la misma
   conexión `postgres` del restore. Sin ese paso las funciones `security definer` del historial de
   copias quedan ejecutables por `PUBLIC` (cualquiera podría escribir el historial) y las tablas
   `respaldos`, `respaldos_imagenes` y `verificaciones_restauracion` quedan sin lectura para
   `authenticated`. Comprobarlo con `has_function_privilege`: sólo `kestra_backups` debe tener
   `EXECUTE`.
6. Verificar RLS/roles/grants y volver a habilitar escrituras.

## Verificación

- Conteos de tablas críticas y última actividad coherentes.
- Login y una operación de lectura/escritura funcionan.
- `rls_en_toda_tabla` / pgTAP de aislamiento en verde.
- `copias_imagenes_verificaciones.test.sql` en verde contra la base restaurada: es el invariante de
  privilegios del historial de copias.

## Escalado

Si el backup no cubre el incidente o falla la restauración: escalar a operación/CTO; no improvisar un `drop`/`truncate`.

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).

> **CI (2026-10-27):** los `.md` de raíz (`CLAUDE.md`, `AGENTS.md`) ya no cuentan como cambio de la app web. Antes, un PR sólo de docs encendía el e2e sin `build` y moría con *"Falta apps/web/dist"*; ahora, si el e2e corre, el `build` corre antes.

> **CI (2026-11-12):** el paso «avisar el link del visor en el PR» de `validate.yml` ya no falla si el runner no trae `gh` (la imagen de `infra/runner/Dockerfile` no lo instala): avisa en el log y sigue. Antes salía con 127 y dejaba rojo el job `application` aunque sus tests pasaran.
