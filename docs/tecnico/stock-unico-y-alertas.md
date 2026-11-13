---
owner: tecnico
sources:
  - supabase/migrations
  - supabase/tests/database
  - apps/web/src
---

# Stock único y alertas: cola de eventos y Realtime (MSF-231)

**Épica:** MSF-231 · **Historias:** F-STK-04 (MSF-249, stock único y consistente entre canales) y
F-STK-01 (MSF-268, stock actual con alertas de reposición).
**Spec:** `specs/20261018-180000-stock-unico-y-alertas/`.
**Alcance de entrega:** `refine` (`apps/web`) y `supabase`. Sin `kestra`, `superset` ni `workers`.

El lado de producto (qué resuelve, para quién y límites) está en
[Stock único y alertas](../producto/stock-unico-y-alertas.md). El DER del grafo está en
[Datos · Stock único y alertas](datos.md#stock-unico-y-alertas-msf-231).

## Estado de entrega

Las migraciones `20261018180000`–`20261018180500` y `20261018190000`, el hook
`apps/web/src/lib/useExistenciasRealtime.ts` y el enganche en `apps/web/src/pages/stock/list.tsx` se
construyeron en la rama `epic/MSF-231-stock-stock-unico-y-alertas` (commits `4c82a599` para la cola y
`6f9ca5f4` para Realtime, con las correcciones `bc4e351f`, `aa828049` y `d5fe7704`). La épica se integró
al lote de STG en `112250fd`; a la fecha de esta página **todavía no está promovida a `main`**. Todo lo de
abajo se verificó contra esas migraciones, las pruebas y el código de la rama.

## Migraciones (aditivas)

| Migración | Contenido | Reversión |
|---|---|---|
| `20261018180000_stock_cola_eventos.sql` | Tabla `public.cola_eventos`, índices parciales, RLS y grants de lectura | `drop table public.cola_eventos` (exportar antes los eventos pendientes) |
| `20261018180100_stock_evento_actualizado.sql` | `private.emitir_stock_actualizado()` y disparador `movimientos_stock_emitir_evento` | `drop trigger …` y `drop function private.emitir_stock_actualizado()` |
| `20261018180200_cola_eventos_reclamo.sql` | `private.reclamar_eventos` y `private.resolver_evento` | `drop function` de ambas firmas |
| `20261018180300_cola_eventos_correcciones.sql` | `ocurrido_en` con reloj real, tope de intentos y reclamo vencido | Reaplicar las funciones anteriores |
| `20261018180400_cola_eventos_interno.sql` | Lógica en `private.*_interno` sin guarda de rol, para pgTAP; las públicas conservan la guarda | `drop function` de las `_interno` y reaplicar las públicas |
| `20261018180500_cola_eventos_interno_revoke_service_role.sql` | Revoca `service_role` de las `_interno` | `grant execute` a `service_role` si se quisiera volver atrás |
| `20261018190000_stock_existencias_realtime.sql` | Agrega `dominio.existencias` a la publicación `supabase_realtime` | `alter publication supabase_realtime drop table dominio.existencias` |

Cada archivo trae su reversión completa en el encabezado. Nada se destruye en el mismo PR que lo crea.

## Modelo de datos

- **`public.cola_eventos` (nueva, Principio VII):** es infraestructura transversal de eventos de dominio,
  no una entidad de negocio de Stock (la consumirán integraciones de otros componentes). Columnas: `id`,
  `organizacion_id` (FK a `public.organizaciones`, `on delete cascade`), `tipo`, `clave_idempotencia`,
  `carga` (jsonb), `estado`, `intentos`, `proximo_intento_en`, `reclamada_en`, `vence_en`,
  `ultimo_error_sanitizado`, `created_at` y `updated_at`.
  - `unique (organizacion_id, tipo, clave_idempotencia)` da la idempotencia; `estado` admite
    `pendiente`, `reclamada`, `completada` y `agotada`; un `check` exige fechas de reclamo solo en
    `reclamada`; `intentos >= 0`.
  - Índices parciales por `(tipo, proximo_intento_en, created_at)` para pendientes y por `vence_en` para
    reclamos.
- **`dominio.existencias` (existente):** no cambia de esquema. Es la cantidad única por producto y se
  publica en Realtime para el listado. La RLS por organización y `nivel_seccion('stock')` sigue vigente.
- **`dominio.movimientos_stock` (existente):** no cambia de esquema. Gana el disparador
  `movimientos_stock_emitir_evento` (`AFTER INSERT`) que emite el evento en la misma transacción.
- La escritura de cantidad sigue siendo **solo** `public.registrar_movimiento_stock` (MSF-136); esta épica
  no la reemplaza.

**[ERD interactivo (Archify)](../diagrams/msf-231-erd.html)** — cola de eventos, existencias, movimientos,
productos y organizaciones.

## Contrato del evento `stock.actualizado`

Se emite **un evento por cada movimiento aceptado** (entrada, salida o ajuste). Si la RPC revierte (por
ejemplo, saldo negativo), el evento no existe. Definir el mínimo no inserta movimiento y no emite.

| Campo de `carga` | Significado |
|---|---|
| `organizacion_id` | Organización dueña del stock. |
| `producto_id` | Producto afectado. |
| `movimiento_id` | Id del movimiento en `dominio.movimientos_stock`; es también la clave de idempotencia. |
| `tipo_movimiento` | `entrada`, `salida` o `ajuste`. |
| `cantidad` | **Cantidad resultante** tras el movimiento (el saldo), no la cantidad informada. |
| `diferencia` | Cambio con signo (`+5` en una entrada de 5, `-2` en una salida de 2; en un ajuste, contado − anterior). |
| `ocurrido_en` | Instante de emisión bajo el lock del producto (`clock_timestamp()`, `timestamptz`): estrictamente creciente por producto, no el `now()` de la transacción. |

Un consumidor debe tratar `cantidad` como el valor vigente para ese producto; ante eventos fuera de
orden gana el de `ocurrido_en` más reciente.

El disparador inserta con `on conflict (organizacion_id, tipo, clave_idempotencia) do nothing`, así que
un reintento no duplica el evento. La función es *security definer* con `search_path = ''` y sin
ejecución para `public`, `anon` ni `authenticated`.

## Reclamo, lease y reintentos

```ts
private.reclamar_eventos(
  p_tipo text,
  p_limite integer default 10,
  p_duracion_reclamo_seg integer default 300,
  p_max_intentos integer default 3
) returns table (evento_id, organizacion_id, tipo, clave_idempotencia, carga, intento, vence_en)

private.resolver_evento(
  p_evento_id uuid,
  p_intento integer,
  p_accion text,                    // confirmar | liberar | agotar
  p_motivo_sanitizado text default null,
  p_demora_seg integer default 60,
  p_max_intentos integer default 3
) returns text
```

- Límites: 1–100 eventos por reclamo, lease de 1–3600 s (300 s por defecto), demora de 60 s y 3 intentos
  máximos (1–20) por defecto, igual que la outbox del template.
- Solo las ejecuta un superusuario o el rol `kestra_orquestacion`. La lógica está en
  `private.reclamar_eventos_interno` y `private.resolver_evento_interno` (sin guarda de rol, para pgTAP);
  las públicas mantienen la guarda y delegan. Las cuatro están revocadas para `public`, `anon` y
  `authenticated`; las `_interno` también para `service_role`.
- El reclamo usa `for update skip locked`: cada evento lo recibe un solo consumidor. Un reclamo no
  confirmado antes de `vence_en` vuelve a `pendiente` con `ultimo_error_sanitizado = 'RECLAMO_VENCIDO'`,
  o pasa a `agotada` si ya alcanzó `p_max_intentos`.
- `confirmar` completa el evento; `liberar` lo devuelve a `pendiente` con espera
  `p_demora_seg × 2^(intentos−1)` o lo agota al llegar al máximo; `agotar` lo cierra como agotado.
- Resolver un intento vencido o reemplazado responde `RECLAMO_NO_VIGENTE`. Un evento `agotada` se revisa a
  mano.
- El flow de Kestra que consuma la cola debe pasar **el mismo `p_max_intentos`** a `reclamar_eventos` y a
  `resolver_evento`.
- Sin consumidor, los eventos quedan `pendiente`: no se pierden y no bloquean la escritura de stock.

### Por qué no se reutiliza `despachos_ejecucion`

Su `ejecucion_id` es `not null unique` hacia `ejecuciones_worker`: está atada a órdenes de ejecución de
worker y no admite eventos de dominio sin ejecución. Se copió el **modelo** (estados, lease, reintentos,
error sanitizado), no el código. Decisión aprobada por Nicolás el 2026-10-18.

## Realtime sobre `dominio.existencias`

- **Publicación:** `20261018190000_stock_existencias_realtime.sql` agrega `dominio.existencias` a
  `supabase_realtime` de forma idempotente. Si la publicación no existe (entorno sin Realtime), avisa y
  sigue para no romper el reset local. Realtime aplica a cada suscriptor la RLS de la tabla, así que otra
  organización no recibe sus cambios.
- **Hook:** `apps/web/src/lib/useExistenciasRealtime.ts` abre un canal
  `existencias:<organizacion_id>`, escucha `postgres_changes` (`event: '*'`) con filtro
  `organizacion_id=eq.<id>` en el esquema `dominio` y agrupa avisos con una ventana de 300 ms. Se limpia al
  desmontar y se vuelve a abrir al cambiar la organización activa.
- **Refresco:** `list.tsx` pasa `refrescar` (que vuelve a pedir el listado y el resumen). La tabla lee
  `public.stock_estados` (MSF-136), no `existencias` directo: el aviso de Realtime dispara la recarga de la
  vista. Se conservan búsqueda, filtro de estado y página; la tabla no se vacía, así que el foco no se
  mueve.
- **Caídas:** si el canal falla (`CHANNEL_ERROR` / `TIMED_OUT`) o no se puede crear, queda un aviso en
  consola y la pantalla sigue usable con los últimos datos; se puede recargar a mano.

## Permisos

No se cambia ningún permiso de Stock. `lectura` y `edicion` ven el listado; `ninguno` no accede. Con
`lectura` no hay botones de edición; con `edicion` se registran movimientos y se edita el mínimo
(MSF-136). La RLS de `existencias` y de `stock_estados` sigue siendo la autoridad; Realtime la aplica por
suscriptor. En `public.cola_eventos` solo el Administrador de la organización puede leer; `authenticated`
no tiene escritura y `anon` no tiene privilegios.

## Pruebas

- pgTAP `supabase/tests/database/stock_cola_eventos.test.sql` (58 aserciones): estructura, privilegios,
  un evento por movimiento, ninguno en un rechazo, el mínimo no emite, sin consumidor queda `pendiente`,
  reclamo exclusivo, lease vencido, reintento con espera, `agotada`, confirmación vencida y aislamiento
  por organización y rol.
- pgTAP `supabase/tests/database/stock_realtime.test.sql` (5 aserciones): `existencias` está en
  `pg_publication_tables` y cada organización solo ve sus filas.
- Vitest `apps/web/src/lib/useExistenciasRealtime.test.tsx`: un aviso dispara un refresco, una ráfaga se
  agrupa, se re-suscribe al cambiar de organización y el desmontaje limpia el canal.
- Vitest `apps/web/src/pages/stock/list.test.tsx`: un aviso recarga listado y resumen conservando
  búsqueda, filtro, página y foco.
- E2E `apps/web/e2e/stock-concurrencia.e2e.ts`: 20 salidas simultáneas por PostgREST sobre stock 10 y dos
  sesiones de empresas distintas ven la misma cantidad. Requiere Supabase local y se omite sin
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`; no corre en el CI público.
- E2E `apps/web/e2e/stock-actual-vivo.e2e.ts`: dos sesiones; una registra la salida y la otra ve cantidad,
  estado y resumen actualizados sin recargar. Mismas condiciones que el anterior.

## Operación

- Sin consumidor en el Hito 2, la cola puede crecer en `pendiente`: es lo esperado y no afecta el stock.
- Para revisar el estado de la cola y los pasos de diagnóstico está el runbook
  [Cola de eventos trabada](runbooks/cola-eventos.md#cola-stockactualizado-msf-231).
- El futuro consumidor (MSF-123) reclamará `stock.actualizado`, enviará el stock a Mercado Libre y
  resolverá con `confirmar`, `liberar` o `agotar`.

## Reversión

En una migración posterior y exportando antes los eventos pendientes si importan:

```sql
drop trigger movimientos_stock_emitir_evento on dominio.movimientos_stock;
drop function private.emitir_stock_actualizado();
drop function private.reclamar_eventos(text, integer, integer, integer);
drop function private.resolver_evento(uuid, integer, text, text, integer, integer);
drop function private.reclamar_eventos_interno(text, integer, integer, integer);
drop function private.resolver_evento_interno(uuid, integer, text, text, integer, integer);
drop table public.cola_eventos;
```

Para deshacer Realtime, en una migración posterior:
`alter publication supabase_realtime drop table dominio.existencias;`. El listado sigue funcionando por
consulta normal.

Los comandos exactos están en el encabezado de cada migración. Nada de esto se ejecuta en el PR que crea
las estructuras.

## Referencias

- Producto: [Stock único y alertas](../producto/stock-unico-y-alertas.md).
- DER: [Datos · Stock único y alertas](datos.md#stock-unico-y-alertas-msf-231).
- RPC: [API y RPC · Stock único y alertas](api.md#stock-unico-y-alertas-msf-231).
- Runbook: [Cola de eventos trabada](runbooks/cola-eventos.md).
- Spec: `specs/20261018-180000-stock-unico-y-alertas/`.
