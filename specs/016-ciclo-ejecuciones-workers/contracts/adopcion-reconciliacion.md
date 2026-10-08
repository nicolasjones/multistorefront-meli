# Contract: Adopción y Reconciliación en Producto Derivado

**Spec**: US3, FR-011, SC-005 | **Research**: R7

## registrar_adopcion_ciclo

```sql
select * from registrar_adopcion_ciclo(
  p_version_template := '016'   -- versión del template de la que se adopta (texto libre versionado)
);
-- Idempotente: INSERT ... ON CONFLICT actualiza la versión y la fecha en
-- adopciones_template(origen='ciclo-ejecuciones', version, adoptada_en).
-- Verificable: SELECT version FROM adopciones_template WHERE origen='ciclo-ejecuciones' (SC-005).
```

## Reglas de reconciliación (solo aditiva)

- Permitido: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  backfill de `tiempo_max_seg` / `habilitada` con defaults, creación del
  bucket si falta.
- Prohibido en el mismo PR: `DROP/RENAME` de columnas o tablas, borrado de
  historial, traslado de automatizaciones o tablas de dominio al template
  (FR-011, Technology Gates).
- La tabla de dominio del producto que originó el patrón no se toca; su
  historial compatible se conserva y solo se registra la versión de origen.
- Diferencias de nombres/firmas históricas incompatibles (edge case spec):
  se documentan en `docs/adoptar-ciclo-ejecuciones.md` como mapeo
  explícito, no como renombre automático.

## Guía (qué documenta `docs/adoptar-ciclo-ejecuciones.md`)

1. Prerrequisitos: organizaciones, `conexiones`, roles worker y Vault ya
   existentes (Assumptions).
2. Ejecutar migración del template (aditiva) y `registrar_adopcion_ciclo`.
3. Mapear capacidades del producto a `capacidades_ejecucion` (una fila por
   conexión+clave, sin duplicar historiales).
4. Verificación: cero tablas/historiales duplicados + `SELECT` de versión
   (Independent Test US3).
