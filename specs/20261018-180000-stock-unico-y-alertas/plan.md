# Implementation Plan: Stock · Stock único y alertas

**Branch**: `epic/MSF-231-stock-stock-unico-y-alertas` | **Spec**: `specs/20261018-180000-stock-unico-y-alertas/spec.md`

**Delivery scope**: `refine`, `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Dos historias independientes (corren en paralelo):

- **F-STK-04 (L, solo base de datos)**: la serialización y el rechazo de negativos ya existen (MSF-136: `select … for update` en `registrar_movimiento_stock` + disparador F-STK-06). Se agrega (1) la cola durable `public.cola_eventos` con el modelo de la outbox del template, (2) el disparador que emite `stock.actualizado` en la misma transacción, (3) las funciones de reclamo/resolución con lease y reintentos, y (4) la prueba de concurrencia real (20 salidas sobre stock 10).
- **F-STK-01 (M, UI + Realtime)**: el listado `/stock` con estados, filtros y resumen ya lo entregó MSF-136 (F-STK-05). Se agrega la publicación de `dominio.existencias` en Realtime, el hook de suscripción y el refresco en vivo del listado; se confirma el resto contra los requisitos y se cubre con Vitest y E2E de dos sesiones.

## Technical Context

- **Stack**: Refine + MUI (`apps/web`), Supabase self-hosted (migraciones en `supabase/migrations`, pgTAP en `supabase/tests/database`), Vitest, Playwright (`apps/web/e2e`). Supabase Realtime vía `supabaseClient.channel(...).on('postgres_changes', …)` (el relevamiento del template no trae hook propio: se escribe uno mínimo).
- **Archivos existentes que se tocan**: `apps/web/src/pages/stock/list.tsx` (+ `list.test.tsx`), `docs/stock.md`. **Nuevos**: 4 migraciones, 2 pgTAP, `apps/web/src/lib/useExistenciasRealtime.ts` (+ test), 2 E2E, `docs/stock-eventos.md`.
- **Riesgo conocido**: el relevamiento no verificó Realtime en self-hosted; si la publicación o el JWT por suscriptor no se comportan como se espera, el listado cae a recarga manual (US2-5) y se traza como `seguimiento` — no bloquea F-STK-04.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I Multi-tenant | `cola_eventos` con RLS por organización, sin escritura de la app, `anon` sin privilegios; Realtime respeta la RLS de `existencias`. |
| II Especificar antes | Spec con FR/SC; cada tarea referencia FR/SC. |
| III Idempotente y auditable | Un evento por movimiento (clave = id del movimiento, `on conflict do nothing`); intentos, estado y error sanitizado en la cola. |
| IV Despliegues independientes | Sin Compose ni worker nuevos. |
| V Simplicidad | Sin consumidor ni infraestructura nueva: solo una tabla, un disparador y funciones. |
| VI Panel operable | Sin pantalla nueva; la actualización en vivo conserva foco/filtros; 320/768/1440 px; estados compartidos. |
| VII Esquemas | `cola_eventos` → **`public`** (infraestructura transversal, como `despachos_ejecucion`); `existencias`/`movimientos_stock` siguen en **`dominio`**. Re-verificado en spec; se re-verifica en tareas, implementación y revisión (T017). |
| VIII Documentación | `docs/stock-eventos.md` (F-STK-04) y sección en `docs/stock.md` (F-STK-01). |

Excepciones: ninguna.

## Diseño

### Cola de eventos (F-STK-04)

`public.cola_eventos`: `id uuid pk`, `organizacion_id` (FK `public.organizaciones`, `on delete cascade`), `tipo text` (por ahora `stock.actualizado`), `clave_idempotencia text not null`, `carga jsonb not null`, `estado` (`pendiente|reclamada|completada|agotada`), `intentos`, `proximo_intento_en`, `reclamada_en`, `vence_en`, `ultimo_error_sanitizado`, `created_at`, `updated_at`. `unique (organizacion_id, tipo, clave_idempotencia)`. Mismo `check` de coherencia reclamada↔fechas e índices parciales que `despachos_ejecucion`. RLS: select con `private.es_administrador_de(organizacion_id)`; `revoke all … from public, anon, authenticated` y `grant select` de columnas a `authenticated`.

**Por qué no se reutiliza `despachos_ejecucion`**: su `ejecucion_id` es `not null unique` hacia `ejecuciones_worker` (órdenes de worker). Un evento de dominio sin consumidor no tiene ejecución. Se copia el *modelo* (no el código) para que un futuro consumidor (Kestra/worker en Etapa 2) lo trate igual.

### Emisión del evento

`private.emitir_stock_actualizado()` (*security definer*, `search_path = ''`, `revoke execute … from public, anon, authenticated`), disparador `AFTER INSERT ON dominio.movimientos_stock FOR EACH ROW`. Inserta `stock.actualizado` con `carga = {organizacion_id, producto_id, movimiento_id, tipo_movimiento, cantidad (= saldo), diferencia, ocurrido_en}` y `on conflict do nothing`. Corre dentro de la transacción de la RPC: si la RPC revierte (p. ej. saldo negativo), el evento no existe. `definir_minimo_stock` no inserta movimiento → no emite.

### Reclamo y resolución

`private.reclamar_eventos(p_tipo, p_limite, p_duracion_reclamo_seg)` y `private.resolver_evento(p_evento, p_intento, p_resultado, p_error)`: reclamo con `for update skip locked`, vencimiento del lease que devuelve a `pendiente`, espera creciente entre reintentos y paso a `agotada`; no se confirma un intento vencido o reemplazado. Se **replican los límites y valores por defecto** de `private.reclamar_despachos_ejecucion` (límite 1–100, lease 1–3600 s, 300 s por defecto) y se verifica el máximo de intentos y el backoff de `resolver_despacho_ejecucion` al implementar. Solo ejecutables por el rol de orquestación/superusuario (como la outbox); en el Hito 2 nadie las llama fuera de las pruebas.

### Realtime (F-STK-01)

Migración idempotente: `alter publication supabase_realtime add table dominio.existencias` (si aún no está). El hook `useExistenciasRealtime(organizacionId, alCambiar)` abre un canal por organización con filtro `organizacion_id=eq.<id>`, llama a `alCambiar` agrupando ráfagas (debounce corto), se desuscribe al desmontar o cambiar de organización y no lanza error si el canal falla (el listado queda con la última carga). `list.tsx` pasa su `cargar()` (que ya respeta búsqueda, filtro y página) y refresca también el resumen.

### Pruebas

- pgTAP: `stock_cola_eventos.test.sql` (SC-002, 003, 005), `stock_realtime.test.sql` (SC-007).
- Concurrencia real: `apps/web/e2e/stock-concurrencia.e2e.ts` con `APIRequestContext` lanzando 20 RPC en paralelo contra el Supabase local (pgTAP corre en una sola conexión y no puede probar carreras) (SC-001).
- Vitest: hook y listado (SC-006, SC-008).
- E2E de dos sesiones: `apps/web/e2e/stock-actual-vivo.e2e.ts` (SC-004). Si la suite Playwright no puede correr en el entorno, se cierra con `[x]` + `Desvío:` y seguimiento trazado, nunca `[ ]`.

### Migraciones y reversión (aditivas)

| Migración | Contenido | Reversión (migración posterior) |
|-----------|-----------|----------------------------------|
| `20261018180000_stock_cola_eventos.sql` | tabla, índices, RLS, grants | `drop table public.cola_eventos` (exportar antes los eventos pendientes) |
| `20261018180100_stock_evento_actualizado.sql` | función y disparador | `drop trigger movimientos_stock_emitir_evento on dominio.movimientos_stock; drop function private.emitir_stock_actualizado()` |
| `20261018180200_cola_eventos_reclamo.sql` | reclamo y resolución | `drop function private.reclamar_eventos(...); drop function private.resolver_evento(...)` |
| `20261018190000_stock_existencias_realtime.sql` | publicación Realtime | `alter publication supabase_realtime drop table dominio.existencias` |

Ninguna destruye datos ni columnas existentes. Cada historia trae sus migraciones; no se encadenan entre historias.

## Re-verificación de esquemas (T017, Principio VII)

Contrastado contra las migraciones reales:

| Objeto | Esquema declarado | Migración | RLS / acceso |
|--------|-------------------|-----------|--------------|
| `cola_eventos` | `public` | `20261018180000` | RLS: select solo Administrador (`es_administrador_de`); sin escritura para `authenticated`; `anon` sin privilegios |
| `existencias` | `dominio` | `20261017140000` | RLS por `organizacion_id` + nivel de sección `stock`; publicada en `supabase_realtime` por `20261018190000` (idempotente) |
| `movimientos_stock` | `dominio` | `20261017140000` | RLS por organización; el disparador `movimientos_stock_emitir_evento` emite el evento |
| Funciones `private.*` (emitir, reclamar/resolver y `_interno`) | `private` | `180100`–`180500` | *security definer*, `search_path = ''`, sin ejecución para `public/anon/authenticated`; reclamo/resolución solo para `kestra_orquestacion` |

Resultado: los esquemas coinciden con lo declarado; sin desvíos.

## Pendientes de confirmar (no bloquean)

- Talla de F-STK-04: se mantiene **L** porque el template no cubre el transporte de eventos de dominio (ver spec, Decisión 2). Si Nicolás prefiere otra cosa, cambia el plan, no la spec.
