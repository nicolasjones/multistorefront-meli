# Ventas · Estados del comprobante y de cobro (F-VTA-10)

Historia F-VTA-10 de la épica MSF-177 (MSF-365). Spec: `specs/20261024-130000-ventas-listado-estados-y-anulacion/`
(FR-020…FR-027, SC-004, SC-005). Prototipo: `design/pantallas/VentasComprobante.dc.html` (tarjetas **Estado** e
**Historial de estados y acciones**).

## Modelo

- **Esquema `dominio`** (Principio VII): `dominio.transiciones_estado_comprobante` es una regla de negocio de ventas.
  Columnas: organización, tipo (`factura`), estado desde/hasta, rol. RLS por organización con `ventas` ≥ `lectura`,
  **sin escritura directa** (ni `insert`/`update`/`delete` para `authenticated`) y `anon` sin privilegios.
- La **siembra** la hace `private.sembrar_transiciones_comprobante(org)`: para las organizaciones existentes en la
  migración `20261212100600` (renombrada desde `20261212100100` al mergear la base `dokploy`, que ya usaba esa
  versión para la impresión de presupuestos) y, por trigger, para cada organización nueva. La edición de la matriz
  por pantalla es **Etapa 2** (fuera de esta historia).
- Una factura confirmada se guarda como `confirmada` y el panel la muestra **«Pendiente»** (catálogo único en
  `apps/web/src/lib/estadosComprobante.ts`). «Entregado» es de MSF-135 y no se entrega acá.

### Matriz inicial (propuesta a confirmar con el cliente)

| Rol | Transiciones |
|-----|--------------|
| Mostrador | Pendiente → Aceptado · Pendiente → En proceso · Aceptado → En proceso |
| Depósito | Aceptado → Armando · En proceso → Armando · Armando → Incompleto · Incompleto → Armando |
| Administración, Administrador | todas las anteriores |
| `sistema` (cobros, MSF-195) | → Cobrado y → Deuda (desde cualquier estado operativo) · Cobrado ↔ Deuda |

Corregirla es una migración de **datos**, no de estructura. Operador y Consulta no tienen transiciones: ven la
tarjeta con todos los chips deshabilitados.

## RPC (esquema `public`, `search_path = ''`, `revoke … from public, anon` + `grant execute … to authenticated`)

| Función | Qué hace |
|---------|----------|
| `cambiar_estado_comprobante(p_id, p_estado, p_actualizado_en)` | Cambia el estado de una **factura confirmada** si la transición existe para el **rol del actor en la empresa del comprobante**. `security definer`, fila `for update`, bloqueo optimista (`40001`), idempotente (mismo estado = devuelve el actual, sin evento). Rechaza `borrador`/`anulada` (`55000`), presupuestos y estados inválidos (`22023`) y `cobrado`/`deuda` (`42501`). Registra `comprobante.estado_cambiado` (*«Estado: Pendiente → Aceptado en la factura N»*). |
| `transiciones_permitidas_comprobante(p_id)` | Estados a los que el rol de la sesión puede pasar hoy (informativa, para habilitar chips). La autoridad es la función anterior. |
| `historial_comprobante(p_id)` | Cuándo, acción, quién y tienda de los eventos del comprobante, más recientes primero. |
| `private.marcar_estado_cobro_comprobante(p_id, p_estado)` | Pasa a `cobrado`/`deuda` con actor `sistema` (evento sin actor → «Sistema»). **Sin `grant`** a `authenticated`: es el punto de entrada que usará cobros (MSF-195). El disparo queda fuera de esta historia. |

**Decisiones sobre el contrato original** (ya reflejadas en `contracts/ventas-listado-estados-y-anulacion.md`):

- `cambiar_estado_comprobante` exige poder **ver** `ventas` en la empresa del comprobante (`lectura` o `edicion`), no
  `edicion`: la matriz por rol es la autoridad. Depósito tiene `ventas` en lectura y debe poder armar.
- `historial_comprobante` es `security definer` (no `invoker`): `registro_actividad` solo se lee con la sección
  `actividad`, que un vendedor no tiene. La función valida organización, `ventas` ≥ `lectura` en la empresa del
  comprobante y filtra por empresa y por comprobante.
- `registro_actividad` no guarda el id de la entidad; el historial reconoce los eventos del comprobante por tipo
  (`comprobante.%`), empresa y el texto «factura|presupuesto *número*» del detalle (número completo, no prefijo).
  Si algún día se agrega una referencia de entidad a `registro_actividad`, la consulta pasa a usarla.

## Pantalla

`/ventas/comprobantes/:id` muestra el chip de estado junto al título, la tarjeta **Estado** (solo facturas: un chip por
estado, ayuda del estado actual y chips deshabilitados con motivo como `aria-label` y tooltip) y la tarjeta
**Historial de estados y acciones** (carga/vacío/error del kit). Al cambiar la empresa activa de la barra superior se
relee todo; si pasa a otra tienda distinta de la del comprobante, la pantalla se cierra con aviso (Principio VIII).

## Pruebas

- pgTAP: `supabase/tests/database/comprobante_estados.test.sql` (`pnpm test:db`).
- Vitest: `apps/web/src/pages/ventas/comprobante.estados.test.tsx` (`pnpm test:web`).

## Reversión

Migraciones aditivas. Para volver atrás, en una migración posterior: `drop function` de las cinco funciones de esta
historia (más `private.rol_actor_en_empresa` y `private.etiqueta_estado_comprobante`), `drop trigger
organizaciones_sembrar_transiciones_comprobante` y `drop table dominio.transiciones_estado_comprobante`. Los estados ya
guardados en `dominio.comprobantes_venta.estado` no se tocan.

## Anulación y nota de crédito (F-VTA-11)

Misma pantalla (`/ventas/comprobantes/:id`), ahora con **«Anular»** y **«Nota de crédito»** solo si la base los ofrece.
La autoridad son las RPC: la UI oculta las acciones con `puede_anular` / `puede_emitir_nota_credito` de
`public.detalle_anulacion_nota_credito(p_id)` (lectura `security definer` que también devuelve las notas asociadas, las
líneas acreditables y la anulación).

| Objeto | Qué hace |
|--------|----------|
| `public.anular_comprobante(p_id, p_motivo, p_actualizado_en)` | Solo factura confirmada, sin nota y no cobrada; motivo obligatorio (≤ 300). Pasa a `anulada`, guarda `anulado_en/por` y motivo, revierte stock todo o nada (`private.revertir_venta_comprobante`), libera reservas «A pedido», es idempotente y no reutiliza el número. Exige la acción `anular` en la tienda. |
| `public.emitir_nota_credito(p_factura_id, p_tipo, p_lineas, p_concepto)` | Emite `nota_credito` asociada (`comprobante_origen_id`) con número correlativo propio y tres motivos: `devolucion_productos` (líneas y cantidades), `devolucion_importe` y `descuento` (importe sin IVA + concepto). No excede lo acreditable por línea/importe, toma la factura `for update` y exige la acción `emitir_nota_credito`. |
| `private.devolver_stock_nota_credito(p_nota_id)` | Solo «Devolución de productos»: entrada al depósito de origen, motivo «Devolución de cliente». Los otros motivos no tocan stock. |
| `private.comprobante_cuenta_como_facturado` + `private.signo_comprobante` | **BREAKING interno**: las notas emitidas restan de lo facturado (ranking de clientes y compras); el ranking sigue contando solo facturas como comprobantes. |

Las notas se guardan con cantidades e importes **positivos**; la pantalla los muestra negativos. Al cambiar de empresa
activa el detalle se cierra con aviso (Principio VIII) y los diálogos se desmontan. «Anular» no está en el prototipo
(lo pide FR-042) y los datos mínimos para emitir se piden con componentes del kit (decisión 7 de la spec).

Pruebas: pgTAP `comprobante_anulacion.test.sql` y `comprobante_nota_credito.test.sql`; Vitest
`apps/web/src/pages/ventas/comprobante.anulacion.test.tsx`.

Reversión: `drop function` de `anular_comprobante`, `emitir_nota_credito`, `detalle_anulacion_nota_credito`,
`private.revertir_venta_comprobante`, `private.devolver_stock_nota_credito`, `private.signo_comprobante`, restaurar el
predicado previo de `comprobante_cuenta_como_facturado` / `ranking_clientes` / `compras_de_cliente`, y borrar las
columnas y la numeración de notas en una migración posterior (las anulaciones y notas emitidas no se deshacen solas).
