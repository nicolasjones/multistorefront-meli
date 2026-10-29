---
owner: producto
sources:
  - specs
---

# Stock · Depósitos y existencias por depósito (F-STK-14, MSF-316)

Spec: `specs/20261022-180000-stock-depositos-y-reservas/` (épica MSF-292). Esta guía cubre F-STK-14: el
administrador define depósitos, cada producto muestra su stock por depósito sobre un **total único** y cada
movimiento elige depósito. El traslado (F-STK-15) y las reservas a pedido (F-STK-16) tienen su propia guía.

## Modelo (esquema `dominio`, Principio VII)

Todas las tablas nuevas son negocio de Stock y viven en `dominio`, nunca en `public`; `public` solo expone
vistas de lectura (`security_invoker`) y la RPC de movimiento.

| Objeto | Para qué | Escritura |
|--------|----------|-----------|
| `dominio.depositos` (nueva) | Depósitos de la organización: nombre ≤ 80 único sin distinguir mayúsculas, dirección opcional ≤ 200, `activo`, `por_defecto`. | Solo RPC de gestión. Sin DELETE: se desactivan. |
| `dominio.depositos_empresas` (nueva) | «Venden desde acá»: qué empresas pueden vender desde cada depósito. | Solo RPC de gestión. |
| `dominio.existencias_deposito` (nueva) | `cantidad` y `reservado` por producto y depósito; `cantidad ≥ 0`, `reservado ≥ 0`, `reservado ≤ cantidad`. | Solo RPC de stock. |
| `dominio.existencias` (existente) | Sigue siendo el **stock total único** por producto (`cantidad` = suma por depósito) y gana `reservado` (suma por depósito). | Solo RPC de stock. |
| `dominio.movimientos_stock` (existente) | El libro gana `deposito_id`; `saldo` sigue siendo el total único. | Solo la RPC. |

**Disponible = cantidad − reservado**, por depósito y en total. Ninguna salida, ajuste, traslado ni reserva puede
dejar el disponible de un depósito por debajo de 0.

RLS en las tres tablas nuevas: `select` para `authenticated` con `organizacion_id = private.organizacion_id()` y
`private.nivel_seccion('stock') in ('lectura','edicion')`. No hay `insert`/`update`/`delete` directos: la UI y la
app escriben solo por RPC `security definer`. `anon` no tiene privilegios. `existencias_deposito` está publicada
en `supabase_realtime`.

## Backfill D-9

La migración `20261023120000_depositos_tablas.sql`:

1. Crea «Depósito principal» (activo, por defecto) en **todas** las organizaciones existentes y, por disparador,
   en cada organización nueva.
2. Asigna a ese depósito toda la `cantidad` actual de `existencias` (el total de cada producto no cambia).
3. Deja los movimientos históricos con `deposito_id` del depósito principal (suspende el disparador de
   inmutabilidad del libro solo durante la migración, en su transacción).
4. Índice único parcial que garantiza **un solo depósito por defecto** por organización; el `check`
   `depositos_defecto_activo` impide un por defecto inactivo.

Reversión en el encabezado de la migración (migración posterior, exportando antes los datos):
`drop table dominio.existencias_deposito, dominio.depositos_empresas, dominio.depositos`, `drop column
movimientos_stock.deposito_id` y `existencias.reservado`, previa restauración de `registrar_movimiento_stock`.

## RPC de gestión (solo Administrador)

Migración `20261023120100_depositos_gestion.sql`; todas *security definer* con `search_path = ''`, `revoke … from
public, anon` y `grant execute … to authenticated`, y exigen `private.puede_escribir()` (Administrador de la
organización activa).

| RPC | Reglas |
|-----|--------|
| `crear_deposito(p_nombre, p_direccion, p_empresas)` | Nombre 1…80 recortado y único; dirección ≤ 200; empresas de la organización. Nace activo y no por defecto. |
| `actualizar_deposito(p_deposito, p_nombre, p_direccion, p_empresas)` | Mismo formulario; `p_empresas = null` no toca el conjunto. |
| `definir_deposito_por_defecto(p_deposito)` | Bloquea los depósitos de la organización y deja exactamente uno por defecto; un inactivo no puede serlo. |
| `cambiar_activo_deposito(p_deposito, p_activo)` | El por defecto no se desactiva; uno con unidades tampoco («Tiene stock: trasladá la mercadería antes de desactivarlo»); un inactivo no admite entradas. |

Mensajes (los espeja `apps/web/src/lib/depositos.ts`):

- «Solo el Administrador puede definir depósitos»
- «Ya existe un depósito con ese nombre»
- «El nombre del depósito debe tener entre 1 y 80 caracteres»
- «La dirección admite hasta 200 caracteres»
- «Alguna de las empresas elegidas no es válida»
- «No encontramos ese depósito»
- «Activá el depósito antes de usarlo por defecto»
- «El depósito por defecto no se puede desactivar»
- «Tiene stock: trasladá la mercadería antes de desactivarlo»

Reversión: `drop function` de las cuatro RPC y de las funciones `private` de apoyo.

## Movimientos por depósito

Migración `20261023120200_stock_movimiento_deposito.sql`:

- `private.aplicar_movimiento_deposito(organizacion, producto, deposito, Δcantidad, Δreservado, marcar)` es la
  **única** rutina que cambia cantidad y reservado. Serializa por producto (`select … for update` sobre
  `existencias`), mantiene `existencias` = suma de `existencias_deposito` en la misma transacción y rechaza con
  `23514` «No hay stock suficiente» cuando el disponible del depósito quedaría negativo. El rechazo revierte todo:
  sin movimiento, evento ni actividad.
- `public.registrar_movimiento_stock` gana `p_deposito uuid default null` al final (contrato aditivo, alto riesgo).
  Sin `p_deposito` usa el depósito por defecto: los llamadores anteriores siguen funcionando. El depósito se toma
  `for share`, así que no se puede desactivar mientras entra o sale mercadería; uno inactivo no admite movimientos.
  En un ajuste, `p_cantidad` es el stock contado **en ese depósito**.
- El libro guarda `deposito_id`; `saldo` y `stock.actualizado.cantidad` siguen siendo el total único.

Reversión: `drop function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid)`,
restaurar la firma de 6 parámetros de `20261017140100` + `20261017170000` y `drop function
private.aplicar_movimiento_deposito`.

## Evento `stock.actualizado` ampliado

Migración `20261023120300_stock_evento_deposito.sql`: la carga gana, de forma **aditiva**, `deposito_id`,
`reservado` (total) y `disponible` (total). `cantidad` sigue siendo el saldo total y `diferencia` el cambio del
movimiento. Se emite una vez por movimiento y en la misma transacción. El contrato completo vive en
`docs/stock-eventos.md`.

Reversión: restaurar `private.emitir_stock_actualizado()` de `20261021161000_stock_evento_actualizado.sql`.

## Lecturas

Migración `20261023120400_stock_lecturas_deposito.sql` (sin tablas nuevas):

- `public.stock_estados` (ampliada): `reservado` y `disponible` al final; el estado pasa a calcularse sobre el
  **disponible total** (`sin_stock` = 0, `stock_bajo` ≤ mínimo). Con `reservado = 0` el resultado es idéntico.
- `public.stock_por_deposito` (nueva): `producto_id`, `deposito_id`, `cantidad`, `reservado`, `disponible`.
- `public.depositos_listado` (nueva): la tabla de la pantalla, con empresas (`empresas` y `empresa_ids`),
  `productos_con_stock` y `unidades`.
- `public.listar_movimientos_stock` (ampliada): `deposito_id` y `deposito_nombre` al final.

Todas son `security_invoker` (rige la RLS de Stock) y `anon` no tiene acceso. Reversión: `drop view` de las
nuevas y restaurar las versiones anteriores de `stock_estados` y `listar_movimientos_stock`.

## Interfaz

- Pestaña «Depósitos de mercadería» en Stock, ruta `/stock/depositos` (carga diferida, mismo ítem «Stock» de la
  navegación). `lectura` ve la tabla sin botones; `ninguno` no accede.
- La tabla muestra Depósito, Dirección, Venden desde acá, Productos con stock, Unidades, Por defecto, Activo y
  acciones. El botón «Nuevo depósito de mercadería», «Editar», «Usar por defecto» y el switch «Activo» son solo
  del Administrador. El diálogo (carga diferida) pide Nombre, Dirección y «Pueden vender desde acá».
- **Empresa activa (Principio VIII)**: la pantalla se filtra por la empresa de la barra superior según «Venden
  desde acá»; con «Todas mis empresas» lista todos. Al cambiar de empresa recarga e invalida lo anterior (nunca
  muestra filas de la empresa previa) y cierra el diálogo abierto con aviso.
- `/stock`: columnas Stock, Reservado y Disponible; control de depósito («Todos los depósitos» o uno activo, D-4)
  que cambia las cifras. El estado y las alertas siguen calculándose sobre el disponible total. El diálogo de
  movimiento agrega «Depósito de mercadería» (activos, por defecto preseleccionado) y avisa la falta de stock con
  el disponible de ese depósito.
- `/stock/movimientos`: el detalle agrega la columna Depósito y arriba aparece el resumen por producto con Queda,
  Reserv. y Disp.

## Pruebas

- pgTAP `supabase/tests/database/stock_depositos.test.sql` (FR-001/003/004/006/007/015, SC-001/004/005) y
  `stock_deposito_disponible.test.sql` (FR-008/009/013, SC-006). `pnpm test:db` (requiere `pnpm dev:supabase`).
- E2E `apps/web/e2e/stock-deposito-concurrencia.e2e.ts` (SC-002): 20 salidas de 1 sobre disponible 10 → 10
  aceptadas y disponible 0. Requiere el stack local; ver `docs/e2e-app.md`.
- Vitest: `apps/web/src/pages/stock/depositos.test.tsx`, `list.test.tsx`, `movimientos.test.tsx` y
  `NuevoMovimientoDialog.test.tsx`; hook `apps/web/src/lib/useExistenciasRealtime.test.tsx`.

## Verificación local

```bash
pnpm --filter @platform/web lint
pnpm --filter @platform/web build
pnpm --filter @platform/web exec vitest run src/pages/stock src/lib/stock.test.ts src/lib/useExistenciasRealtime.test.tsx
pnpm test:db
pnpm docs:check
```

## Anulación de ingresos y depósito

`anular_ingreso_mercaderia` (migración `20261023120500`) saca cada línea del depósito donde entró el
movimiento original (`movimientos_stock.deposito_id`), no del depósito por defecto de hoy. Test:
`supabase/tests/database/ingresos_anular_deposito_original.test.sql`.

En «Nuevo depósito» la empresa activa de la barra superior viene marcada en «Pueden vender desde
acá», y al cambiar de empresa se limpian el aviso y el diálogo abierto.
