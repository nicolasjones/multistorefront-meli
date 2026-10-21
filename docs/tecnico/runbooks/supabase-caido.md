# Supabase caído

**Trigger:** el panel no carga datos, Auth falla, Postgres/Storage no responde.
**Impacto:** sin lectura/escritura; los workers pueden encolar y reintentar.
**Dueño:** operación/infra.

## Pasos

1. Verificar salud del panel y de Supabase (Postgres/Auth/Storage). Revisar logs y disco.
2. Si es un servicio: reiniciar el contenedor/servicio afectado; confirmar que las migraciones no están a mitad.
3. Si es disco lleno: liberar espacio **sin borrar datos** (logs/temporales), luego reiniciar.
4. Si es Auth: verificar claves/URLs y que el panel use la configuración correcta.
5. Confirmar que la cola de workers no se llenó de errores; reintentar lo seguro.

## Verificación

- `/health` 200; login funciona; una lectura y una escritura de prueba.
- Storage sirve una imagen existente.
- No hay migraciones pendientes a medias.

## Escalado

Si hay pérdida de datos o el servicio no vuelve: runbook de [restaurar base](db-restore.md) + escalado a CTO.
