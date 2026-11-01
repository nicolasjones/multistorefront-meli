# Fix MSF-631

- Causa: `scripts/migraciones-ventas-comprobantes.test.mjs` fijaba en 12 las migraciones `20261203*`/`20261204*`; hoy hay 17 (migraciones legítimas posteriores).
- Cambio: el conteo esperado pasa de 12 a 17 (línea 16).
- `perfil_usuario.test.sql` (test 11): sin cambios. Pasó en una base recién migrada con `db:reset:ci` (0 fallas en 206 archivos pgTAP); la falla depende de la versión de Storage del entorno de auditoría.
- Sin cambios en migraciones.
