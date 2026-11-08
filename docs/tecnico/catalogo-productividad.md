---
owner: tecnico
sources:
  - specs
  - supabase/migrations
---

# Catálogo: productividad (edición masiva y duplicar)

**Épica:** MSF-218 · **Historias:** F-CAT-12 edición masiva (MSF-392) y F-CAT-13 duplicar producto (MSF-398).
**Spec:** `specs/20261103-100000-catalogo-productividad/` (`spec.md`, `plan.md`, `tasks.md`,
`contracts/edicion-masiva.md`). Delivery scope: `refine` (`apps/web`) y `supabase` (una migración con tres RPC y pgTAP);
sin Kestra, Superset ni workers. Guía de usuario: [Cambios masivos y duplicar](../producto/catalogo-productividad.md).
Referencia del módulo: [Catálogo de productos](../catalogo.md) (secciones «Duplicar producto» y «Productividad»).

## Piezas

| Pieza | Dónde | Qué resuelve |
|---|---|---|
| RPC de edición masiva | `supabase/migrations/20270215100000_catalogo_edicion_masiva.sql` | `public.mover_productos_categoria`, `public.cambiar_estado_productos`, `public.definir_empresas_productos` y la función auxiliar `private.bloquear_productos_masivo` |
| Cliente de las RPC | `apps/web/src/lib/edicionMasiva.ts`, `hooks/useEjecutarEdicionMasiva.ts` | Llamadas, avisos («N productos movidos a …», «No hubo cambios») y traducción de errores |
| Selección y barra | `hooks/useSeleccionProductos.ts`, `components/productos/BarraSeleccion.tsx` | Casillas, «N seleccionados» y tope de 100 |
| Diálogos | `components/productos/MoverCategoriaDialog.tsx`, `CambiarEstadoDialog.tsx`, `CambiarEmpresasDialog.tsx` | Carga diferida; empresas con `SelectorEmpresas` |
| Duplicar | `apps/web/src/lib/duplicarProducto.ts`, `pages/productos/create.tsx`, acción de fila en `pages/productos/list.tsx` | Precarga del alta desde `?duplicar_de=<id>` |

## Datos

- **Sin tablas ni columnas nuevas** (Principio VII): se opera sobre `dominio.productos` (`activo`, `categoria_id`) y
  `dominio.producto_empresa`. No cambia el DER de [Datos](datos.md). Las RPC viven en `public` (son funciones) y los
  datos siguen en `dominio` con su RLS.
- **Migración aditiva**; reversión documentada en su encabezado: `drop function` de las tres RPC y de
  `private.bloquear_productos_masivo`. «Duplicar» no tiene migración (reversión: quitar la acción y el parámetro).

## Contrato (`specs/20261103-100000-catalogo-productividad/contracts/edicion-masiva.md`)

```ts
mover_productos_categoria(p_producto_ids: uuid[], p_categoria_id: uuid): integer
cambiar_estado_productos(p_producto_ids: uuid[], p_activo: boolean): integer
definir_empresas_productos(p_producto_ids: uuid[], p_agregar: uuid[], p_quitar: uuid[]): integer
```

- `security invoker`, `search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`.
- Exigen `edicion` en la sección `productos` (`42501` si no). De 1 a 100 ids **distintos**: primero se quitan los
  repetidos y después se cuenta, así que 150 ids con repetidos que sean 80 distintos pasan; `22023` si la lista está
  vacía, trae valores nulos o supera 100 ids distintos.
- Productos o categoría inexistentes o de otra organización: `P0002`. Empresa inexistente o ajena: `22023` (igual que la
  RPC individual), y se valida antes de bloquear los productos, así que gana sobre un producto inexistente.
  Atómicas (todo o nada) e idempotentes.
- Devuelven cuántos productos **cambiaron de verdad**; con 0 la pantalla avisa «No hubo cambios».
- Delegan por producto en las RPC individuales (`asignar_categoria_producto`, `cambiar_estado_producto`,
  `definir_empresas_producto`), así que se reutilizan los eventos de Actividad `producto.categoria_asignada`,
  `producto.activado|desactivado` y `producto.empresas_actualizadas` (uno por producto con cambio real). No hay evento nuevo.
- `definir_empresas_productos`: resultado por producto `(actuales ∪ p_agregar) − p_quitar`; una empresa en ambas listas, o
  ambas listas vacías, es `22023`.
- Concurrencia: filas bloqueadas en orden de id para evitar interbloqueos entre dos ediciones masivas
  (`docs/catalogo.md`, «Revisión de seguridad de MSF-218»).

## Pantalla

- Casillas y barra solo con `edicion` en `productos` (`private.nivel_seccion('productos')`, nunca `puede_escribir()`).
- La selección es de las filas ya cargadas; con la carga infinita del listado se limitó a **100**. La spec original
  habla de 25 filas por página y el comportamiento vigente es el de 100 filas cargadas.
- **Empresa activa (Principio VIII):** al cambiar empresa, filtro, búsqueda u orden se descarta la selección y un diálogo
  abierto se cierra con aviso; pedir más filas no la descarta. Las consultas del listado se invalidan y se reencuadra la
  paginación.
- **Duplicar:** `lib/duplicarProducto.ts` lee el origen (la RLS oculta los de otra organización) y precarga nombre,
  descripción, «Compatible con», moneda, precio de lista, categoría y empresas; costo y proveedor solo con acceso a
  Rentabilidad. SKU y código de barras quedan vacíos; sin imágenes ni stock; nace activo. El guardado es `crear_producto`
  con sus validaciones y `duplicar_de` nunca llega al servidor. Origen inexistente o ajeno: aviso y alta vacía.
- **Diferencias con el prototipo** (`design/pantallas/Productos.dc.html`): no se construyen «Marcar destacado», «Enviar al
  newsletter» ni «Borrar» (el producto se desactiva); se omite «hasta 3.er nivel» (el árbol es de 2 niveles); «Cambiar
  estado» y «Cambiar empresas» no estaban dibujados y usan el mismo patrón de botón y diálogo.

## Guía de prueba

### Prerrequisitos

- Entorno local (`pnpm dev:supabase` + `pnpm dev:refine:host`) o DEV, con `pnpm demo:dataset` para tener productos,
  categorías y al menos dos empresas.
- Un usuario Operador (o Administrador) y otro con solo `lectura` en Productos.

### Pasos

1. Como Operador, en `/productos` marcá 3 productos: aparece la barra «3 seleccionados» con sus cuatro acciones.
2. «Mover de categoría» → elegí una categoría: aviso «3 productos movidos a …» y la columna Categoría cambia.
3. «Cambiar estado» → Desactivar: aviso «3 productos desactivados»; el filtro «Inactivos» los muestra.
4. «Cambiar empresas» → «Agregar a» una empresa: aviso «3 productos actualizados» y «Visible en» la incluye.
5. Repetí el paso 4 sin cambios reales: aviso «No hubo cambios».
6. Con 3 productos marcados, cambiá la empresa activa: la selección se descarta y un diálogo abierto se cierra con aviso.
7. Pulsá «Duplicar» en una fila: se abre `/productos/create?duplicar_de=<id>` con los datos copiados, SKU y código de
   barras vacíos y sin imágenes. Guardá: existe un producto nuevo activo y Actividad muestra `producto.creado`.
8. Duplicá escribiendo un SKU existente: el alta informa el error sin perder lo cargado.
9. Como usuario de `lectura`: no hay casillas, barra ni «Duplicar».
10. A nivel de base: `pnpm test:db` ejecuta `supabase/tests/database/catalogo_edicion_masiva.test.sql` (aislamiento entre
    organizaciones, lectura rechazada, `anon` sin ejecución, atomicidad, tope de 100, idempotencia, un evento por producto)
    y `rls_en_toda_tabla`.

### Resultado esperado

- **Given** una persona con edición en Productos y varios productos marcados, **When** confirma una acción masiva,
  **Then** todos cambian a la vez (o ninguno si algo falla), con un evento de Actividad por producto cambiado.
- **Given** un producto existente, **When** se lo duplica y se guarda, **Then** nace un producto activo nuevo sin SKU ni
  código de barras copiados.

### Cómo automatizarlo

| Cobertura | Dónde | Rótulo |
|---|---|---|
| E2E mover, desactivar y asignar empresa a 3 productos | `apps/web/e2e/catalogo-productividad.e2e.ts` | `[MSF-392:T010]` |
| E2E duplicar y guardar | `apps/web/e2e/catalogo-productividad.e2e.ts` | `[MSF-398:T014] [F-CAT-13#1]` |
| Vitest de pantalla (casillas, barra, diálogos, cambio de empresa, 320/768/1440) | `apps/web/src/pages/productos/list.test.tsx` | T010 de la spec |
| Vitest de duplicado | `apps/web/src/pages/productos/create.test.tsx` | T014 de la spec |
| pgTAP de las tres RPC | `supabase/tests/database/catalogo_edicion_masiva.test.sql` | T002 de la spec |

Pendiente de automatizar: el paso 8 (SKU repetido en el duplicado) está en Vitest, no en E2E.

## Pendientes

- Capturas del manual de producto: faltan las de la barra de selección, los tres diálogos y «Duplicar». El código de la
  épica ya está en `dokploy`. El repositorio no tiene todavía un script de capturas (`pnpm docs:capturas` no existe), así
  que se sacan a mano en `docs/producto/img/catalogo-productividad/` y se agregan en un cambio aparte.

## Fuera de alcance

Quedó fuera por decisión, no por olvido:

- **«Seleccionar todos los resultados»** (RF-CAT-12-1): la casilla del encabezado marca solo las filas ya cargadas, con
  un tope de **100**. Seleccionar el resultado completo del filtro no se construyó.
- **Evento único `producto.edicion_masiva`** (RF-CAT-12-3): no existe. Cada producto con cambio real deja su propio
  evento de Actividad (el mismo de la edición individual). Un evento único exigiría silenciar los disparadores de
  actividad que ya existen, y no se pudo probar sin pgTAP local.
- Destacado, newsletter, borrado, exportar/importar CSV, edición masiva de SKU, código de barras, precio o costo,
  selección más allá del tope, deshacer y duplicar desde la ficha.
