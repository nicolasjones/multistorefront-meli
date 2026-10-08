# Quickstart: validar el respaldo automático de Postgres

## Prerrequisitos

- `pnpm dev:supabase` y `pnpm dev:kestra` corriendo, migración de esta
  spec aplicada (`supabase migration up` / `supabase db reset`).
- Rotar la contraseña local de `kestra_backups` (research.md R8):
  ```sql
  alter role kestra_backups with password '<valor de KESTRA_BACKUPS_DB_PASSWORD en tu .env local>';
  ```
- Cargar el flow `infra/kestra/flows/respaldo-postgres.yml` en el Kestra
  local vía su API (nunca crearlo solo en la UI, research.md R7):
  ```bash
  curl -u "$KESTRA_BASIC_AUTH_USERNAME:$KESTRA_BASIC_AUTH_PASSWORD" \
    -X POST http://localhost:8082/api/v1/flows \
    -H "Content-Type: application/x-yaml" \
    --data-binary @infra/kestra/flows/respaldo-postgres.yml
  ```
  Para actualizarlo después de un cambio, el mismo comando pero `PUT` a
  `.../api/v1/flows/platform.backups/respaldo-postgres`.
- Login como superadmin en Kestra (`KESTRA_BASIC_AUTH_*` de tu `.env`).

## 1. Un backup programado corre y deja un resultado (US1, FR-001, FR-004, FR-006)

1. Disparar manualmente el flow desde la UI de Kestra pasando
   `origen = programado` (simula el `Schedule` sin esperar 24hs).

**Resultado esperado**: aparece una fila nueva en `respaldos` con
`estado = 'en_progreso'` casi de inmediato, y minutos después pasa a
`estado = 'completado'`, con `tamano_bytes` y `ubicacion` completos.

```sql
select id, origen, estado, iniciado_en, finalizado_en, tamano_bytes, ubicacion
from respaldos
order by id desc
limit 5;
```

## 2. Un backup manual sigue el mismo camino (US2, FR-002)

1. Disparar el flow de nuevo, esta vez con `origen = manual`.

**Resultado esperado**: mismo ciclo (`en_progreso` → `completado`), la
fila queda con `origen = 'manual'`, distinguible de la anterior.

## 3. Dos backups no corren a la vez (US2, FR-003)

1. Disparar el flow una vez y, mientras sigue en `en_progreso`, disparar
   una segunda ejecución.

**Resultado esperado**: la segunda ejecución falla en el primer paso
(`iniciar_respaldo`) con el error "Ya hay un respaldo en progreso" —
nunca llega a correr `pg_dump`. Solo una fila queda `en_progreso` a la
vez.

## 4. Un backup que falla queda registrado con motivo (FR-005, FR-006, FR-008)

1. Forzar un fallo (por ejemplo, cortar la conexión a la base durante el
   paso de exportación, o apuntar el flow a un destino de almacenamiento
   sin permisos de escritura).

**Resultado esperado**: la fila correspondiente queda en `estado =
'error'`, con `motivo_error` legible describiendo qué falló — nunca
`completado`. Repetir el paso 1 de esta guía después: un fallo previo no
bloquea un backup nuevo.

## 5. Una fila colgada se auto-sana (research.md R5)

1. Insertar a mano una fila con `estado = 'en_progreso'` e
   `iniciado_en` de hace más de 3 horas (simulando una caída del
   proceso):
   ```sql
   insert into respaldos (origen, estado, iniciado_en)
   values ('programado', 'en_progreso', now() - interval '4 hours');
   ```
2. Disparar el flow.

**Resultado esperado**: la fila vieja pasa a `estado = 'error'` con el
motivo "Backup interrumpido...", y el flow arranca una fila nueva con
normalidad — no queda bloqueado por la fila colgada.

## 6. Nadie fuera del superadmin puede leer el historial (FR-011)

1. Con una sesión de un administrador o miembro de organización
   (cualquiera, no superadmin), intentar `select * from respaldos`.

**Resultado esperado**: cero filas devueltas (RLS lo bloquea), sin
importar qué organización sea.
