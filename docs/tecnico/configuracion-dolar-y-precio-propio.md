---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Configuración del dólar y precio propio

**Épica:** MSF-352 · **Spec:** `specs/20270105-100000-configuracion-dolar-y-precio-propio/` (`spec.md`, `plan.md`, `tasks.md`, `contracts/`) · **Rama:** `epic/MSF-352-precios-y-dolar-configuracion-dolar-y-pr` (la épica está integrada en `dokploy` —PR #774 y las correcciones de su revisión, PR #799 y #801—; en `main` llega con la próxima promoción; las citas salen de `dokploy`) · **Alcance de entrega:** `refine` y `supabase`.

Historias: F-PRE-06 (MSF-419, commit `86c47cea`), F-PRE-08 (MSF-423, `3cfdf6ee`), F-PRE-09 (MSF-427, `4edda1c4`) y correcciones de la épica `6d8937d0` y `d77c632f`. Base: [Dólar y recálculo](dolar-y-recalculo.md) (MSF-116) y [Precios e IVA](precios-e-iva.md) (MSF-114).

## Qué cambia

- Los valores que MSF-116 dejaba fijos (umbral 1 %, confirmación 15 %, redondeo $ 10, aviso activo, alcance «sistema») pasan a ser editables por organización. Con los valores por defecto el comportamiento es idéntico al anterior.
- El precio propio reemplaza al calculado (central + ajuste) para un producto y una empresa; el IVA se aplica después.
- El simulador «Así quedan los precios» marca los productos con precio propio.

## Datos (Principio VII: todo en `dominio`)

| Objeto | Esquema | Migración |
|---|---|---|
| `cotizacion_configuracion` (PK `organizacion_id`; `alcance` sistema/empresa, `redondeo_pesos` ∈ {1,10,50,100}, `umbral_pct`, `confirmacion_pct`, `aviso_activo`) | `dominio` | `20270213100001_cotizacion_configuracion.sql` |
| `empresa_id` nullable (FK compuesta `(empresa_id, organizacion_id)`) en `cotizacion_pendiente`, `cotizaciones`, `cotizacion_aplicada`; `private.cotizacion_para`; sobrecarga de `a_pesos` con empresa | `dominio` / `private` | `20270213100002_cotizacion_alcance_empresa.sql` |
| `previsualizar_cambio_alcance`, `cambiar_alcance_cotizacion` | `public` (RPC) | `20270213100003_cotizacion_cambio_alcance.sql` |
| `previsualizar`/`confirmar`/`descartar_cotizacion` y `cotizacion_del_dia` leen la configuración y reciben `p_empresa` | `public` | `20270213100004_cotizacion_usa_configuracion.sql` |
| `precios_propios_empresa` (PK producto + empresa; `moneda` ARS/USD; `importe > 0`) | `dominio` | `20270213100005_precios_propios_empresa.sql` |
| El precio propio rige en `precio_neto_empresa` y `precios_empresa_neto` (columna `precio_propio`) | `private` / `public` | `20270213100006_precios_propios_calculo.sql` |
| `recalcular_alertas_inicio` respeta el aviso configurado | `public` (solo `service_role`) | `20270213100007_alertas_inicio_respeta_aviso.sql` |
| `previsualizar_precios_empresa` suma `precio_propio` | `public` | `20270213200001_simulador_precio_propio.sql` |
| Precio propio en tienda pública y líneas (`private.precio_para`) | `private` | `20270213200002_*` |
| Precio propio en el margen actual de Rentabilidad | `analitica` | `20270213200003_*` |

Todas las migraciones son aditivas y llevan la reversión en su encabezado. RLS por organización, sin escritura directa (solo por RPC), `anon` sin privilegios. Detalle de tablas en [Datos](datos.md).

## API

Contrato completo: `specs/20270105-100000-configuracion-dolar-y-precio-propio/contracts/configuracion-dolar-y-precio-propio.md`. Resumen:

- `obtener_configuracion_cotizacion()`: `cotizacion_dolar` ≥ lectura; sin fila devuelve los valores del lanzamiento.
- `guardar_configuracion_cotizacion(redondeo, umbral, confirmacion, aviso)`: edición; no cambia el alcance; `42501` sin permiso, `22023` valor fuera de rango; idempotente; evento `cotizacion.configuracion_guardada`.
- `previsualizar_cambio_alcance(alcance)` (solo lee) y `cambiar_alcance_cotizacion(alcance, confirmado)` (una transacción; `confirmado = false` da `22023`).
- `previsualizar_cotizacion`, `confirmar_cotizacion`, `descartar_cotizacion`, `cotizacion_del_dia` reciben `p_empresa uuid default null` (obligatorio solo con alcance `empresa`, si no `22023`): compatibles hacia atrás.
- `fijar_precio_propio(producto, empresa, moneda, importe)`, `quitar_precio_propio(producto, empresa)` y `leer_precios_propios(producto)`: sección `productos`; errores `42501`, `P0002` (ajeno), `22023`, `22003`/`23514`. Eventos `producto.precio_propio_fijado` y `producto.precio_propio_quitado`, sin importes.

## Reglas de cálculo

1. Un precio propio en USD se convierte con `private.cotizacion_para(organización, empresa)`: la de la empresa con alcance «empresa», la general con «sistema». Sin cotización el neto es `null` (no cae a la regla).
2. Un precio de escala por cantidad (x5/x10/x50) cargado a mano manda sobre el precio propio; en x1 manda el propio.
3. La tienda pública lee el precio propio sin depender de la sesión.
4. El «Redondeo del precio en pesos» de la configuración rige el «Nuevo» de la vista previa del dólar; el redondeo por empresa (F-PRE-07) no cambia (Decisión abierta 1 de la spec, pendiente de OK de Nicolás).

## Frontend

`apps/web/src/lib/cotizacion.ts`, `hooks/useConfiguracionCotizacion.ts`, `components/cotizacion/TarjetaConfiguracion.tsx` y `DialogoAlcance`, montados en `pages/cotizacion/index.tsx`; `pages/empresas/precios.tsx` (`Cotización que usa`, simulador); `lib/preciosPropios.ts`, `hooks/usePreciosPropios.ts` y `components/precios/PrecioPropioEmpresas.tsx` en `pages/productos/edit.tsx`; `components/precios/TablaAsiQuedan.tsx` y `ComoSeCalcula.tsx`. Empresa activa: con alcance «empresa» la pantalla de Cotización se acota a la empresa activa y pide elegir una en «Todas mis empresas»; el cambio de empresa recarga todas las consultas (Principio VIII).

## Guía de prueba

### Prerrequisitos

Dos organizaciones con dos empresas cada una, un Administrador (`cotizacion_dolar` edición), un Operador (`productos` edición), un usuario de Consulta y productos en pesos y en dólares (datos de `pnpm demo:dataset`). Local con `pnpm dev:supabase`.

### Pasos y resultado esperado

1. En `/cotizacion`, la tarjeta «Configuración» muestra Una para todo el sistema, $ 10, 1 % y aviso activo. Con umbral 2 % y un dólar +1,5 %, la vista previa dice «Sin recálculo».
2. Elegir «Una por empresa»: aparece la vista previa por empresa y recién al confirmar se aplica. Cargar el dólar de una empresa cambia solo sus precios en USD.
3. En un producto, fijar un precio propio de $ 27.000 en una empresa: su neto es $ 27.000 y la otra empresa no cambia; «Quitar» lo devuelve a la regla.
4. En «Precios y moneda» de la empresa, mover el **Ajuste**: la fila con precio propio queda fija con la marca y no se escribe nada hasta guardar.
5. Con Consulta, tarjeta y bloque de precio propio quedan en solo lectura. La segunda organización no ve nada de lo anterior.

### Cómo automatizarlo

Rótulos de tareas de `tasks.md`:

| Rótulo | Prueba |
|---|---|
| `[MSF-352:T007]`, `[MSF-352:T008]` | pgTAP `supabase/tests/database/cotizacion_configuracion.test.sql` y `cotizacion_alcance.test.sql` |
| `[MSF-352:T014]`, `[MSF-352:T015]` | Vitest `TarjetaConfiguracion.test.tsx`, `DialogoAlcance.test.tsx`, `pages/cotizacion/index.test.tsx` |
| `[MSF-352:T022]`, `[MSF-352:T023]` | pgTAP `precios_propios_empresa.test.sql` |
| `[MSF-352:T028]`, `[MSF-352:T029]` | Vitest `PrecioPropioEmpresas.test.tsx` y ficha |
| `[MSF-352:T031]` | pgTAP `simulador_precio_propio.test.sql` |
| `[MSF-352:T036]`, `[MSF-352:T037]` | Vitest `TablaAsiQuedan.test.tsx`, `pages/empresas/precios.test.tsx` |
| `[MSF-352:T040]` | E2E `apps/web/e2e/configuracion-dolar-precio-propio.e2e.ts` |

## Fuera de alcance y pendientes

- El E2E `T040` compila pero no se corrió localmente (nota de desvío en `tasks.md`); lo cubre el CI.
- El listado de productos no muestra la marca «Precio propio»; el alta de producto no fija precio propio.
- Mercado Libre: sin cola ni columna; llega con esa integración.
- TODO (dueño: Documentador, tras el merge de la épica): generar capturas del manual con `pnpm docs:capturas` para la tarjeta «Configuración», el bloque «Precio propio por empresa» y la tabla «Así quedan los precios» (esta rama no tiene aún el código de la épica). Las páginas de producto no llevan imágenes nuevas hasta entonces.
- TODO (dueño: Nicolás): confirmar que el redondeo de la configuración y el de F-PRE-07 son dos cosas distintas.

## Correcciones de la revisión independiente

Contrato vigente en `dokploy` (migraciones `20270216400000` y `20270218500100` a `20270218500700`; detalle en `docs/configuracion-dolar-y-precio-propio.md` de esa rama):

- `confirmar_comprobante` guarda costo y cotización de cada línea con `private.cotizacion_para(org, empresa)` y `private.a_pesos` de 4 argumentos de la empresa del comprobante (antes fallaba con alcance «empresa» por una subconsulta de varias filas).
- `confirmar_cotizacion(p_empresa, p_variacion_vista)`: umbral y variación contra la cotización **aplicada**; si |variación| supera `confirmacion_pct` exige `p_variacion_vista` (la variación que el usuario vio, tolerancia ±0,05 puntos): sin ella `22023` con hint `variacion_inusual`; si difiere de la real (el dólar cambió mientras revisaba) `22023` con hint `variacion_cambio`. `estado_cotizacion` suma `aplicada`.
- `dominio.precios_propios_historial`: historial append-only e inalterable de cada cambio de precio propio (lectura con la sección `productos`; la RLS de los precios propios usa `productos`, no `empresas`).
- `private.cotizacion_alcance(org)` lee el alcance sin depender de la sesión, de modo que la tienda cobra igual a un visitante anónimo y a un usuario de otra organización.
- Rentabilidad (`analitica.margen_producto_canal`, alerta `margen_negativo`) convierte con `analitica.cotizacion_para(org, empresa)`; la historia con `analitica.cotizacion_cercana(org, fecha, empresa)` y sin precio propio.
- Guardar la configuración o cambiar el alcance recalcula las alertas de Inicio; las vistas previas cuentan y simulan con el precio propio y la cotización destino.
- Limitaciones: `productos_precio_costo` y la valorización de inventario usan la cotización general; exportar/importar productos no llevan precios propios (decisión de producto pendiente).
- Exportación total de la organización: `dominio.precios_propios_historial` es un dato de negocio de la organización (la historia de los precios que cargó el cliente) y se EXPORTA (`20270218500700`, que agrega la tabla a `private.conjuntos_exportacion_total()`); incluye `actor_nombre`, igual que la actividad exportada.
- `confirmar_cotizacion(p_empresa, p_variacion_vista)`: la tolerancia entre la variación vista y la real es de 0,05 puntos; mandá el valor exacto de la vista previa. Hints de `22023`: `variacion_inusual` (falta la variación vista) y `variacion_cambio` (el dólar cambió mientras se revisaba).
