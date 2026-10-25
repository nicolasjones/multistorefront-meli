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

!!! info "Procedimiento completo (MSF-457)"
    Los pasos detallados de base e imágenes, el destino de respaldos y los tiempos objetivo están en
    [Copias de seguridad y restauración](../copias-y-restauracion.md#procedimiento-guiado-de-restauración).
    Objetivo propuesto: volver a operar en **4 h** con pérdida máxima de **24 h** de datos.

## Pasos

1. **Detener escrituras** del panel/workers para el producto (o ponerlo en mantenimiento).
2. Elegir la copia `completado` más reciente **anterior** al incidente en `public.respaldos` (columna
   `ubicacion`) y verificar su integridad (`gzip -t` si aplica, tamaño y cabecera `PGDMP`).
3. Traer el archivo del destino de respaldos (`rclone copyto respaldos:…`) y restaurarlo en una base
   **temporal** primero; validar conteos y tablas críticas. Los roles y extensiones propios de Supabase deben
   existir en el destino.
4. Recién entonces restaurar la base real (o promover la temporal).
5. Restaurar las imágenes desde la última foto `completado` de `public.respaldos_imagenes` y comprobar una
   imagen del catálogo.
6. Verificar RLS/roles/grants y volver a habilitar escrituras. Correr `respaldo-postgres` a mano para dejar
   una copia fresca.

## Verificación

- Conteos de tablas críticas y última actividad coherentes.
- Login y una operación de lectura/escritura funcionan.
- `rls_en_toda_tabla` / pgTAP de aislamiento en verde.

## Escalado

Si el backup no cubre el incidente o falla la restauración: escalar a operación/CTO; no improvisar un `drop`/`truncate`.

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).
