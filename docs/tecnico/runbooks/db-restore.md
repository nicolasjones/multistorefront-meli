---
owner: operacion
sources:
  - supabase/migrations/20270418000301_reaplica_privilegios_copias.sql
  - supabase/tests/database/copias_imagenes_verificaciones.test.sql
  - infra/kestra/flows/respaldo-postgres.yml
  - infra/kestra/flows/respaldo-imagenes.yml
  - .github/workflows/validate.yml
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
   [copias-y-restauracion.md](../../copias-y-restauracion.md#procedimiento-guiado-de-restauracion)
   **aplica los permisos del dump** (no usa `--no-privileges`): con esa opción la base restaurada
   queda sin los permisos del app y el panel no muestra datos. Después del restore son obligatorios
   las migraciones pendientes (`supabase db push --db-url "$DATABASE_URL"`, la copia es de un día
   anterior) y el paso 5 de esa sección A (reaplicar los privilegios del historial).
5. **Reaplicar los privilegios del historial**: `select private.reaplicar_privilegios_copias();` con
   la misma conexión `postgres` del restore. Sin ese paso, cuando la copia es más vieja que la
   migración que cambió esos permisos, las funciones `security definer` del historial de copias
   quedan ejecutables por `PUBLIC` (cualquiera podría escribir el historial) y las tablas
   `respaldos`, `respaldos_imagenes` y `verificaciones_restauracion` quedan sin lectura para
   `authenticated`. Comprobarlo con `has_function_privilege`: sólo `kestra_backups` debe tener
   `EXECUTE`.
6. Verificar RLS/roles/grants y volver a habilitar escrituras.

## Verificación

- Conteos de tablas críticas y última actividad coherentes.
- Login y una operación de lectura/escritura funcionan.
- Que `authenticated` puede leer (`has_table_privilege`) y que `anon` no: sin esta comprobación el
  panel abre pero no muestra datos (es lo que pasa si el restore no aplicó los permisos del dump).
- `rls_en_toda_tabla` / pgTAP de aislamiento en verde.
- `copias_imagenes_verificaciones.test.sql` en verde contra la base restaurada: es el invariante de
  privilegios del historial de copias.

## Escalado

Si el backup no cubre el incidente o falla la restauración: escalar a operación/CTO; no improvisar un `drop`/`truncate`.

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).

> **CI (2026-10-27):** los `.md` de raíz (`CLAUDE.md`, `AGENTS.md`) ya no cuentan como cambio de la app web. Antes, un PR sólo de docs encendía el e2e sin `build` y moría con *"Falta apps/web/dist"*; ahora, si el e2e corre, el `build` corre antes.

> **CI (2026-11-12):** el paso «avisar el link del visor en el PR» de `validate.yml` ya no falla si el runner no trae `gh` (la imagen de `infra/runner/Dockerfile` no lo instala): avisa en el log y sigue. Antes salía con 127 y dejaba rojo el job `application` aunque sus tests pasaran.

> **CI (2026-11-16, actualizado 2026-11-18):** el job `chequeos` de Validate (antes `application`) corre `pnpm test:correo:verificar-salida` (MSF-532): la suite del guion de verificación de salida del correo. Es Node puro (sin base ni red): vigila que el contrato `{resultado, nuevo, enviado}` de la Edge Function `solicitar-acceso` y el guion sigan de acuerdo, para que el guion no pueda dar un verde falso.
