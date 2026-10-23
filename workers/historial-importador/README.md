# historial-importador

Importa una sola vez las planillas (`.csv` / `.xlsx`) del panel anterior a `dominio.historial_*`
(spec `20261020-100000-ventas-historial-de-consulta`, F-VTA-37).

- **Entrada**: `ORGANIZACION_ID` y `EJECUCION_ID` (las manda el flow `infra/kestra/flows/historial-importador.yml`),
  `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` (rol `worker_<org>`), y `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` para leer la planilla del bucket privado `historial-importaciones`.
  Las dos últimas viven solo en el `worker.env` del host de despacho; nunca van al navegador ni a Git.
- **Pasos**: contexto de la ejecución (`private.historial_contexto_ejecucion`) → descarga → lectura
  (CSV: codificación y separador autodetectados; Excel: primera hoja) → validación **completa** →
  inserción por lotes de 1000 (`private.importar_historial_lote`, `on conflict do nothing`) → cierre
  de la ejecución (`public.cerrar_ejecucion_worker`) con `nuevas` / `existentes`.
- **Todo o nada**: con una sola fila inválida no se escribe nada; la ejecución se cierra `fallida`
  con `detalle.rechazos` (fila, columna, motivo fijo, sin el valor de la celda) y el worker sale `78`.
- **Salida**: `0` éxito · `78` no reintentable (`ARCHIVO_INVALIDO`, `ARCHIVO_ILEGIBLE`,
  `ARCHIVO_NO_ENCONTRADO`, `EJECUCION_NO_EN_CURSO`, `CONFIGURACION_INVALIDA`) · otro código: falla técnica
  (stderr `FALLA_TECNICA_SANITIZADA`), el flow reintenta hasta 3 veces. Reimportar es idempotente.
- **Mapeo de columnas**: `src/mapeo.ts`. Los alias son provisorios hasta tener una muestra real de las
  exportaciones (spec, *Decisiones abiertas* 8); si difieren se ajusta esa tabla, no el modelo.
- **Red**: el flow exige `WORKER_NETWORK=worker-egress-historial-importador`; la allowlist de esa red
  (host de Postgres y de Storage del Supabase self-hosted) se declara en el firewall del servidor y,
  con los dominios reales, en `workers/egress-allowlists.json`.
