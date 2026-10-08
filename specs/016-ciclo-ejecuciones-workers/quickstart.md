# Quickstart: validar el Ciclo de Ejecuciones

**Spec**: [spec.md](./spec.md) | **Contratos**: [ciclo-ejecuciones](./contracts/ciclo-ejecuciones.md)

Prerrequisitos: `pnpm dev:supabase` corriendo, una organización con conexión
`activa` y rol worker aprovisionado (spec 013), Kestra local opcional.

## 1. Migración y tests de base

```powershell
pnpm lint; if ($?) { pnpm build }; if ($?) { pnpm infra:config }
pnpm test   # incluye supabase/tests/database/ciclo_ejecuciones_workers.test.sql (pgTAP)
```

Esperado: verde; el test pgTAP cubre SC-001 (concurrencia), SC-002 (timeout),
SC-003 (aislamiento entre orgs y por permiso), SC-004 (último éxito intacto
tras falla) y rechazo de motivo con forma de secreto (FR-009).

## 2. Iniciar dos veces la misma capacidad (US1)

```sql
select * from iniciar_ejecucion_worker(:conexion, 'extraer-reporte-x', 'manual', auth.uid());
select * from iniciar_ejecucion_worker(:conexion, 'extraer-reporte-x', 'manual', auth.uid());
-- 1ª: fila en_curso. 2ª: error YA_EN_CURSO, sin fila nueva.
```

## 3. Timeout y reintento (US1 escenario 3)

Con `tiempo_max_seg = 1` en la capacidad, esperar 2s y repetir el iniciar:
la anterior queda `timeout` con motivo `TIMEOUT:1s` y la nueva nace `en_curso`.

## 4. Cerrar, doble cierre y evidencia (US2, FR-005/FR-006)

```sql
select * from cerrar_ejecucion_worker(:ejecucion, 'exitosa', 'OK', '{}', 'org/cap/ej/original.csv', 'org/cap/ej/ejecucion.json');
select * from cerrar_ejecucion_worker(:ejecucion, 'fallida', 'OTRO', '{}');
-- 1º: exitosa con rutas. 2º: YA_CERRADA, sin cambios.
-- Iniciar otra, cerrarla fallida: el último éxito sigue descargable (SC-004).
```

## 5. Aislamiento (US2 escenario 3)

Como miembro sin permiso de auditoría u otra organización: `SELECT` sobre
`ejecuciones_worker` y descarga de evidencia devuelven cero filas/403.

## 6. Adopción (US3)

Sobre producto compatible: correr migración + `registrar_adopcion_ciclo('016')`,
verificar `SELECT version` y cero objetos duplicados
([adopcion-reconciliacion](./contracts/adopcion-reconciliacion.md)).
