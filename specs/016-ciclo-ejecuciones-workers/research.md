# Research: Ciclo de Ejecuciones de Workers

**Branch**: `016-ciclo-ejecuciones-workers` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

Todos los `NEEDS CLARIFICATION` del Technical Context quedan resueltos acá.
No se introduce ningún runtime, servicio ni dependencia fuera del stack base
(Refine, Supabase, Kestra, Superset, workers Node+TS).

## R1. Concurrencia: una sola ejecución activa por organización y capacidad

- **Decision**: exclusión mediante índice único parcial sobre
  `(organizacion_id, capacidad_id)` donde `estado = 'en_curso'`, más función
  `SECURITY DEFINER` como único punto de inserción (mismo patrón que
  `crear_conexion` / `marcar_conexion_*` de la spec 013).
- **Rationale**: el índice parcial es la garantía real a nivel de base (cubre
  carreras concurrentes que un `SELECT` previo no cubre); la función devuelve
  un error contractual `YA_EN_CURSO` en vez de dejar que el `unique violation`
  burbujee crudo. Sin locks asesores ni Redis (FR-008 de la spec 012 sigue
  vigente: nada de Redis/BullMQ).
- **Alternatives considered**: lock por fila de capacidad (`SELECT FOR UPDATE`)
  — descartado porque exige una fila de capacidad siempre existente y serializa
  más de lo necesario; el índice parcial es declarativo y no agrega código.

## R2. Timeout: cierre identificable antes de permitir un reintento

- **Decision**: cada capacidad lleva `tiempo_max_seg` (default 1800, editable
  por admin). `iniciar_ejecucion` primero cierra como `timeout` toda ejecución
  `en_curso` de esa organización+capacidad cuyo `iniciada_en < now() -
  tiempo_max`, y recién después inserta la nueva. El cierre por timeout queda
  auditado con `motivo = 'TIMEOUT:<segundos>s'` y `finalizada_en`.
- **Rationale**: cumple FR-003/SC-002 sin un barrendero periódico (cron) que
  agregaría infraestructura; el costo es una única sentencia previa al insert,
  idempotente y sin efectos si no hay nada vencido.
- **Alternatives considered**: job periódico de Kestra barriendo vencidas —
  descartado por Principio V (infraestructura nueva sin caso de uso que la
  exija); el cierre perezoso al intentar iniciar es suficiente y auditable.

## R3. Evidencia y archivo original: Supabase Storage privado, no Kestra ni tabla de dominio

- **Decision**: bucket privado nuevo `evidencias-ejecuciones` con prefijo
  `<organizacion_id>/<capacidad_clave>/<ejecucion_id>/`. La fila de ejecución
  guarda solo las rutas (`archivo_original_path`, `evidencia_path`); "último
  éxito" es una consulta (última `exitosa` por organización+capacidad), sin
  tabla resumen duplicada. Políticas RLS sobre `storage.objects`: lectura solo
  admin/superadmin de la organización dueña (vía prefijo), escritura vía rol
  de servicio/worker acotado; Refine descarga con URL firmada, nunca con
  service-role en el navegador.
- **Rationale**: primer uso de Storage en el repo, pero es el servicio ya
  incluido en el stack Supabase (no es infraestructura nueva). Kestra internal
  storage no sirve como evidencia consultable por organización con RLS; guardar
  bytes en `bytea` rompería la escala. La consulta "último éxito" preserva
  automáticamente la referencia ante fallas posteriores (FR-006/SC-004).
- **Alternatives considered**: columna `bytea` en la ejecución — descartada por
  tamaño/retención; Kestra internal storage — descartado por falta de
  aislamiento por organización consultable desde Refine.

## R4. Sanitización de secretos (patrón spec 014)

- **Decision**: reutilizar el criterio de la spec 014 — el worker reemplaza en
  origen el valor literal de la credencial y sus variantes URL y Base64 comunes
  por `[REDACTED]` antes de emitir stdout/stderr/motivo/detalle; la función
  `cerrar_ejecucion` rechaza (o redacta y marca) cualquier `motivo`/`detalle`
  que contenga patrones de credencial, sesión o token (`(?i)(api[_-]?key|bearer
  |session|password|secret|token)[=: ]\S+`, `eyJ[A-Za-z0-9_-]+\.` JWT,
  credencial conocida de Vault nunca viaja, así que solo se filtra por forma).
  Kestra solo transmite `motivo_sanitizado`, nunca `errorLogs()` crudo (mismo
  patrón que `plantilla-generico.yml`: une logs, busca marca, transmite
  constante).
- **Rationale**: FR-009 exige cubrir literal, sesión y variantes codificadas
  comunes "en texto recuperable". El filtro por forma + redacción en origen
  (workers/README ya lo exige) da defensa en profundidad sin falsos esquemas
  de detección perfecta.
- **Alternatives considered**: lista negra exacta de valores de Vault en la
  función SQL — descartada porque la función nunca debe recibir el secreto
  descifrado para compararlo (lo pondría en logs/planes); se filtra por forma.

## R5. Roles y permisos: reutilizar lo existente, sin claims confiables

- **Decision**: ningún `INSERT/UPDATE/DELETE` directo de `authenticated` sobre
  las tablas nuevas (mismo patrón que `conexiones`: policies sin GRANT de
  escritura, solo vía funciones). Lectura de historial/evidencia: admin de la
  organización o superadmin (reutiliza `private.es_administrador_de`). Worker:
  rol `worker_<organizacion_id>` existente (spec 013) resuelve su organización
  con `private.organizacion_del_rol_actual()`; Kestra usa `kestra_orquestacion`
  por JDBC con `EXECUTE` acotado a las 2-3 funciones nuevas, sin `SELECT`
  directo sobre tablas (patrón `private.datos_despacho_conexion`).
- **Rationale**: Principio I — el worker nunca declara su propia organización
  por parámetro (podría falsificarla); la organización se deriva del rol de
  sesión, igual que en 013/014.
- **Alternatives considered**: claim JWT `organizacion_id` para el worker —
  descartado por la misma razón que en la spec 013 (el worker controla su
  propio entorno y podría falsificarlo).

## R6. Kestra: contrato JDBC reutilizable, ningún flow de dominio nuevo

- **Decision**: FR-012 prohíbe flows dedicados de producto en esta entrega.
  Kestra aporta solo el contrato: dos sentencias documentadas
  (`select iniciar_ejecucion_worker(...)`, `select cerrar_ejecucion_worker(...)`) invocables
  desde cualquier flow existente (genérico/dedicado de la spec 013) por JDBC
  con el rol `kestra_orquestacion`, más la convención de adjuntar evidencia
  (subir a Storage y pasar rutas al cerrar). Sin plantilla `.yml` nueva salvo
  el snippet contractual en `contracts/`; sin cambios a `plantilla-generico.yml`
  / `plantilla-dedicado.yml` / `alertas.yml` más allá de documentar el orden
  de llamadas.
- **Rationale**: FR-010 pide contrato reutilizable sin copiar lógica; FR-012
  pide no trasladar dominio al template. Un snippet + funciones SQL cumple
  ambas sin tocar los flows en producción.
- **Alternatives considered**: subflow Kestra nuevo `ciclo-ejecucion.yml` —
  descartado en esta fase por simplicidad (V); si un tercer producto necesita
  el mismo SNP de llamadas, se extrae a subflow en una evolución posterior.

## R7. Adopción en producto derivado (US3/FR-011): reconciliación aditiva documentada

- **Decision**: guía `docs/adoptar-ciclo-ejecuciones.md` + función idempotente
  `registrar_adopcion_ciclo(p_version_template)` que inserta la versión de
  origen si no existe (sin recrear tablas compatibles ni tocar dominio).
  Diferencias compatibles (nombres/columnas extra del producto) se reconcilian
  solo de forma aditiva: `ADD COLUMN IF NOT EXISTS` / índices `IF NOT EXISTS`
  documentados en la guía, nunca `DROP/RENAME` en el mismo PR (Technology
  Gates). El producto que originó el patrón es el primer caso de prueba y su
  tabla de dominio no se migra.
- **Rationale**: SC-005 exige adoptar sin duplicar historiales y con referencia
  verificable a la versión del template. El registro de versión hace
  verificable la adopción; la reconciliación solo-aditiva hace seguro
  reejecutarla.
- **Alternatives considered**: migración automática que renombra al contrato del
  template — descartada por FR-011 y por la regla de migraciones (destruir en
  el mismo PR que crea está prohibido).
