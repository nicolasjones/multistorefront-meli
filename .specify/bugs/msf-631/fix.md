# Fix MSF-631

- Causa: `scripts/migraciones-ventas-comprobantes.test.mjs` fijaba en 12 las migraciones `20261203*`/`20261204*`; hoy hay 17 (migraciones legítimas posteriores).
- Cambio: el conteo exacto pasa a un piso `>= 12` (línea 17), para que una migración nueva con esos prefijos no vuelva a romperlo.
- `perfil_usuario.test.sql` (test 11): sin cambios. Pasó en una base recién migrada con `db:reset:ci` (0 fallas en 206 archivos pgTAP); la falla depende de la versión de Storage del entorno de auditoría.
- Sin cambios en migraciones.
- Traza `perfil_usuario`: el test hace `insert into storage.objects … on conflict (bucket_id, name)`. Falla (`42P10`) solo con `storage-api` v1.84.19 del stack demo de la auditoría, cuyo esquema no trae índice único sobre `(bucket_id, name)`. Con las migraciones del repo aplicadas (`db:reset:ci`) pasa; si reaparece en CI, revisar la versión de `storage-api` antes de tocar el test.
