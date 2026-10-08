# Data Model: Ciclo de Ejecuciones de Workers

**Branch**: `016-ciclo-ejecuciones-workers` | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Tablas de plataforma en esquema `public` (como `conexiones`/`alertas` de la
spec 013), nunca en `dominio`. Escritura solo vía funciones `SECURITY
DEFINER`; `authenticated` sin `INSERT/UPDATE/DELETE` directo (patrón
`conexiones`, R5).

## capacidades_ejecucion

Automatización identificable que una conexión puede ejecutar (FR-004, FR-010).

| Columna | Tipo | Reglas |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | — |
| `organizacion_id` | uuid FK `organizaciones(id)` `ON DELETE CASCADE` | dueña; hereda aislamiento |
| `conexion_id` | uuid FK `conexiones(id)` `ON DELETE CASCADE` | la conexión habilitada que la expone |
| `clave` | text | identificador estable del worker (p. ej. `extraer-reporte-x`); `UNIQUE (conexion_id, clave)` |
| `tiempo_max_seg` | integer `> 0` default `1800` | tiempo máximo antes de timeout (R2, Assumptions) |
| `habilitada` | boolean default `true` | `iniciar` rechaza si `false` o si la conexión no está `activa` (FR-004) |
| `created_at` / `updated_at` | timestamptz | `now()` / `clock_timestamp()` en updates |

## ejecuciones_worker

Registro auditable de un intento (FR-001, FR-005, FR-006).

| Columna | Tipo | Reglas |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | — |
| `organizacion_id` | uuid FK `organizaciones` `CASCADE` | redundante a propósito: permite RLS e índice parcial sin join |
| `conexion_id` | uuid FK `conexiones` `SET NULL` | preserva auditoría aunque la conexión se borre |
| `capacidad_id` | uuid FK `capacidades_ejecucion` `CASCADE` | — |
| `origen` | text check `('manual','programada','kestra')` | FR-001 |
| `estado` | text check `('en_curso','exitosa','fallida','timeout')` | nace `en_curso`; solo avanza a final (FR-005) |
| `actor` | uuid FK `auth.users` `SET NULL` nullable | solo cuando `origen = 'manual'` |
| `iniciada_en` | timestamptz default `now()` | — |
| `finalizada_en` | timestamptz nullable | solo en estados finales; `iniciada_en <= finalizada_en` |
| `motivo_sanitizado` | text nullable | causa ya sanitizada (R4); nunca secreto |
| `detalle` | jsonb default `'{}'` | extensible (FR-001); validado contra patrones de secreto en `cerrar` (FR-009) |
| `archivo_original_path` | text nullable | ruta en bucket `evidencias-ejecuciones`, nunca bytes |
| `evidencia_path` | text nullable | idem; solo se escribe al cerrar `exitosa` (FR-006) |

Restricciones:

- Índice único parcial (R1/SC-001):
  `CREATE UNIQUE INDEX ejecucion_activa_unica ON ejecuciones_worker
  (organizacion_id, capacidad_id) WHERE estado = 'en_curso'`.
- Chequeo final inmutable (FR-005): trigger o guarda en `cerrar_ejecucion_worker` —
  si `estado <> 'en_curso'`, error `YA_CERRADA` sin modificar la fila.
- Chequeo de cierre (edge case "termina dos veces / estado no final"): la
  función solo acepta `exitosa`/`fallida` como destino manual; `timeout` solo
  lo escribe el cierre perezoso de `iniciar` (R2).
- Último éxito (FR-006/SC-004): vista/consulta, no tabla:
  última fila `exitosa` por `(organizacion_id, capacidad_id)` con sus rutas;
  una `fallida` posterior no toca esas rutas.

## Funciones (único punto de escritura)

- `iniciar_ejecucion_worker(p_conexion_id, p_clave_capacidad, p_origen, p_actor DEFAULT NULL)`
  → valida conexión `activa` + capacidad `habilitada` (FR-004); cierra
  vencidas como `timeout` (R2); inserta `en_curso` con org derivada de la
  conexión; ante activa vigente, error `YA_EN_CURSO` (US1). Invocable por
  `kestra_orquestacion` (JDBC) y por admin vía RPC; el worker nunca pasa su
  propia org por parámetro (R5).
- `cerrar_ejecucion_worker(p_ejecucion_id, p_estado_final, p_motivo_sanitizado,
  p_detalle DEFAULT '{}', p_archivo_path DEFAULT NULL, p_evidencia_path
  DEFAULT NULL)` → solo desde `en_curso`; rechaza `motivo`/`detalle` con
  patrones de secreto (FR-009, R4); `evidencia_path` solo si `exitosa`
  (FR-006); verifica que la ejecución pertenece a la org del rol llamante
  (R5); segundo cierre → `YA_CERRADA` sin cambios (edge case).
- `registrar_adopcion_ciclo(p_version_template)` → `INSERT ... ON CONFLICT DO
  NOTHING` en `adopciones_template(origen text PK, version text, adoptada_en)`
  (R7/SC-005); idempotente, nunca recrea ni borra.

## RLS (Principio I, SC-003)

- Ambas tablas: `ENABLE ROW LEVEL SECURITY`; `SELECT` solo si
  `private.es_administrador_de(organizacion_id)` o superadmin (mismo helper
  que spec 013); sin `GRANT` de escritura a `authenticated` (solo `EXECUTE`
  en las funciones); rol `worker_<org>` y `kestra_orquestacion` solo vía
  funciones (`organizacion_del_rol_actual()` para el primero).
- Bucket `evidencias-ejecuciones` (privado): políticas sobre
  `storage.objects` por prefijo `<organizacion_id>/...` con el mismo criterio
  admin/superadmin para lectura; escritura acotada al rol de servicio del
  worker; Refine lee por URL firmada efímera.

## Lo que NO se crea (FR-012)

Ninguna tabla de dominio, ningún proveedor externo, ningún selector de
navegador, ningún flow `.yml` de producto. La tabla de dominio del producto
que originó el patrón no se migra ni se renombra.
