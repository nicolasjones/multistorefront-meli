# Implementation Plan: Catálogo · Catálogo costo y disponibilidad

**Branch**: `epic/MSF-179-catalogo-catalogo-costo-y-disponibilidad` · **Spec**: [spec.md](spec.md) · **Jira Epic**: MSF-179
**Delivery scope**: `refine`, `supabase` · **Constitución**: v1.8.0 (Supabase self-hosted; Principio VII en cada etapa)

## Resumen

Tres historias sobre el catálogo que dejaron MSF-456 (alta/edición, costo), MSF-205 (proveedor) y MSF-529 (código de barras), y sobre el listado de MSF-160: **F-CAT-17** agrega la disponibilidad (derivada + dos estados manuales) con su contrato para MSF-292; **F-CAT-14** vuelve buscable el código de barras con lector en el listado; **F-CAT-16** completa costo/proveedor en el listado y muestra las escalas de precio en la ficha. Lo ya hecho (campos de costo, proveedor y código de barras en el formulario) solo se verifica.

## Contexto técnico

- **Frontend**: Refine + MUI en `apps/web` (`components/productos/FormularioProducto.tsx`, `pages/productos/{create,edit,list}.tsx`, `lib/productos.ts`); componentes del kit (`EstadosPagina`, `EtiquetaEstado`, `BarraHerramientas`, `ContenidoAdaptable`) y tokens de `docs/sistema-de-diseno.md`. Sin copiar HTML/CSS del prototipo.
- **Base**: migraciones en `supabase/migrations`; pgTAP en `supabase/tests`; Vitest en `apps/web`.
- **Prerrequisito**: MSF-160 provee `public.v_productos_listado` y el listado paginado en servidor (hoy `list.tsx` es una grilla mínima). Este plan **no** lo reconstruye: lo amplía agregando columnas al final.
- **Esquemas (re-verificado)**: `productos`/`producto_costos` → `dominio`; `v_productos_listado` → `public` (vista); `private.disponibilidad_producto` → `private`. Ninguna tabla nueva ni en `public`. RLS: la de `productos` cubre la columna nueva; `rls_en_toda_tabla` debe seguir verde.

## Diseño por historia

### F-CAT-17 · Disponibilidad (migración `20261022120900_catalogo_disponibilidad.sql`)

> Renombre al integrar con DEV: la versión original `20261022120000` colisionaba con
> `formas_pago_rpc` (MSF-139); se movió a `20261022120900`. No estaba desplegada.
1. `alter table dominio.productos add column disponibilidad_manual text check (disponibilidad_manual in ('a_pedido','stock_entrante'))`; `grant insert/update (disponibilidad_manual) … to authenticated`.
2. `private.disponibilidad_producto(uuid)` (`security definer`, `search_path ''`, filtra por `private.organizacion_id()`, exige `nivel_seccion('productos')` ≥ lectura): manual → etiqueta; si no, `existencias.cantidad` (− reservado = 0 hasta MSF-292) `> 0` → `stock`, si no `sin_stock`. Devuelve solo la etiqueta. `revoke … from public, anon`.
3. Nuevas versiones de `crear_producto` (+1 parámetro final) y `actualizar_producto` (+2: valor y `p_cambiar_disponibilidad`), patrón idéntico a `20261019120000_productos_codigo_barras.sql`: se descartan las firmas viejas y se recrean con `revoke … from public, anon` + `grant execute … to authenticated`; `updated_at` y el evento `producto.editado` cuentan el cambio. **Cambio de contrato → alto riesgo, señalado en el PR.**
4. `create or replace view public.v_productos_listado` con `disponibilidad` **al final** (`security_invoker = true`, sin costo).
5. Frontend: sección de disponibilidad en `FormularioProducto` (4 opciones, 2 calculadas y 2 elegibles, quitar elección); columna y filtro en `list.tsx`; `lib/productos.ts` (tipos y mapeo de etiquetas/tono con `EtiquetaEstado`).
6. Documentación del contrato para MSF-292 en `docs/stock.md` / `docs/catalogo.md`.
- **Reversión** (migración posterior; exportar antes los datos): restaurar las RPC y la vista previas; `drop function private.disponibilidad_producto(uuid); alter table dominio.productos drop column disponibilidad_manual;`.
- **Concurrencia**: el cambio de disponibilidad pasa por `actualizar_producto`, que ya usa bloqueo optimista por `updated_at` (40001).

### F-CAT-14 · Código de barras (migración `20261022121000_catalogo_listado_codigo_barras.sql`)

> Renombre al integrar con DEV: la versión original `20261022120100` colisionaba con
> `formas_envio` (MSF-139); se movió a `20261022121000`. No estaba desplegada.
1. `create or replace view public.v_productos_listado` sumando `codigo_barras` al final (conserva `disponibilidad` y todo lo anterior; esta historia corre **después** de F-CAT-17 según el plan de ejecución). Sin índice nuevo: el único parcial `productos_org_codigo_barras_uidx` ya sirve a la búsqueda exacta.
2. Frontend: en el buscador del listado, `^\d{13}$` → filtro `eq('codigo_barras', …)`; si no, búsqueda por nombre/SKU de MSF-160. Enter dispara de inmediato (sin espera de tipeo) y deja el foco. Placeholder «Buscar por nombre, SKU o código de barras».
3. Regresión del campo en alta/edición (ya entregado).
- **Reversión**: restaurar la vista previa (sin la columna).

### F-CAT-16 · Costo, proveedor y escalas (sin migración)
1. Listado: con `useNivelSeccion('rentabilidad')` en lectura/edición, segunda consulta `from('producto_costos').select('producto_id,costo').in('producto_id', idsDeLaPagina)`; RLS devuelve 0 filas a quien no corresponde y la columna ni se renderiza. La vista no expone costo.
2. Ficha: bloque «Precios por escala · sin IVA» (solo lectura) alimentado por un hook `useEscalasPrecio(productoId)` que consume el contrato de lectura de Precios (F-PRE-15, MSF-114) y devuelve `null` si no existe/no hay datos → «No disponible». **No se inventa el contrato:** el hook queda con un único punto de enlace documentado y, mientras MSF-114 no lo publique, la ficha muestra «No disponible».
3. Pruebas de regresión de costo/proveedor (Operador sin costo; proveedor y código).

## Pruebas (pruebas-plataforma)

- **pgTAP** (`supabase/tests/catalogo_disponibilidad.test.sql`): derivación (existencias simuladas por el seed de la prueba), manual manda, aislamiento entre organizaciones, Operador sin `producto_costos`, `anon` sin ejecución/lectura, vista sin costo; `rls_en_toda_tabla` verde.
- **Vitest**: formulario (disponibilidad, costo oculto), listado (columna Costo condicionada, etiqueta, filtro, búsqueda por 13 dígitos + Enter), ficha (escalas / «No disponible»).
- **E2E** (cierre): recorrido Administrador vs Operador; `playwright-best-practices` solo si se toca la suite.
- **Rendimiento**: SC-003/SC-004 con 10 000 productos sembrados.

## Riesgos

- Depende de que MSF-160 mergee `v_productos_listado`; si cambia el nombre/columnas, se ajusta el `create or replace` (revisar al arrancar cada historia).
- Cambio de contrato de `crear_producto`/`actualizar_producto`: llamadores previos intactos por parámetros opcionales; test de compatibilidad.
- `security definer` de la derivación: acotar por organización y devolver solo etiqueta (revisión de seguridad en el cierre).
- Orden de migraciones sobre la vista: F-CAT-17 → F-CAT-14 (cada una trae su propia migración; el orden está en el plan de ejecución).
- La regla de «A pedido» (reserva/descuento) es de MSF-292; aquí solo la etiqueta.

## Constitución — chequeo

I (RLS por organización) ✔ · II (spec primero, trazabilidad) ✔ · VI (pantallas con estados de carga/vacío/error, teclado, 320/768/1440 px) ✔ en tareas · VII (esquema por tabla) ✔ re-verificado · VIII (docs) ✔ cierre.
