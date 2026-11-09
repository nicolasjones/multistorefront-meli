# Implementation Plan: F-PRV-09 · Órdenes de compra a proveedores

**Spec**: `specs/20261109-103000-ordenes-de-compra-a-proveedores/spec.md` · **Épica**: MSF-450 · **Historia**: F-PRV-09 (MSF-454) · **Delivery scope**: `supabase` + `refine`.

## Resumen

Dos tablas en `dominio` (cabecera y líneas de la orden), cinco RPC en `public` y una pantalla en Stock
(`/stock/ordenes-compra`) con su diálogo de alta, el detalle y las dos transiciones de estado. La orden
nace del listado de reposición: los productos en alerta del proveedor elegido, con la cantidad sugerida
(`max(1, mínimo − disponible)`).

## Contexto técnico

- **Stock único por organización** (`dominio.existencias`): el pedido no se separa por depósito ni por
  empresa en el stock; la empresa es a nombre de quién se compra (igual que el ingreso de mercadería).
- **Un producto, un proveedor** (`dominio.productos.proveedor_id`, F-PRV-03): por eso una orden es de un
  solo proveedor y sus productos son los de ese proveedor.
- **Escritura por RPC**: las tablas no tienen política de escritura para `authenticated`; `crear_orden_compra`
  y `cambiar_estado_orden_compra` son `security definer` con `search_path = ''` y validan el permiso
  (`private.nivel_seccion('stock')`) y la organización de la sesión. `listar_ordenes_compra` y
  `detalle_orden_compra` son `security invoker`: decide la RLS.
- **`productos_en_reposicion_de_proveedor`** es `security definer` porque `dominio.productos` exige la
  sección `productos` y la orden es de `stock`: devuelve solo producto, nombre, SKU, disponible, mínimo y
  estado (nada de costos).
- **Permisos**: reusa la sección `stock` de la matriz de roles (no hay sección nueva). `lectura` ve;
  `edicion` crea, recibe y anula.
- **Frontend**: `apps/web` con los patrones de la casa (`ContenidoAdaptable`, `EstadoVacio`/`EstadoError`,
  `FiltroEmpresa`, `EtiquetaEstado`, `useNivelSeccion`). Sin servicio nuevo: se habla con Supabase por RPC.

## Migraciones (aditivas, con reversión en el encabezado)

| Versión | Archivo | Contenido |
|---|---|---|
| `20270114130001` | `supabase/migrations/20270114130001_ordenes_compra_tablas.sql` | `dominio.ordenes_compra`, `dominio.ordenes_compra_items`, RLS, grants, comentarios. |
| `20270114130100` | `supabase/migrations/20270114130100_ordenes_compra_rpc.sql` | `crear_orden_compra`, `listar_ordenes_compra`, `detalle_orden_compra`, `cambiar_estado_orden_compra`, `productos_en_reposicion_de_proveedor`. |

La versión la fija el runner (`20270114130001`, por encima de la máxima de la base del PR `20270114130000`).
No se editan versiones ya publicadas. Cada migración lleva en el encabezado el camino de reversión.

## Verificación de la constitución

| Principio | Resultado |
|---|---|
| I. Aislamiento | RLS por organización en las dos tablas; `anon` sin privilegios; ninguna escritura directa para `authenticated`. |
| II. Especificar antes de implementar | Cumple: esta spec fija FR y SC antes del código. |
| III. Idempotencia y auditoría | Las RPC son reintentables por estado (transiciones válidas); no hay duplicados porque cada orden es un pedido distinto. |
| VI. Panel operable | Pantalla con ruta canónica, pestaña, estados compartidos, teclado y lector. |
| VII. Esquemas | Las dos tablas nuevas son de negocio → `dominio`, justificadas en la spec. `rls_en_toda_tabla` sigue verde. |
| VIII. Empresa activa | FR-008: la empresa activa es la omisión del alta y el filtro del listado; el diálogo se reencuadra al cambiar. |
| Documentación | `docs/ordenes-compra.md` + `docs/cuentas-y-compras-a-proveedores.md` + índice de `docs/stock.md`, en el mismo cambio. |

## Pruebas

- **pgTAP** (`supabase/tests/database/ordenes_compra.test.sql`): aislamiento entre dos organizaciones, permisos
  por rol (`consulta` lee y no escribe; `operador`/`deposito` escriben), los tres estados y sus transiciones,
  rechazo de datos inválidos (fecha futura, proveedor inactivo, producto ajeno, cantidad cero), sin escritura
  directa ni `delete`, `anon` sin privilegios, y `rls_en_toda_tabla`.
- **Vitest**: validación del formulario (empresa, proveedor, fecha, cantidades), mapeo de errores de la base y
  visibilidad de acciones por rol.
- **E2E** (`apps/web/e2e/ordenes-compra.e2e.ts`): recorrido de alta y seguimiento con el rótulo `[MSF-454:…]`.

## Riesgos

- Que la orden y el ingreso de mercadería queden desalineados: se documenta el vínculo pendiente como historia
  aparte (cambiaría el contrato de `registrar_ingreso_mercaderia`).
- Que el listado de reposición cambie entre que la pantalla carga los productos y el alta: la RPC vuelve a
  validar y rechaza con mensaje claro.
