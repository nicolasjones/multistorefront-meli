# Contract: Respaldo automático de Postgres

Dos interfaces distintas: las funciones que el flow de Kestra llama
(servicio→base de datos, rol `kestra_backups`), y el flow de Kestra en sí
(la única forma soportada de disparar o programar un respaldo).

## Funciones (rol `kestra_backups` únicamente)

Ver `data-model.md` para el SQL completo. Resumen de contrato:

### `iniciar_respaldo(p_origen text) returns respaldos`

**Quién**: solo `kestra_backups`.

**Comportamiento**: auto-sana cualquier fila `en_progreso` colgada hace
más de 3 horas (research.md R5), después intenta insertar una fila nueva
en `en_progreso`. Si ya hay una vigente, `raise exception` (`errcode =
'55006'`) — el flow debe interpretar esto como "no ejecutar `pg_dump`,
terminar acá" (FR-003).

**Response**: la fila de `respaldos` recién creada (usar su `id` en los
pasos siguientes del flow).

### `finalizar_respaldo_completado(p_id bigint, p_tamano_bytes bigint, p_ubicacion text) returns void`

**Quién**: solo `kestra_backups`.

**Comportamiento**: marca la fila `p_id` como `completado`, con tamaño y
ubicación del archivo. No-op si la fila no está en `en_progreso` (evita
pisar un estado ya resuelto).

### `finalizar_respaldo_error(p_id bigint, p_motivo text) returns void`

**Quién**: solo `kestra_backups`.

**Comportamiento**: marca la fila `p_id` como `error`, con el motivo.
Debe llamarse desde el bloque `errors:` del flow — cualquier falla en
cualquier tarea del flow termina acá (FR-006, FR-008).

## El flow de Kestra (`infra/kestra/flows/respaldo-postgres.yml`)

**Namespace/id**: `platform.backups` / `respaldo-postgres` (convención:
`platform.*` para mecanismos transversales del template, a diferencia de
un futuro namespace de dominio de un producto derivado).

**Triggers**:
- `Schedule`, diario (FR-001). Horario exacto: decisión de
  implementación, fuera de esta spec (Assumptions de spec.md) — un
  horario de baja actividad razonable por defecto.
- Sin trigger de webhook (research.md R6) — el disparo manual (US2, FR-002)
  es "Execute" desde la propia UI de Kestra, autenticado con
  `KESTRA_BASIC_AUTH_*` (mismo acceso que ya usa el superadmin para
  Superset).

**Pasos** (contrato de orden, no de sintaxis exacta de plugin):

1. Llamar `iniciar_respaldo(p_origen)` — `p_origen` es `'programado'` si
   lo disparó el `Schedule`, `'manual'` si lo disparó una persona. Si esta
   tarea falla (FR-003, dos backups a la vez), el flow termina sin
   ejecutar nada más — no dispara `finalizar_respaldo_error`, porque
   nunca llegó a crear una fila que cerrar.
2. Ejecutar `pg_dump` contra la base del entorno (research.md R3/R4),
   guardando el archivo en el storage interno de Kestra.
3. Verificación estructural del archivo (FR-005): no vacío, formato
   esperado, no cortado a mitad de camino. Nunca un intento de
   restauración real.
4. Si 2 y 3 salieron bien: `finalizar_respaldo_completado(id, tamaño,
   ubicación)`.
5. Bloque `errors:` del flow (se dispara si 2, 3, o el paso 4 fallan):
   `finalizar_respaldo_error(id, motivo)`, con el motivo real del fallo
   (no un genérico "algo salió mal").

**Quién puede disparar/editar el flow**: superadmin únicamente, vía su
acceso directo a Kestra — no hay ninguna pantalla de Refine que dispare
o muestre este flow en esta entrega (Assumptions de spec.md).

## Historial (lectura)

No hay una RPC de lectura dedicada — el superadmin consulta `respaldos`
directo (Supabase Studio, o cualquier cliente autenticado como
superadmin): la policy `respaldos_select` (data-model.md) ya lo permite,
sin necesitar una pantalla de Refine en esta entrega.
