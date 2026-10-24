# Ventas · Estados del comprobante y de cobro (F-VTA-10)

Historia F-VTA-10 de la épica MSF-177 (MSF-365). Spec: `specs/20261024-130000-ventas-listado-estados-y-anulacion/`
(FR-020…FR-027, SC-004, SC-005). Prototipo: `design/pantallas/VentasComprobante.dc.html` (tarjetas **Estado** e
**Historial de estados y acciones**).

## Modelo

- **Esquema `dominio`** (Principio VII): `dominio.transiciones_estado_comprobante` es una regla de negocio de ventas.
  Columnas: organización, tipo (`factura`), estado desde/hasta, rol. RLS por organización con `ventas` ≥ `lectura`,
  **sin escritura directa** (ni `insert`/`update`/`delete` para `authenticated`) y `anon` sin privilegios.
- La **siembra** la hace `private.sembrar_transiciones_comprobante(org)`: para las organizaciones existentes en la
  migración `20261207100100` y, por trigger, para cada organización nueva. La edición de la matriz por pantalla es
  **Etapa 2** (fuera de esta historia).
- Una factura confirmada se guarda como `confirmada` y el panel la muestra **«Pendiente»** (catálogo único en
  `apps/web/src/lib/estadosComprobante.ts`). «Entregado» es de MSF-135 y no se entrega acá.

### Matriz inicial (propuesta a confirmar con el cliente)

| Rol | Transiciones |
|-----|--------------|
| Mostrador | Pendiente → Aceptado · Pendiente → En proceso · Aceptado → En proceso |
| Depósito | Aceptado → Armando · En proceso → Armando · Armando → Incompleto · Incompleto → Armando |
| Administración, Administrador | todas las anteriores |
| `sistema` (cobros, MSF-195) | → Cobrado (desde cualquier estado operativo) · Cobrado ↔ Deuda |

Corregirla es una migración de **datos**, no de estructura. Operador y Consulta no tienen transiciones: ven la
tarjeta con todos los chips deshabilitados.

## RPC (esquema `public`, `search_path = ''`, `revoke … from public, anon` + `grant execute … to authenticated`)

| Función | Qué hace |
|---------|----------|
| `cambiar_estado_comprobante(p_id, p_estado, p_actualizado_en)` | Cambia el estado de una **factura confirmada** si la transición existe para el **rol del actor en la empresa del comprobante**. `security definer`, fila `for update`, bloqueo optimista (`40001`), idempotente (mismo estado = devuelve el actual, sin evento). Rechaza `borrador`/`anulada` (`55000`), presupuestos y estados inválidos (`22023`) y `cobrado`/`deuda` (`42501`). Registra `comprobante.estado_cambiado` (*«Estado: Pendiente → Aceptado en la factura N»*). |
| `transiciones_permitidas_comprobante(p_id)` | Estados a los que el rol de la sesión puede pasar hoy (informativa, para habilitar chips). La autoridad es la función anterior. |
| `historial_comprobante(p_id)` | Cuándo, acción, quién y tienda de los eventos del comprobante, más recientes primero. |
| `private.marcar_estado_cobro_comprobante(p_id, p_estado)` | Pasa a `cobrado`/`deuda` con actor `sistema` (evento sin actor → «Sistema»). **Sin `grant`** a `authenticated`: es el punto de entrada que usará cobros (MSF-195). El disparo queda fuera de esta historia. |

**Desvíos respecto del contrato original** (documentados en `contracts/ventas-listado-estados-y-anulacion.md`):

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

Migraciones aditivas. Para volver atrás, en una migración posterior: `drop function` de las cuatro funciones de esta
historia (más `private.rol_actor_en_empresa` y `private.etiqueta_estado_comprobante`), `drop trigger
organizaciones_sembrar_transiciones_comprobante` y `drop table dominio.transiciones_estado_comprobante`. Los estados ya
guardados en `dominio.comprobantes_venta.estado` no se tocan.
