# @workers/importar-productos

Aplica las importaciones de productos desde CSV (F-CAT-10, MSF-375). Lo lanza el flow de Kestra
`producto.catalogo.importar-productos` con `ORGANIZACION_ID`, `EJECUCION_ID`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` y `PG*` (solo en el servidor, nunca en el navegador).

- Aplica fila por fila con las RPC del rol `worker_*` (mismas reglas que el alta/edición).
- Idempotente: reintentar no duplica productos ni imágenes.
- Códigos de salida (`workers/CONTRATO.md`): `0` éxito, `78` no reintentable (p. ej. `EJECUCION_NO_EN_CURSO`),
  `1` falla técnica (el flow reintenta).
- Serialización: una importación por organización a la vez (la resuelve la base).
- Reversión: ver `docs/catalogo-importacion.md`.

Comandos: `pnpm --filter @workers/importar-productos build | lint | test | start`.
