---
owner: tecnico
sources:
  - supabase/migrations
  - specs/20261017-120000-stock-movimientos
---

# Stock · movimientos, historial y estados (MSF-136)

Contratos, datos y operación de la épica MSF-136 (F-STK-02 · MSF-153, F-STK-03 · MSF-173, F-STK-05 · MSF-194 y
F-STK-06 · MSF-214). El detalle de producto (qué resuelve, para quién y límites) está en
[Stock: movimientos, historial, mínimo y sin negativos](../stock.md).

**Spec:** `specs/20261017-120000-stock-movimientos/`. **Alcance de entrega:** `refine` (`apps/web`) y `supabase`
(migraciones, RPC y pgTAP). Sin `kestra`, `superset` ni `workers`.

El stock es **único por organización** y compartido entre empresas: una fila de `dominio.existencias` por producto.
Depósitos, reservas y lotes son de otras épicas (MSF-292 y MSF-131); esta no los implementa. Con MSF-292 la RPC de
movimiento gana un parámetro final opcional (`p_deposito`) y la vista de estados se calcula sobre el disponible:
ver [Stock · depósitos y reservas](stock-depositos-y-reservas.md).

## Migraciones (aditivas)

| Migración | Contenido |
|-----------|-----------|
| `20261017140000_stock_existencias_y_movimientos.sql` | `dominio.existencias`, `dominio.movimientos_stock` y `dominio.motivos_movimiento`; siembra de motivos y existencias en 0; RLS |
| `20261017140100_stock_registrar_movimiento.sql` | RPC `public.registrar_movimiento_stock` |
| `20261017150000_stock_historial_inmutable.sql` | Inmutabilidad del libro y RPC `public.listar_movimientos_stock` |
| `20261017150100_stock_historial_borrado_en_cascada.sql` | Deja pasar solo el borrado en cascada de la organización |
| `20261017160000_stock_minimo_y_estados.sql` | Columna `existencias.minimo`, RPC `public.definir_minimo_stock` y vista `public.stock_estados` |
| `20261017170000_stock_sin_negativos.sql` | `check (cantidad >= 0)` y disparador «No hay stock suficiente» |
| `20261017180000_stock_historial_inmutable_sentencia.sql` | Disparador por sentencia: rechaza `update`/`delete` aunque la RLS oculte las filas |

La reversión está en el encabezado de cada archivo y consolidada en [Reversión](#reversión).

## Modelo de datos

Todas las tablas viven en `dominio` (Principio VII, dominio del producto). El DER completo del grafo afectado está en
[Datos y DER](datos.md#stock-movimientos-mínimo-y-estados-msf-136).

| Tabla | Para qué | Escritura |
|-------|----------|-----------|
| `dominio.existencias` | Cantidad vigente y mínimo por producto. Nace en 0 con el producto (`productos_crear_existencias`). | Solo RPC |
| `dominio.movimientos_stock` | Libro de solo agregado: tipo, cantidad informada, `diferencia` con signo, `saldo`, motivo, nota, fecha, actor. | Solo RPC; inmutable |
| `dominio.motivos_movimiento` | Motivos por organización (`aplica_a` restringido a los tres tipos; activo; nombre único sin distinguir mayúsculas). | Solo Administrador (`private.puede_escribir()`); se desactivan, no se borran |

- **Claves y aislamiento:** `existencias` tiene PK `producto_id` y FK compuesta `(producto_id, organizacion_id)`;
  `movimientos_stock` referencia existencias y motivos por clave compuesta. Ninguna fila puede apuntar a un producto
  o motivo de otra organización.
- **RLS:** `select` para `authenticated` con `organizacion_id = private.organizacion_id()` y
  `private.nivel_seccion('stock') in ('lectura', 'edicion')`. `existencias` y `movimientos_stock` no tienen policies
  de escritura; `motivos_movimiento` admite `insert`/`update` solo con `private.puede_escribir()` (Administrador).
  `anon` no recibe privilegios.
- **Índices del libro:** `(organizacion_id, creado_en desc, id)` y `(organizacion_id, producto_id, creado_en desc, id)`.
- **Sin FK a `auth.users`:** el movimiento guarda `actor_id` y `actor_nombre`; el historial sobrevive a la baja de la
  cuenta (igual que `registro_actividad`).

## RPC de escritura

### `public.registrar_movimiento_stock`

```sql
registrar_movimiento_stock(
  p_producto uuid,
  p_tipo text,                     -- entrada | salida | ajuste
  p_cantidad integer,              -- > 0 en entrada/salida; stock contado >= 0 en ajuste
  p_motivo uuid,
  p_nota text default null,        -- <= 500
  p_fecha date default current_date -- no futura
) returns dominio.movimientos_stock
```

!!! info "Firma vigente"
    Con MSF-292 esta RPC pasa de 6 a **7 parámetros**: `p_deposito uuid default null` al final (sin él se usa el
    depósito por defecto). El detalle está en [Stock · depósitos y reservas](stock-depositos-y-reservas.md).

- `security definer`, `search_path = ''`; exige sesión, organización activa y `nivel_seccion('stock') = 'edicion'`
  (`42501` en caso contrario). Organización y responsable salen de la sesión, nunca del llamador. `revoke … from
  public, anon` y `grant execute … to authenticated`.
- Valida tipo, cantidad, fecha (`22023`), nota y que el motivo esté activo, sea de la organización y aplique al tipo.
- Bloquea la fila de existencias con `for update`: dos movimientos simultáneos se serializan y ninguno se pierde.
- Calcula `diferencia` (`+cantidad`, `-cantidad` o `contado - actual`) y `saldo`, actualiza existencias, inserta el
  movimiento y registra el evento `stock.entrada` / `stock.salida` / `stock.ajuste` en la misma transacción.
- Un saldo negativo lo rechaza el disparador de F-STK-06 y revierte todo: no queda cantidad, movimiento ni evento.

### `public.definir_minimo_stock`

```sql
definir_minimo_stock(p_producto uuid, p_minimo integer) returns dominio.existencias
```

- `security definer`, `search_path = ''`; exige `edicion` en Stock y entero ≥ 0 (`22023`).
- Bloquea la fila y registra el evento `stock.minimo` **solo si el valor cambia**. `anon` sin ejecución.

## Lectura: historial y estados

### `public.listar_movimientos_stock`

```sql
listar_movimientos_stock(
  p_producto uuid default null,
  p_limite integer default 25,
  p_desplazamiento integer default 0
) returns table (id, fecha, creado_en, producto_id, producto_nombre, producto_sku, tipo, motivo, nota,
                 cantidad, diferencia, saldo, responsable, total)
```

- `security invoker`: rige la RLS por organización y `nivel_seccion('stock')` (`ninguno` no recibe filas).
- Orden `creado_en desc, id desc`; tope de 100 por página; `total` es el total del filtro. Filtro opcional por producto.
- Une con `dominio.productos` por `left join`: sin acceso a Catálogo el movimiento aparece como «Producto no
  disponible» en vez de desaparecer. `anon` sin acceso; `authenticated` con grant explícito.

### Vista `public.stock_estados`

`security_invoker` (hereda la RLS); `anon` sin acceso. Es el contrato que consumen Inicio (MSF-156) y MSF-231.

| Columna | Tipo | Significado |
|---------|------|-------------|
| `producto_id`, `organizacion_id` | uuid | Identidad |
| `nombre`, `sku` | text | Identidad visible del producto |
| `activo` | boolean | Producto activo en el catálogo |
| `cantidad` | integer | Stock vigente (≥ 0) |
| `minimo` | integer | Mínimo definido (≥ 0, por defecto 0) |
| `estado` | text | `sin_stock` / `stock_bajo` / `disponible` |
| `ultimo_movimiento_en` | timestamptz | Último movimiento (null si nunca tuvo) |

| Estado | Condición |
|--------|-----------|
| `sin_stock` | `cantidad = 0` (aunque el mínimo sea 0) |
| `stock_bajo` | `0 < cantidad <= minimo` |
| `disponible` | `cantidad > minimo` |

El estado se calcula en la vista; ningún consumidor debe recalcularlo.

## Inmutabilidad y negativos

- **Historial:** `BEFORE UPDATE OR DELETE` (fila), `BEFORE TRUNCATE` y `BEFORE UPDATE OR DELETE` (sentencia) rechazan
  con «Los movimientos de stock no se pueden modificar» (`42501`), también para el propietario de la función. Se
  revocan `update`, `delete` y `truncate`. Para corregir se registra un movimiento nuevo.
- **Baja de organización:** el `delete` de fila se permite solo cuando la organización padre ya no existe (cascada de
  `public.organizaciones`); un `delete` directo sigue rechazado. `authenticated` no tiene `delete` sobre
  `public.organizaciones` (solo `service_role`), así que la app no abre ese camino.
- **Sin negativos:** doble barrera en la base — `check (cantidad >= 0)` (`existencias_cantidad_no_negativa`) y el
  disparador `existencias_sin_negativos` (`BEFORE INSERT OR UPDATE OF cantidad`), que levanta «No hay stock
  suficiente» con el detalle «Hay N unidades y la salida es de M.» (`23514`). Protege la RPC, el SQL directo y futuras
  RPC; el rechazo no deja rastro.

## Actividad

`registrar_movimiento_stock` emite `stock.entrada`, `stock.salida` o `stock.ajuste`; `definir_minimo_stock` emite
`stock.minimo` solo al cambiar el valor. El registro se hace con `private.registrar_actividad` en la misma
transacción del movimiento (`public.registro_actividad`, plataforma).

## Interfaz

- Recurso `stock` y rutas con carga diferida en `apps/web/src/App.tsx`: `/stock`, `/stock/movimientos` y
  `/stock/motivos`.
- `apps/web/src/pages/stock/list.tsx` (Stock actual): lee `stock_estados`, muestra producto, SKU, cantidad, mínimo,
  estado y último movimiento; búsqueda por nombre o SKU, filtro por estado y resumen «N productos sin stock y M con
  stock bajo» con «Ver solo alertas». «Nuevo movimiento» y «Editar mínimo» solo con `edicion`.
- `apps/web/src/pages/stock/NuevoMovimientoDialog.tsx`: tipo, producto, cantidad o stock contado, motivo, fecha y nota;
  vista previa del stock resultante y responsable; deshabilita el doble envío; confirma «Movimiento registrado». La
  salida que supera el stock muestra «No hay stock suficiente» con el detalle y deshabilita «Registrar»; si el
  servidor rechaza por carrera (`23514`), muestra el mismo mensaje, relee el stock y deja reintentar.
- `apps/web/src/pages/stock/EditarMinimoDialog.tsx` y `apps/web/src/pages/stock/movimientos.tsx` (historial paginado
  en servidor, filtro por producto, solo lectura).
- `apps/web/src/pages/stock/motivos.tsx` (Administrador): alta, renombre, tipos a los que aplica y activar/desactivar.
  Operador y Consulta no ven el acceso. La misma tabla se edita desde Administración → Listas configurables
  (MSF-189), sin copia.
- Ninguna pantalla filtra por empresa: el stock es único por organización (Principio VIII, no aplica).

## Pruebas

- pgTAP: `supabase/tests/database/stock_movimientos.test.sql` (roles, aislamiento, escritura directa, motivos,
  actividad, `anon`), `stock_historial.test.sql` (inmutabilidad, paginación, filtro), `stock_minimo_estados.test.sql`
  (bordes de estado, permisos, evento, aislamiento) y `stock_sin_negativos.test.sql`.
- Vitest: `apps/web/src/lib/stock.test.ts` y `apps/web/src/pages/stock/*.test.tsx` (listado, diálogo, aviso de
  negativo, mínimo, motivos e historial).
- E2E de cierre (SC-001): `apps/web/e2e/stock-movimientos.e2e.ts` (producto → entrada 10 → salida 4 → ajuste a 3 →
  stock 3 y tres filas; salida de 5 rechazada). Requiere Supabase local; se omite sin credenciales.

## Reversión

En migraciones posteriores y exportando antes los datos:

```sql
drop view public.stock_estados;
drop function public.definir_minimo_stock(uuid, integer);
alter table dominio.existencias drop column minimo;

drop trigger movimientos_stock_inmutable_sentencia on dominio.movimientos_stock;
drop function private.rechazar_sentencia_movimiento_stock();
drop function public.listar_movimientos_stock(uuid, integer, integer);
drop trigger movimientos_stock_inmutable_fila on dominio.movimientos_stock;
drop trigger movimientos_stock_inmutable_truncate on dominio.movimientos_stock;
drop function private.rechazar_cambio_movimiento_stock();

drop trigger existencias_sin_negativos on dominio.existencias;
drop function private.rechazar_stock_negativo();
alter table dominio.existencias drop constraint existencias_cantidad_no_negativa;

drop function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date);
drop trigger organizaciones_sembrar_motivos_movimiento on public.organizaciones;
drop function private.sembrar_motivos_movimiento_trigger();
drop function private.sembrar_motivos_movimiento(uuid);
drop trigger productos_crear_existencias on dominio.productos;
drop function private.crear_existencias_producto();
drop table dominio.movimientos_stock, dominio.motivos_movimiento, dominio.existencias;
```

Las dos últimas sentencias destruyen el libro y las existencias: exportar antes.

## Fuera de alcance de esta épica

- Depósitos, reservas y stock por depósito (MSF-292, ya implementados en su rama: ver
  [Stock · depósitos y reservas](stock-depositos-y-reservas.md)) y lotes/toma de inventario (MSF-131).
- Stock único consolidado y alertas de Inicio (MSF-231 y MSF-156): esta épica publica la vista `stock_estados` como
  contrato, pero no construye esos consumidores.
- Edición o borrado de movimientos: por diseño no existe; toda corrección es un movimiento nuevo.
