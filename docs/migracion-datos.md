# Migración inicial de datos

Importador de datos del panel actual hacia la base del producto (épica MSF-142).
Estado de esta pasada: **clientes** (F-MIG-01).

## Reglas de importación (contrato)

- **Identificador externo = identidad de la fila.** Se concilia por
  `clientes_identificadores_externos` con `sistema = 'panel_actual'`.
- **Si el identificador ya existe, el cliente se ACTUALIZA** (FR-005). Reenviar un
  identificador ya cargado en un lote anterior **no es un error**: es un upsert y sólo pisa
  las columnas que el archivo trae.
- **"Identificador repetido en el archivo"** aplica cuando el mismo identificador aparece
  **dos veces en el mismo archivo**, aunque caiga en otro lote (la primera fila aplicada
  gana; el servidor lo resuelve contra `migracion_filas` de la carga). También se marca en la
  vista previa (FR-004). Reenviar un identificador de una carga anterior sigue siendo upsert.
- **Idempotencia (FR-006):** volver a aplicar el mismo archivo no duplica clientes ni
  vínculos; una fila ya aplicada en la misma carga se omite, no se re-procesa.
- **Documento duplicado** (DNI/CUIT ya existente en la organización) **sí es error de fila**:
  no se importa y se informa con número de fila y motivo.

## Registro y cierre

Cada ejecución deja `migracion_cargas` (estado y contadores: nuevos / actualizados / con
error) y `migracion_filas` (resultado por fila). El informe de cierre (FR-007) cuadra con el
archivo: nuevas + actualizadas + con error = filas del archivo.

## Pruebas

`supabase/tests/database/migracion_clientes.test.sql` cubre FR-005, FR-006, FR-008 y FR-009.
Los lotes 1 y 2 usan la misma carga: el lote 2 **actualiza** P-001 y P-002 y sólo falla la
fila con documento repetido.
