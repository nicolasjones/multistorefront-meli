# Quickstart: validar la analítica embebida por organización

## Prerrequisitos

- `pnpm dev:supabase` y `pnpm dev:superset` corriendo, migraciones de esta
  spec aplicadas.
- `infra/superset/superset_config.py` con `EMBEDDED_SUPERSET` activo y CORS
  habilitado para el origen de Refine (research.md #9).
- Secretos de la Edge Function configurados (`SUPERSET_URL`,
  `SUPERSET_GUEST_TOKEN_USERNAME`, `SUPERSET_GUEST_TOKEN_PASSWORD`) —
  ver `supabase/functions/.env.example`. **En local hace falta además que
  el contenedor de Edge Functions de Supabase pueda resolver el contenedor
  de Superset por nombre** — son dos stacks de `docker compose`
  independientes (regla de `CLAUDE.md`, "nunca un Compose raíz"), en redes
  Docker separadas por defecto:
  ```powershell
  docker network connect automation-platform-template-superset-dev_default supabase_edge_runtime_automation-platform-template-supabase-de
  ```
  No sobrevive a `supabase stop && supabase start` (recrea el contenedor) —
  hay que repetirlo. Encontrado corriendo este mismo quickstart (sección
  2); pendiente resolverlo de forma declarativa en los compose de
  `infra/supabase/` e `infra/superset/` en vez de a mano — no forma parte
  de esta spec, ver Notas de `tasks.md`.
- Al menos un dashboard creado en Superset y habilitado para embedding
  (Dashboard → Embed dashboard), con un dataset que tenga columna
  `organizacion_id` (research.md #4) y al menos una fila por cada
  organización de prueba.
- Dos organizaciones creadas (quickstart de la spec 003), cada una con un
  administrador y un miembro (quickstart de la spec 005/006 si ya están
  mergeadas, o alta manual si no).

## 1. El superadmin registra y asigna un reporte (US1, FR-001 a FR-004)

1. Como superadmin, ir a Analítica → Administrar.
2. Registrar el dashboard habilitado, con nombre a mostrar, tildando
   "miembro" en la grilla de default (administrador no aparece como
   opción — siempre incondicional).
3. Asignarlo a la organización X.

**Resultado esperado**: el reporte queda listado con X entre sus
organizaciones asignadas, y la grilla de permisos de X muestra
"miembro" ya tildado (heredado del default).

4. Cambiar el default global a "solo administrador".

**Resultado esperado**: la grilla de X no cambia — el ajuste solo aplica a
asignaciones nuevas (FR-004).

## 2. Miembro y administrador ven el reporte con datos aislados (US2, FR-007 a FR-010)

1. Iniciar sesión como miembro de X, ir a Analítica.
2. Confirmar que el reporte aparece y se abre embebido, con datos de X.
3. Asignar el mismo reporte a la organización Y (paso del superadmin).
4. Iniciar sesión como alguien de Y, abrir el mismo reporte.

**Resultado esperado**: mismo reporte, datos de Y — nunca los de X.

5. Iniciar sesión como alguien de una organización Z sin ningún reporte
   asignado, ir a Analítica.

**Resultado esperado**: mensaje explícito de que no hay reportes
configurados (FR-011), no una pantalla vacía.

6. Intentar acceder al reporte con el `reporte_id` de X estando logueado
   como alguien de Z (por ejemplo, llamando la Edge Function directo con
   ese id).

**Resultado esperado**: `403`, sin datos del reporte (FR-007/FR-010).

## 3. El administrador ajusta la visibilidad de su organización (US3, FR-005/FR-006)

1. Como administrador de X, ir a Analítica → Permisos, destildar "miembro"
   para ese reporte.
2. Iniciar sesión como miembro de X.

**Resultado esperado**: el miembro ya no ve el reporte; el administrador de
X sí (FR-006, acceso incondicional).

3. Confirmar en la grilla de Y (otra sesión, admin de Y) que su
   configuración no cambió.

## 4. Desasignar y reasignar (FR-003, FR-016)

1. Como superadmin, desasignar el reporte de X.
2. Volver a asignarlo a X.

**Resultado esperado**: la grilla de X vuelve a mostrar el default vigente
en ese momento (no lo que X tenía configurado antes de ser desasignada).

## 5. Superset no disponible (FR-015)

1. Detener el contenedor de Superset (`pnpm dev:down:superset`).
2. Como miembro de una organización con un reporte asignado, intentar
   abrirlo.

**Resultado esperado**: mensaje específico de "Analítica no disponible en
este momento" — no un error genérico, no una pantalla rota, no reintentos
automáticos visibles.

## 6. Auditoría (FR-012, SC-004)

1. Repetir cualquiera de los pasos anteriores que asigna, desasigna, o
   cambia visibilidad por rol.
2. Consultar `eventos_reportes` filtrando por `reporte_id`.

**Resultado esperado**: una fila nueva por cada acción, con `actor_user_id`,
`accion`, y (cuando aplica) `organizacion_id` y `detalle` correctos.
