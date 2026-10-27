# Ventas · Faltantes: registro de lo que no se pudo despachar (F-VTA-18)

Historia F-VTA-18 de la épica MSF-135 (MSF-201). Spec:
`specs/20261024-130000-ventas-despacho-y-faltantes/` (FR-040…FR-047, SC-008, SC-009). Prototipo:
`design/pantallas/VentasFaltantes.dc.html` (pantalla de solo lectura) y `design/pantallas/VentasComprobante.dc.html`
(tarjeta **Responsables**, chip del estado de despacho).

## Modelo

El faltante es el **registro de una línea de una factura que no se pudo despachar por falta de stock**. No es un
movimiento de stock: corregir el stock es de Stock · toma de inventario.

- **Esquema `dominio`** (Principio VII): `dominio.faltantes_venta` es un dato de negocio del producto, nunca de
  `public`. Nace nueva en la migración `20261214130100_faltantes_tabla.sql`.
- Una fila por **línea de factura**, no por producto ni por cantidad agregada: `organizacion_id`, `empresa_id`,
  `comprobante_id`, `linea_orden`, `producto_id`, `deposito_id`, `cantidad_faltante` (siempre `> 0`), `estado`
  (`abierto` | `resuelto`), `registrado_por`, `creado_en` y `resuelto_en`.
- **FK compuestas** a comprobante, producto, depósito y empresa (misma organización); el comprobante va con
  `on delete cascade` (si se anula la factura, sus faltantes se van con ella).
- **Un faltante abierto por línea**: índice único parcial `(comprobante_id, linea_orden) where estado = 'abierto'`.
  Los faltantes ya resueltos quedan como historial y no bloquean el índice.
- `estado` y `resuelto_en` no se mezclan: `check ((estado = 'abierto') = (resuelto_en is null))`.

### Acceso (RLS)

- RLS activada. El navegador **solo lee**: `revoke all on dominio.faltantes_venta from public, anon, authenticated`
  y `grant select … to authenticated`. **Sin `insert`, `update` ni `delete`** y sin políticas de escritura: la
  escritura es de la RPC `security definer` y del disparador de cierre.
- La política de select exige las tres cosas: organización de la sesión, empresa accesible y **Ventas al menos en
  `lectura` en la empresa DEL FALTANTE** (`private.puede_leer_faltantes_empresa`, que mira el rol en esa tienda y
  no en la empresa activa). `anon` no tiene ningún privilegio.
- `rls_en_toda_tabla.test.sql` recorre `public` y `dominio`: la tabla nueva entra sola en ese recorrido.

## Registrar los faltantes (FR-041)

`public.registrar_faltantes_despacho(p_id, p_faltantes, p_actualizado_en)` registra una o más líneas faltantes de una
factura y la deja en Incompleto, **todo o nada** (si una línea está mal, no queda ningún faltante registrado y la
factura sigue como estaba).

- Solo **facturas confirmadas** con `estado_despacho` en `armando` o `incompleto`. Con `armando` la llamada la deja
  en `incompleto`; con `incompleto` sigue así y solo ajusta el faltante abierto de esa línea (el chip dice
  «Ajustar faltantes»).
- Cada cantidad va **entre 1 y lo pedido** en esa línea, y la línea tiene que ser de esa factura. La misma línea dos
  veces en la misma llamada se rechaza.
- **Un faltante por línea**: si la línea ya tiene un faltante abierto, se **actualiza** con la cantidad nueva (no se
  duplica).
- **Permiso**: la acción `despachar` de Ventas en la **empresa del comprobante** (no en la empresa activa), la misma
  regla de `cambiar_estado_despacho`.
- **Bloqueo optimista** por `p_actualizado_en` (`40001`) y fila `for update`: dos registros simultáneos no se pisan.
- Registra la actividad `despacho.faltante_registrado` con las líneas y las cantidades.

Errores: `42501` sin sesión/organización o sin permiso · `22023` dato inválido (cantidad, línea repetida, lista
vacía) · `P0002` comprobante inexistente · `55000` la factura no está en Armando ni en Incompleto · `40001` conflicto
de `p_actualizado_en`.

## Cierre del faltante (FR-042 · *Decisiones abiertas* 3)

El faltante se cierra **al reanudar el armado**: el disparador `comprobantes_venta_resolver_faltantes` (en
`20261214130200_faltantes_registrar.sql`) pasa a `resuelto` los faltantes **abiertos** de esa factura cuando
`estado_despacho` va de `incompleto` a `armando`, y deja `resuelto_en` con el momento del cierre. Va en un disparador
y no dentro de `cambiar_estado_despacho` para que valga desde cualquier camino.

**Decisión (la 3 de *Decisiones abiertas* de la spec):** la épica solo pide **registrar** el faltante. Se resuelve
al **reanudar el armado**. El cierre automático por ingreso de mercadería que dice el prototipo («se cierra solo
cuando se ingresa la mercadería») queda **FUERA DE ALCANCE**: se acopla al módulo Stock y a la reserva «A pedido», y
por eso ese texto **no** se muestra en la pantalla. El aviso al cliente por faltantes es de otra historia (MSF-161).

## Listado (FR-043)

`public.listar_faltantes(p_empresa_id, p_pagina, p_tamano)` devuelve los faltantes **abiertos** de las empresas donde
la persona tiene **Ventas al menos en lectura** (el mismo predicado que la RLS de la tabla, así que el listado no
puede mostrar más que la tabla), con cliente, producto y SKU, cantidad faltante, línea, comprobante, fecha del pedido,
«desde» (`creado_en`) y el **stock de hoy** (estado y disponible) con la lectura de Stock que ya existe
(`public.stock_estados`, leída por organización). Paginación en el servidor (tope de 200 por página) y total del filtro
en `filas`. Una tienda ajena devuelve **cero filas**, no un error: el error delataría que esa tienda existe.

## Pantalla «Ventas · Faltantes» (FR-044, FR-045, FR-046)

- Ruta `/ventas/faltantes`, entrada **«Faltantes»** en el grupo Ventas del menú (icono de cantidad en producción),
  protegida por la sección `ventas`.
- Título «Faltantes», descripción «Líneas vendidas o pedidas sin stock.» y **filtro de tienda** (`FiltroEmpresa`:
  «Todas las tiendas» + una por empresa) con su texto de ayuda: «Por defecto se ven todas; si elegís una empresa en
  la barra superior, se filtra por esa tienda.»
- Columnas: **Tienda, Cliente, Producto (con SKU), Pedido, Comprobante, Desde, Stock hoy**; en pantallas angostas la
  misma información va en tarjetas. Paginación («1–10 de N»), «Sin resultados», estado de carga y error con
  «Reintentar».
- «Pedido» son **las unidades que faltan** de esa línea; «Stock hoy» muestra la etiqueta del estado del producto
  (`Sin stock`/`Stock bajo`/`Disponible`) y las unidades disponibles.
- Es de **solo lectura**: los faltantes los registra el despacho, no esta pantalla.
- **Empresa activa (Principio VIII):** el filtro hereda la empresa activa de la barra superior; al cambiarla se
  recarga la consulta, la paginación vuelve a la primera página y **no se muestra ni una fila ni un total de la
  empresa anterior** (cada lectura queda atada a su ámbito: organización + tienda).

## Diálogo «Registrar faltantes» (FR-047)

En el comprobante, el chip **«Incompleto»** del estado de despacho (tarjeta **Responsables**) abre el diálogo
«Registrar faltantes» —no está en el prototipo: lo pide FR-047 y la matriz pantalla↔criterios lo declara. El diálogo
pide, línea por línea, **cuántas unidades faltaron**; valida la cantidad contra lo pedido antes de mandarla y usa
`registrar_faltantes_despacho`. Si la factura ya está Incompleta, el chip dice «Ajustar faltantes» y la cantidad se
actualiza (no se duplica el faltante). **Si cambia la empresa activa con el diálogo abierto, se cierra con aviso**:
nunca se guarda un faltante de una tienda bajo otra.

## RPC (esquema `public`, `search_path = ''`, `revoke … from public, anon` + `grant execute … to authenticated`)

| Función | Qué hace |
|---------|----------|
| `registrar_faltantes_despacho(p_id uuid, p_faltantes jsonb, p_actualizado_en timestamptz)` | Registra los faltantes de una factura en Armando o Incompleto (cantidad entre 1 y lo pedido por línea, un faltante abierto por línea) y la deja en Incompleto, todo o nada. Exige la acción `despachar` en la empresa del comprobante. Devuelve el comprobante actualizado. |
| `listar_faltantes(p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10)` | Faltantes abiertos de las empresas accesibles, paginados, con cliente, producto, SKU, cantidad, comprobante, fecha del pedido, «desde» y el stock de hoy. |
| `private.puede_leer_faltantes_empresa(p_empresa_id uuid)` | Ayuda de las políticas de RLS: Ventas al menos en lectura en esa empresa. |
| `private.resolver_faltantes_al_reanudar()` | Disparador de cierre: resuelve los faltantes abiertos al volver a Armando. |

`listar_faltantes` devuelve, por fila: `id`, `empresa_id`, `empresa`, `cliente`, `producto`, `sku`,
`cantidad_faltante`, `linea_orden`, `comprobante_id`, `comprobante`, `fecha`, `desde`, `stock_estado`,
`stock_disponible` y `filas` (el total del filtro). El contrato de la spec
(`specs/20261024-130000-ventas-despacho-y-faltantes/contracts/ventas-despacho-y-faltantes.md`) dibuja esa fila con
otros nombres (`cantidad`, `numero`, `disponible`); los que van en el código son los que consume el frontend
(`apps/web/src/lib/ventasFaltantes.ts`) y los que pide FR-043 (cliente, producto con SKU, cantidad, comprobante,
fecha de registro y el stock de hoy).

## Pruebas

- pgTAP: `supabase/tests/database/faltantes.test.sql` (SC-008: columnas y `cantidad_faltante > 0`, un solo faltante
  abierto por línea, RLS activada y sin escritura directa, `anon` sin acceso, otra organización sin filas, cantidad
  inválida, línea repetida, factura fuera de Armando, todo o nada, upsert sin duplicar, paso a Incompleto, actividad
  `despacho.faltante_registrado`, resolución al reanudar el armado y el listado con filtro por tienda, total,
  paginación y stock de hoy; el aislamiento se prueba con **dos tiendas de la misma organización**: quien tiene
  Ventas en las dos ve los tres faltantes y quien solo tiene Ventas en una no ve los de la otra) (`pnpm test:db`).
- Vitest: `apps/web/src/pages/ventas/faltantes.test.tsx` (SC-009: título «Faltantes», filtro de tienda y su texto,
  columnas, estado de carga, paginación, «Sin resultados», error con reintento, solo lectura, **cambio de empresa**
  —recarga y reencuadre— y la ruta `/ventas/faltantes` guardada por la sección `ventas`),
  `apps/web/src/hooks/useListarFaltantes.test.tsx` (SC-009: la respuesta de una tienda no se dibuja bajo otra) y
  `apps/web/src/components/ventas/RegistrarFaltantesDialog.test.tsx` (SC-009: el diálogo se abre al elegir
  «Incompleto» en el comprobante, validaciones de la cantidad, registro por línea, error de la base, el rol en
  `lectura` no puede registrar faltantes y cierre con aviso al cambiar de empresa)
  (`pnpm --filter @platform/web test faltantes RegistrarFaltantesDialog`).

## Reversión

Migraciones **aditivas** (no se destruye nada que esta historia cree en el mismo PR). Para volver atrás, en una
migración posterior:

1. `drop trigger comprobantes_venta_resolver_faltantes on dominio.comprobantes_venta` y
   `drop function private.resolver_faltantes_al_reanudar()`.
2. `drop function public.registrar_faltantes_despacho(uuid, jsonb, timestamptz)` y
   `public.listar_faltantes(uuid, integer, integer)`.
3. `drop function private.puede_leer_faltantes_empresa(uuid)` y `drop table if exists dominio.faltantes_venta` (con
   sus índices `faltantes_venta_abierto_uq`, `faltantes_venta_empresa_idx` y `faltantes_venta_abiertos_fecha_idx`).

Los faltantes ya registrados **no se deshacen solos**: son dato nuevo de esta épica (exportarlos antes de borrar la
tabla). Y los que quedaron registrados dejan la factura en `incompleto`: hay que corregirla desde el despacho
(reanudar el armado o volver a armarla).
