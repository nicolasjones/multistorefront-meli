---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ventas · precios especiales por cliente (técnico, MSF-193)

Implementación de la épica **MSF-193** (*Ventas y despacho · Ventas mejoras*, spec
`specs/20261027-100000-ventas-mejoras`), historia **F-VTA-32** (Jira **MSF-340**): un **descuento
porcentual por cliente** que Ventas aplica sobre el precio de escala de cada línea.

La vista de producto está en [Clientes (producto)](../producto/clientes.md#descuento-por-cliente) y en
[Presupuestos y facturas (producto)](../producto/ventas-comprobantes.md#descuento-por-cliente). Las
otras dos historias de la épica están en
[Venta de mostrador (técnico)](ventas-mostrador.md) (F-VTA-31 / MSF-329) y en
[Cierre de caja (técnico)](ventas-cierre-caja.md) (F-VTA-33 / MSF-349).

!!! note "Estado"
    Implementado en las ramas `epic/MSF-193-ventas-mejoras` (rama de la épica) y `dokploy`
    (rama de integración), **pendiente de merge a `main`**. La historia llegó por la rama
    `feat/story-MSF-340` (PR #493, merge `a8dcdf3f`). Migraciones:
    `20270201200102_clientes_descuento.sql` y `20270201200103_lineas_descuento.sql`. Alcance de
    entrega: `refine` y `supabase`. Sin `kestra`, `superset` ni `workers`.

!!! warning "Banda de versiones de las migraciones"
    Las dos migraciones usan una banda **nueva y mayor** a propósito (`20270201200102` y
    `20270201200103`): con los números que nombra `tasks.md` (`20261213200100` y `20261213200200`)
    quedaban por debajo de la cola ya aplicada en `dokploy` y `supabase db push` las rechaza; el guard
    `scripts/verificar-migraciones.mjs` lo marca como «versión REUSADA» y `pnpm docs:check` falla. La
    épica renumeró sus seis migraciones en el commit `9b546a58`.

## Pantallas y rutas

La historia **no crea una pantalla**: toca dos pantallas que ya existían.

| Pantalla | Cambio | Archivos | Historia |
|---|---|---|---|
| **Ficha del cliente** (`/clientes/show/:id` y `/clientes/edit/:id`) | Campo **Descuento (%)** en el formulario (solo Administrador) y fila **Descuento** en la ficha. | `apps/web/src/components/clientes/FormularioCliente.tsx`, `apps/web/src/pages/clientes/edit.tsx`, `apps/web/src/pages/clientes/show.tsx`, `apps/web/src/hooks/useEsAdministrador.ts` | F-VTA-32 |
| **Detalle del comprobante** (`/ventas/comprobantes/:id`) | La línea muestra el descuento aplicado junto a la escala. | `apps/web/src/lib/ventasLineas.ts` (`rotuloEscalaLinea`) | F-VTA-32 |

- El campo **Descuento (%)** **solo se renderiza para el Administrador**
  (`useEsAdministrador`: `contexto.es_superadmin || contexto.rol_efectivo === 'administrador'`). Para
  los demás roles la pantalla no lo muestra y el formulario **no lo envía**.
- En la ficha el valor se lee como `5 %`; sin descuento se lee `—`.

## Modelo de datos

| Objeto | Esquema | Estado | Cambio |
|---|---|---|---|
| `public.clientes` | `public` | **alterada** | Gana `descuento numeric(5,2)` (porcentaje 0..100, `null` = sin descuento) con `check (descuento is null or (descuento >= 0 and descuento <= 100))`. La tabla vive en `public` por la excepción documentada al Principio VII ([Clientes (MSF-180)](datos.md#clientes-msf-180)). |
| `dominio.comprobantes_venta_lineas` | `dominio` | **alterada** | Gana `descuento_pct numeric(5,2) not null default 0` con `check (descuento_pct >= 0 and descuento_pct <= 100)`: qué descuento se aplicó a esa línea. |
| `dominio.comprobantes_venta` | `dominio` | existente | Sin cambio: la línea se recalcula al guardar; el comprobante ya guardado **no cambia** aunque luego se edite el descuento del cliente. |
| `public.organizaciones` | `public` | existente | Sin cambio: de ahí sale la zona horaria con la que se calcula el «día» en otras historias de la épica. |
| `public.registro_actividad` | `public` | existente | Sin cambio: de ahí sale el evento `cliente.descuento_editado`. |
| `public.guardar_lineas_comprobante(uuid, jsonb, timestamptz)` | `public` (RPC) | **alterada** | Misma firma y mismo retorno (sin `BREAKING`): cambia el valor calculado del precio. |
| `public.obtener_comprobante(uuid)` | `public` (RPC) | **alterada** | Misma firma y mismo retorno: la línea suma la clave `descuento_pct`. |

El DER completo está en [Datos y DER](datos.md#ventas-mejoras-msf-193).

## Cálculo del precio (FR-011)

`public.guardar_lineas_comprobante` (migración `20270201200103_lineas_descuento.sql`) lee el descuento
**del servidor**, nunca del `payload`:

```sql
-- F-VTA-32: el descuento sale de la ficha del cliente en el servidor, nunca del payload.
select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
  from public.clientes cl
 where cl.id = v_c.cliente_id and cl.organizacion_id = v_org;
...
-- El descuento aplica solo sobre el neto de escala, antes del IVA; un precio manual no se toca.
v_unitario := coalesce(v_manual, round(v_precio.neto * (1 - v_descuento / 100), 2));
...
-- La línea guarda el descuento que se aplicó (0 si el precio es manual).
case when v_manual is null then v_descuento else 0 end
```

Reglas:

| Regla | Comportamiento |
|---|---|
| Base del descuento | El **neto de escala** que devuelve `private.precio_para` (tipo de cliente + cantidad), **antes** del IVA. |
| **Precio manual** | **No se toca**: si la línea trae `precio_manual`, el precio es ese y `descuento_pct` queda en `0`. Es una decisión explícita del operador (decisión abierta 2 de la spec). |
| Redondeo | `round(..., 2)`: dos decimales. El IVA se calcula **después**, sobre el precio ya descontado. |
| Historical | La línea guarda el `descuento_pct` que se aplicó: si después se cambia el descuento de la ficha, **lo ya vendido no cambia**. |
| Payload | El `payload` de `guardar_lineas_comprobante` **no puede imponer un descuento**: el valor sale de `public.clientes`. |

## Permisos y auditoría (FR-010)

- `grant update (descuento) on public.clientes to authenticated`: el permiso es **por columna**; el
  resto de las columnas de `clientes` siguen con su permiso anterior.
- **No se concede en `INSERT`**: un cliente **nace sin descuento**.
- Disparador `clientes_descuento_solo_admin` (`before update of descuento`): si el descuento cambia y
  la sesión no es del Administrador de la organización, responde `42501` con
  «Solo un administrador puede cambiar el descuento del cliente» (`hint = 'descuento'`). Las cargas sin
  sesión (importación, API de servicio) no pasan por el disparador: `auth.uid()` es `null`.
- Disparador `clientes_descuento_registrar_actividad` (`after update of descuento`): registra el evento
  **`cliente.descuento_editado`** («Cambió el descuento del cliente Nº … · …») en la **misma
  transacción**. El detalle **no** incluye el valor del descuento ni datos de contacto.

## Validación en la pantalla

- `parsearDescuento` (`apps/web/src/lib/clientes.ts`): vacío = `null` (sin descuento); un número de
  0 a 100 con hasta 2 decimales = el valor; cualquier otra cosa = inválido.
- Mensaje en el campo: «Ingresá un porcentaje entre 0 y 100, con hasta 2 decimales.».
- Ayuda del campo: «Se resta del precio de escala en cada venta. Vacío = sin descuento.».
- La base repite la validación con el `check` `clientes_descuento_ck` (0..100).

## Presentación en la línea

`rotuloEscalaLinea` (`apps/web/src/lib/ventasLineas.ts`) rotula el origen del precio:

| Caso | Rótulo |
|---|---|
| Escala, sin descuento | `escala x1` |
| Escala, con descuento | `escala x1 · 5 % de descuento` |
| Precio manual | `precio manual` |

## Pruebas

- **pgTAP** `supabase/tests/database/ventas_precios_especiales.test.sql` (`pnpm test:db`): cliente con
  5 % ⇒ precio = escala − 5 %; cliente sin descuento no cambia; el precio manual no se pisa; el
  descuento fuera de rango se rechaza; solo el Administrador lo cambia; el `payload` no puede imponer
  un descuento; aislamiento por organización y `anon` sin acceso.
- **Vitest** (`pnpm test:web`): `apps/web/src/components/clientes/FormularioCliente.test.tsx`,
  `apps/web/src/lib/clientes.test.ts` (parseo y validación del descuento) y
  `apps/web/src/lib/ventasLineas.test.ts` (rótulo de la línea).
- **E2E** (`pnpm test:e2e`): `apps/web/e2e/ventas-precios-especiales.e2e.ts`, rótulo
  **`[MSF-340:T013] [F-VTA-32#1]`**. Siembra con la API admin desde Node (la service-role key nunca
  llega al navegador) y **se omite** si no hay `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` locales: no
  corre en el CI público.

## Cómo probarlo

### Prerrequisitos

- Stack local: `pnpm dev:supabase` (Postgres + Auth) y `pnpm dev` (panel en `http://localhost:5173`).
- Sesión con rol **Administrador** (para fijar el descuento) y otra con un rol que **no** sea
  Administrador (para comprobar que el campo no aparece y que la base lo rechaza).
- Un producto con **precio de lista** y una escala cargada (por ejemplo lista `$1.000`, minorista =
  escala x1), el depósito principal de la tienda y un cliente **minorista** o **mayorista** cualquiera.

### Pasos (a mano, en el panel)

1. Entrá como **Administrador** y abrí **Contactos → Clientes → Editar** de un cliente.
2. En el campo **Descuento (%)** escribí `5` y guardá. **Se tiene que ver** «Cliente guardado».
3. Abrí la ficha de ese cliente. **Se tiene que ver** la fila **Descuento** con `5 %`.
4. Entrá con un rol que **no** sea Administrador y abrí la edición del mismo cliente. **Se tiene que ver**
   que el campo **Descuento (%)** no aparece.
5. Con el Administrador, abrí **Ventas → Comprobantes**, creá una factura para ese cliente y agregá el
   producto de lista `$1.000` (escala x1). **Se tiene que ver**, debajo del precio, el rótulo
   `escala x1 · 5 % de descuento` y el precio unitario **$950** (1.000 − 5 %).
6. Si tu rol puede editar precios, poné un **precio manual** en otra línea. **Se tiene que ver** el
   rótulo `precio manual` y que el precio **no** lleva descuento.
7. Cambiá el descuento del cliente a `10` y recargá la factura ya guardada. **Se tiene que ver** que la
   línea sigue mostrando `5 % de descuento` y `$950`: lo ya vendido no cambia.

### Pasos (a nivel de base, pgTAP)

```bash
pnpm dev:supabase          # base local
pnpm test:db               # corre supabase/tests/database/ventas_precios_especiales.test.sql
```

Con la base a mano (Supabase Studio, sesión de un usuario **autenticado** de la organización de ejemplo):

```sql
-- 1. Fijar el descuento (solo Administrador: si no, 42501).
update public.clientes set descuento = 5 where numero = 10;

-- 2. Descuento fuera de rango: viola el check (0..100).
update public.clientes set descuento = 120 where numero = 10;

-- 3. El payload NO puede imponer el descuento: la RPC lo lee del cliente.
select public.guardar_lineas_comprobante(
  '<comprobante-id>'::uuid,
  '[{"producto_id": "<producto-id>", "cantidad": 1, "descuento_pct": 99}]'::jsonb,
  (select updated_at from dominio.comprobantes_venta where id = '<comprobante-id>')
);

-- 4. El descuento aplicado quedó en la línea.
select descripcion, precio_unitario, descuento_pct
  from dominio.comprobantes_venta_lineas
 where comprobante_id = '<comprobante-id>';
```

### Resultado esperado

- **Given** un cliente con 5 % de descuento, **when** agrego una línea, **then** el precio refleja la
  escala menos 5 % — CA-VTA-32-1.
- **Given** la ficha del cliente, **then** hay un campo de descuento editable solo por Administrador.
- **Given** una línea de un cliente con descuento, **then** la línea del comprobante muestra el descuento
  aplicado y el precio resultante.

### Cómo automatizarlo

- **Ya existe**: `apps/web/e2e/ventas-precios-especiales.e2e.ts` con el rótulo
  **`[MSF-340:T013] [F-VTA-32#1]`** (cliente con 5 % ⇒ escala x1 de $1.000 menos 5 % = $950, con el
  rótulo `escala x1 · 5 % de descuento` visible). Corre solo contra el stack local.
- **Pendiente de automatizar**: la cobertura del **precio manual que no se pisa** y del **cambio de
  descuento posterior que no altera lo vendido** está en pgTAP y en Vitest, no en E2E. Cuando se quiera
  un E2E de esos casos, el rótulo a asignar es **`[MSF-340:T013]`** (mismo archivo).

## Reversión

Migraciones **aditivas**; el encabezado de cada una trae la reversión:

```sql
-- 20270201200102_clientes_descuento.sql
drop trigger clientes_descuento_registrar_actividad on public.clientes;
drop trigger clientes_descuento_solo_admin on public.clientes;
drop function private.registrar_actividad_cliente_descuento();
drop function private.exigir_admin_descuento_cliente();
revoke update (descuento) on public.clientes from authenticated;
alter table public.clientes drop column descuento;  -- recién cuando 20270201200103 ya no lo lea

-- 20270201200103_lineas_descuento.sql
-- restaurar public.guardar_lineas_comprobante y public.obtener_comprobante de
-- 20261203200300_lineas_rpc.sql y luego:
alter table dominio.comprobantes_venta_lineas drop column descuento_pct;
```

**Orden**: primero `20270201200103` (deja de leer `clientes.descuento`) y después `20270201200102`
(borra la columna). Exportar antes los comprobantes con descuento si se necesitan los precios ya
calculados: al revertir, `guardar_lineas_comprobante` vuelve al precio de escala.

## Fuera de alcance

- **Lista propia de precios**: la historia dice «descuento **o** lista propia», pero el requisito y el
  escenario solo especifican descuento porcentual. La lista propia queda **FUERA DE ALCANCE** hasta que
  se especifique (decisión abierta 1 de la spec).
- **Descuento sobre el precio manual**: no se aplica (decisión abierta 2 de la spec). El manual es una
  decisión explícita del operador.
- **Descuento por producto, por categoría o por fecha**: solo hay un descuento **por cliente**.
- **Descuento acumulado o por tramos**: el porcentaje es uno solo, de 0 a 100.
- **Recalcular lo ya vendido**: la línea guarda el descuento aplicado; cambiar la ficha no cambia las
  ventas anteriores.

## Pendientes

- **TODO (Documentación · Owner: agente Documentador)**: faltan las **capturas** de los dos cambios de
  pantalla en `docs/producto/img/clientes/` y `docs/producto/img/ventas-comprobantes/`: (1) el campo
  **Descuento (%)** del formulario de cliente y (2) el rótulo «escala x1 · 5 % de descuento» en la línea
  del comprobante. El repositorio no trae hoy un comando `pnpm docs:capturas` ni una carpeta
  `apps/web/e2e/capturas/` (las capturas existentes se versionaron a mano), y esta máquina no tiene
  acceso al daemon de Docker, así que no se pudo levantar el stack local para tomarlas. **No se
  inventaron imágenes.** Para generarlas: levantar `pnpm dev:supabase` + `pnpm dev`, poner un descuento
  a un cliente y capturar (1) el formulario de edición con el campo visible y (2) la línea de la
  factura con el descuento aplicado.
