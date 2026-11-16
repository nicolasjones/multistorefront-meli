---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ventas · cierre de caja (técnico, MSF-193)

Implementación de la épica **MSF-193** (*Ventas y despacho · Ventas mejoras*, spec
`specs/20261027-100000-ventas-mejoras`), historia **F-VTA-33** (Jira **MSF-349**): el **cierre de
caja diario por empresa**, que resume los cobros del día por forma de pago y cuenta y **bloquea** su
modificación hasta reabrirlo.

La vista de producto está en [Cierre de caja (producto)](../producto/ventas-cierre-caja.md). Las otras
dos historias de la épica están en [Venta de mostrador (técnico)](ventas-mostrador.md) (F-VTA-31 /
MSF-329) y en [Precios especiales por cliente (técnico)](ventas-precios-especiales.md) (F-VTA-32 /
MSF-340).

!!! note "Estado"
    Implementado en la rama `epic/MSF-193-ventas-mejoras` (rama de la épica), **pendiente de merge a
    `main`**. La historia llegó por la rama `feat/story-MSF-349` (PR #512, merge `3c748a0d`).
    Migraciones: `20270202201100_cierres_caja.sql`, `20270202201101_cierres_caja_rpc.sql` y
    `20270202201102_bloqueo_cobros_cerrados.sql`. Alcance de entrega: `refine` y `supabase`. Sin
    `kestra`, `superset` ni `workers`.

!!! warning "Banda de versiones de las migraciones"
    Las tres migraciones usan una banda **nueva y mayor** a propósito (`20270202201100`–`20270202201102`):
    con los números que nombra `tasks.md` (`20261213300100`–`20261213300300`) quedaban por debajo de la
    cola ya aplicada en `dokploy` y `supabase db push` las rechaza; el guard
    `scripts/verificar-migraciones.mjs` lo marca como «versión REUSADA» y `pnpm docs:check` falla. La
    épica renumeró sus seis migraciones en el commit `9b546a58` y corrigió las referencias en
    `1d6db0d3`.

## Pantallas y rutas

| Ruta | Pantalla | Archivos | Historia |
|---|---|---|---|
| `/ventas/cierre-caja` | **Cierre de caja**: filtro de tienda, tabla de cierres (Tienda, Fecha, Estado, Total, Detalle) con las acciones **Cerrar caja** y **Reabrir**. | `apps/web/src/pages/ventas/cierre-caja.tsx`, `apps/web/src/components/ventas/CerrarCajaDialog.tsx`, `apps/web/src/lib/cierreCaja.ts` | F-VTA-33 |

- Menú **Ventas** (`apps/web/src/components/navegacion/destinosPanel.ts`): la épica agrega la entrada
  **«Cierre de caja»** (`/ventas/cierre-caja`, icono `LockClockIcon`, `seccionPermiso: 'ventas'`).
- Guarda de ruta (`apps/web/src/App.tsx`): `RequiereAccesoSeccion seccion="ventas"` — la **lectura** de
  los cierres alcanza para cualquier rol con Ventas.
- **Las acciones solo se renderizan para el Administrador** (`useEsAdministrador`), pero la **base lo
  exige igual**: `cerrar_caja` y `reabrir_caja` validan `private.es_administrador_de(organizacion_id)`.
- Diálogo de confirmación (`CerrarCajaDialog`): «Cerrar caja» o «Reabrir caja», con el texto que
  explica qué va a pasar; si la RPC falla, el error se muestra **dentro** del diálogo y no se cierra.

## Modelo de datos

| Objeto | Esquema | Estado | Cambio |
|---|---|---|---|
| `dominio.cierres_caja` | `dominio` | **nueva** | El cierre del día de una tienda: `organizacion_id`, `empresa_id`, `fecha`, `estado` (`cerrada`/`reabierta`), `cerrado_por`, `cerrado_en`, `reabierto_por`, `reabierto_en`. Índice único `cierres_caja_org_empresa_fecha_uidx (organizacion_id, empresa_id, fecha)`: un cierre por día y empresa. RLS de **solo lectura**; sin escritura directa. |
| `dominio.cierres_caja_detalle` | `dominio` | **nueva** | El resumen del cierre: `cierre_id`, `forma_pago_id`, `cuenta_cobro_id` (nulable: efectivo y las formas sin cuenta), `total`. FK compuestas contra el cierre, la forma de pago y la cuenta. RLS de **solo lectura**; sin escritura directa. |
| `dominio.cobros_comprobante` | `dominio` | existente | Sin cambio de columnas ni de políticas (MSF-195): recibe el **disparador** `cobros_comprobante_caja_cerrada`. |
| `dominio.empresas`, `dominio.formas_pago`, `dominio.cuentas_cobro` | `dominio` | existentes | Sin cambio: se referencian con FK compuestas contra `organizacion_id`. |
| `public.organizaciones` | `public` | existente | Sin cambio: de `zona_horaria` sale el «día de caja». |
| `public.registro_actividad` | `public` | existente | Sin cambio: de ahí salen los eventos `caja.cerrada` y `caja.reabierta`. |

El DER completo está en [Datos y DER](datos.md#ventas-mejoras-msf-193).

### RLS y privilegios

- Las dos tablas: `enable row level security` y **una sola política `select`**, que exige
  `organizacion_id = private.organizacion_id()`,
  `empresa_id in (select private.empresas_accesibles())` y
  `private.nivel_seccion('ventas') in ('lectura', 'edicion')`. El detalle exige además que el cierre
  pertenezca a una empresa accesible.
- `revoke all … from public, anon, authenticated` + `grant select … to authenticated`: **nadie escribe
  directo**; escriben solo las RPC `security definer`.
- `cerrado_por` y `reabierto_por` **no** tienen FK a `auth.users`: el historial sobrevive a la baja de la
  cuenta (mismo criterio que `dominio.cobros_comprobante.registrado_por`).

## RPC

Migración `20270202201101_cierres_caja_rpc.sql`. Todas en `public` (la superficie que llama la app) con
`set search_path = ''`, `revoke execute … from public, anon` y `grant execute … to authenticated`; los
helpers viven en `private` y **no** son ejecutables por `authenticated`.

### `public.cerrar_caja(p_empresa_id uuid, p_fecha date) returns dominio.cierres_caja`

- **Administrador**: `private.es_administrador_de(v_org)`; si no, `42501` («Solo un administrador puede
  cerrar la caja»).
- **Tienda**: debe existir en la organización y ser accesible; si no, `42501`.
- **No se cierra un día futuro**: `p_fecha > private.hoy_caja(v_org)` ⇒ `22023` («No se puede cerrar la
  caja de un día futuro»).
- **Candado transaccional**: `private.candado_caja(empresa, fecha)` (`pg_advisory_xact_lock`), el mismo
  que toma el disparador de cobros: un cobro no se cuela entre el resumen y el cierre.
- **Idempotente**: si ya hay un cierre `cerrada` de ese día, **devuelve el existente** sin rehacer nada.
  Si estaba `reabierta`, lo vuelve a `cerrada` (nuevo `cerrado_por`/`cerrado_en`), **borra el detalle
  viejo** y lo rehace: no queda el resumen de una apertura anterior.
- **Resumen**: `insert into dominio.cierres_caja_detalle … select … from dominio.cobros_comprobante cc
  where cc.organizacion_id = v_org and cc.empresa_id = p_empresa_id and
  private.dia_caja(v_org, cc.registrado_en) = p_fecha group by cc.forma_pago_id,
  cc.cuenta_cobro_id`. Un cobro con `cuenta_cobro_id` nula (efectivo) se agrupa bajo su forma de pago
  **sin cuenta**.
- **Actividad**: `caja.cerrada` («Cerró la caja del DD/MM/YYYY») en la **misma transacción**.

### `public.reabrir_caja(p_cierre_id uuid) returns dominio.cierres_caja`

- **Administrador**; si no, `42501`.
- El cierre debe existir en la organización y ser de una empresa accesible; si no, `P0002`
  («El cierre no existe»).
- **Orden de candados**: `candado_caja` **antes** del `for update` de la fila (el mismo orden que
  `cerrar_caja`): evita el deadlock `40P01`.
- `cerrada` → `reabierta`, con `reabierto_por`/`reabierto_en`. **Idempotente**: si ya está `reabierta`,
  la devuelve tal cual.
- **Actividad**: `caja.reabierta` («Reabrió la caja del DD/MM/YYYY») en la misma transacción.

### `public.listar_cierres_caja(p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10)`

- `security invoker`: la RLS recorta por organización, empresa accesible y sección `ventas`.
- Devuelve por fila: `id`, `empresa_id`, `empresa`, `fecha`, `estado`, `total` (suma del detalle),
  `cerrado_por`, `cerrado_en`, `detalle` (jsonb con `forma_pago_id`, `forma_pago`, `cuenta_cobro_id`,
  `cuenta_cobro`, `total`, ordenado por forma y cuenta) y `filas` (total de la lista, para la paginación).
- `p_empresa_id = null` devuelve **todas** las empresas accesibles; `p_tamano` se acota a 1..100.

### Helpers de `private` (no ejecutables por `authenticated`)

| Función | Qué hace |
|---|---|
| `private.dia_caja(organizacion_id, momento) returns date` | El «día» de un instante **en la zona horaria de la organización** (`organizaciones.zona_horaria`, F-ORG-03), no en la de la sesión de la base (UTC en self-hosted). |
| `private.hoy_caja(organizacion_id) returns date` | «Hoy» en la zona de la organización. |
| `private.candado_caja(empresa_id, fecha) returns void` | `pg_advisory_xact_lock` por (empresa, fecha). |
| `private.caja_cerrada(empresa_id, fecha) returns boolean` | `true` si hay un cierre en estado `cerrada` de ese día. |

## El bloqueo de los cobros (FR-022)

Migración `20270202201102_bloqueo_cobros_cerrados.sql`: disparador
`cobros_comprobante_caja_cerrada` (`before insert or update on dominio.cobros_comprobante`) que ejecuta
`private.bloquear_cobro_caja_cerrada()`.

- Bloquea **toda escritura** sobre el libro de cobros, venga de la RPC que venga: `registrar_cobro`
  (MSF-195), la conciliación de pagos (F-VTA-13) y los contrarreembolsos (F-VTA-14) quedan bloqueados
  para ese día.
- Error: `55000` con el mensaje «La caja de ese día está cerrada; reabrila para registrar o modificar
  cobros».
- En un `UPDATE` comprueba **el día viejo y el nuevo**: mover un cobro a otro día cerrado también se
  rechaza.
- Toma el **mismo candado** que `cerrar_caja`: un cobro no se cuela entre el resumen y el cierre.

## Reglas de negocio

| Regla | Comportamiento |
|---|---|
| Alcance | El cierre es **por empresa** y **por día**: el efectivo se controla por tienda. |
| Estado «Abierta» | No hay fila: es la **ausencia** de cierre. La tabla solo guarda filas cuando alguien cerró. |
| Estados | `cerrada` → `reabierta` → `cerrada`. Reabrir y volver a cerrar **reutiliza la misma fila**. |
| Un cierre por día | Índice único (organización, empresa, fecha): no hay dos cierres del mismo día. |
| Idempotencia | `cerrar_caja` y `reabrir_caja` son idempotentes. |
| Día futuro | No se puede cerrar un día que todavía no llegó. |
| Zona horaria | El «día» de un cobro y el «hoy» se calculan en la zona de la **organización**, no en la de la base. |
| Conciliación | Sigue siendo **manual**: el cierre **no** importa extractos bancarios. |

### Empresa activa (FR-024, Principio VIII)

- El filtro de tienda de la pantalla (`FiltroEmpresa`) muestra **todas** las empresas accesibles por
  defecto; si se elige una empresa en la barra superior, la lista se filtra por esa tienda.
- Al cambiar la empresa activa se **recarga** la lista, se vuelve a la **página 1** y se **descarta el
  diálogo abierto**: nunca se confirma un cierre de la tienda anterior bajo la nueva.
- **«Cerrar caja»** es del día de la **empresa activa**: sin una tienda concreta no hay qué cerrar, y el
  botón queda deshabilitado con el aviso «Elegí una empresa en la barra superior para cerrar la caja de
  hoy.».

## Actividad

| Evento | Detalle | Empresa |
|---|---|---|
| `caja.cerrada` | «Cerró la caja del DD/MM/YYYY» | la del cierre |
| `caja.reabierta` | «Reabrió la caja del DD/MM/YYYY» | la del cierre |

Los dos se registran con `private.registrar_actividad` **en la misma transacción** que el cierre.

## Pruebas

- **pgTAP** `supabase/tests/database/ventas_cierre_caja.test.sql` (`pnpm test:db`): las dos tablas en
  `dominio` con RLS y sin escritura directa; el resumen por forma de pago y cuenta; el cierre idempotente;
  el cobro de una fecha cerrada rechazado (inserción directa, modificación y `registrar_cobro` de
  MSF-195); reabrir habilita y volver a cerrar rehace el resumen; solo el Administrador cierra y reabre;
  los eventos de actividad; el aislamiento por organización y empresa; `anon` sin acceso; y
  `rls_en_toda_tabla` verde.
- **Vitest** (`pnpm test:web`): `apps/web/src/lib/cierreCaja.test.ts` y
  `apps/web/src/pages/ventas/cierre-caja.test.tsx`.
- **E2E** (`pnpm test:e2e`): `apps/web/e2e/ventas-cierre-caja.e2e.ts`, rótulo
  **`[MSF-349:T021] [F-VTA-33#1]`**. Siembra con la API admin desde Node (la service-role key nunca
  llega al navegador) y **se omite** si no hay `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` locales: no
  corre en el CI público.

## Cómo probarlo

### Prerrequisitos

- Stack local: `pnpm dev:supabase` (Postgres + Auth) y `pnpm dev` (panel en `http://localhost:5173`).
- Sesión con rol **Administrador** en una organización con al menos una empresa.
- Un día con **cobros** de esa empresa: al menos una factura confirmada con un cobro registrado (por
  ejemplo con la pantalla de Cobros de MSF-195) y **dos formas de pago distintas** (por ejemplo
  «Efectivo» y «Transferencia bancaria» con su cuenta de cobro) para ver el resumen partido.

### Pasos (a mano, en el panel)

1. Entrá como **Administrador**, elegí una **tienda concreta** en la barra superior y andá a
   **Ventas → Cierre de caja**. **Se tiene que ver** la tabla vacía con «Sin cierres de caja».
2. Hacé clic en **Cerrar caja** y confirmá en el diálogo. **Se tiene que ver** el aviso «Caja cerrada ·
   <tienda> · <fecha>» y una fila con **Estado: Cerrada**, el **Total** y el **Detalle** con una línea
   por forma de pago y cuenta.
3. Con la caja cerrada, intentá registrar un cobro de ese día desde
   **Ventas → Comprobantes → una factura → Registrar cobro**. **Se tiene que ver** un error que dice
   que la caja de ese día está cerrada.
4. Volvé a **Cierre de caja** y hacé clic en **Reabrir** de esa fila; confirmá. **Se tiene que ver** el
   aviso «Caja reabierta · <tienda> · <fecha>» y la fila con **Estado: Reabierta**.
5. Registrá de nuevo el cobro del punto 3. **Se tiene que ver** que el cobro se registra.
6. Volvé a **Cerrar caja**: la misma fila pasa a **Cerrada** y el **Detalle** se rehace con el cobro
   nuevo.
7. Entrá con un rol que **no** sea Administrador. **Se tiene que ver** que la pantalla lista los cierres
   pero **no** muestra el botón **Cerrar caja** ni la acción **Reabrir**.
8. Cambiá de tienda en la barra superior. **Se tiene que ver** que la lista se recarga y vuelve a la
   primera página.

### Pasos (a nivel de base, pgTAP)

```bash
pnpm dev:supabase          # base local
pnpm test:db               # corre supabase/tests/database/ventas_cierre_caja.test.sql
```

Con la base a mano (Supabase Studio, sesión de un usuario **autenticado** de la organización de ejemplo):

```sql
-- 1. Cerrar el día de una empresa (Administrador). Devuelve el cierre.
select * from public.cerrar_caja('<empresa-id>'::uuid, current_date);

-- 2. Idempotente: el segundo cierre devuelve el mismo cierre, no falla.
select id, estado from public.cerrar_caja('<empresa-id>'::uuid, current_date);

-- 3. El resumen, por forma de pago y cuenta.
select f.nombre as forma_pago, cu.nombre as cuenta, d.total
  from dominio.cierres_caja_detalle d
  join dominio.formas_pago f on f.id = d.forma_pago_id
  left join dominio.cuentas_cobro cu on cu.id = d.cuenta_cobro_id
 where d.cierre_id = '<cierre-id>'::uuid;

-- 4. Registrar un cobro con la caja cerrada: 55000 «La caja de ese día está cerrada…».
-- (el mismo error aparece con registrar_cobro de MSF-195 y con la conciliación)

-- 5. Reabrir y volver a cerrar.
select estado from public.reabrir_caja('<cierre-id>'::uuid);
```

### Resultado esperado

- **Given** un día con cobros, **when** el administrador cierra la caja, **then** se resumen los cobros
  por forma de pago y cuenta y no se pueden modificar sin reabrirla — CA-VTA-33-1.
- **Given** la caja cerrada, **when** se intenta registrar o modificar un cobro de ese día, **then** se
  rechaza (sin reabrir).
- **Given** la caja cerrada, **when** el administrador la reabre, **then** se habilita de nuevo el
  registro de cobros del día.

### Cómo automatizarlo

- **Ya existe**: `apps/web/e2e/ventas-cierre-caja.e2e.ts` con el rótulo
  **`[MSF-349:T021] [F-VTA-33#1]`** (un día con cobros → «Cerrar caja» → resumen por forma de pago →
  el cobro del día se rechaza → «Reabrir» → el cobro se registra). Corre solo contra el stack local.
- **Pendiente de automatizar**: la cobertura del **día futuro** (`22023`), del **día en la zona de la
  organización** y del **cierre idempotente** está en pgTAP, no en E2E. Cuando se quiera un E2E de esos
  casos, el rótulo a asignar es **`[MSF-349:T021]`** (mismo archivo).

## Reversión

Migraciones **aditivas**; el encabezado de cada una trae la reversión:

```sql
-- 20270202201102_bloqueo_cobros_cerrados.sql
drop trigger cobros_comprobante_caja_cerrada on dominio.cobros_comprobante;
drop function private.bloquear_cobro_caja_cerrada();

-- 20270202201101_cierres_caja_rpc.sql
drop function public.listar_cierres_caja(uuid, integer, integer);
drop function public.reabrir_caja(uuid);
drop function public.cerrar_caja(uuid, date);
drop function private.caja_cerrada(uuid, date);
drop function private.candado_caja(uuid, date);
drop function private.dia_caja(uuid, timestamptz);
drop function private.hoy_caja(uuid);

-- 20270202201100_cierres_caja.sql
drop table dominio.cierres_caja_detalle;
drop table dominio.cierres_caja;
```

**Exportar antes de revertir** los cierres si ya hay datos: son un registro del resumen del día y no se
recalculan. Revertir la épica entera se hace con `git revert -m 1` de su merge.

## Fuera de alcance

- **Importación de extractos bancarios** y **conciliación automática**: la conciliación sigue siendo
  manual (MSF-195, F-VTA-13); el cierre solo resume lo que ya está registrado.
- **Arqueo físico del efectivo**: el cierre resume por forma de pago y cuenta; no cuenta el dinero en
  el cajón ni compara contra un conteo declarado.
- **Cierre por cajero, por turno o por usuario**: el cierre es **por empresa y por día**, no por
  persona.
- **Vencimiento por plazo de rendición** y **comisión de transporte**: son de MSF-195 (F-VTA-14).
- **Cierre de días futuros**: la base los rechaza con `22023`.
- **Histórico de cierres reabiertos**: la fila se reutiliza; no queda el resumen del día mientras estuvo
  reabierta.

## Pendientes

- **TODO (Documentación · Owner: agente Documentador)**: faltan las **capturas** de la pantalla
  `/ventas/cierre-caja` en `docs/producto/img/ventas-cierre-caja/`. El repositorio no trae hoy un
  comando `pnpm docs:capturas` ni una carpeta `apps/web/e2e/capturas/` (las capturas existentes se
  versionaron a mano), y esta máquina no tiene acceso al daemon de Docker, así que no se pudo levantar
  el stack local para tomarlas. **No se inventaron imágenes.** Para generarlas: levantar
  `pnpm dev:supabase` + `pnpm dev`, registrar un cobro del día y capturar (1) la pantalla vacía,
  (2) la tabla con un cierre y su detalle, (3) el diálogo de **Cerrar caja**, (4) el aviso de caja
  cerrada y (5) el estado **Reabierta**.
