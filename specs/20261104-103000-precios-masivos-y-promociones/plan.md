# Implementation Plan: Precios y dólar · Precios masivos y promociones

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-363 · **Rama**: `epic/MSF-363-precios-y-dolar-precios-masivos-y-promoc` (nombre acortado por el worktree; equivale a `epic/MSF-363-precios-y-dolar-precios-masivos-y-promociones`)
**Alcance de entrega**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`: el vencimiento de promociones es una consulta por fecha (Decisión 1) y la masiva es una RPC transaccional.

## Resumen

Dos historias independientes sobre el contrato de MSF-114 (precio calculado al leer):
- **F-PRE-10**: vista previa + RPC atómica que reescribe `precio_lista` y `costo`; como no hay precios en pesos guardados, "recalcular `precios_empresa`" ocurre solo, en la misma transacción.
- **F-PRE-11**: `dominio.promociones_precio` y un cálculo único `private.precio_vigente_empresa` que sustituye el neto por el promocional si hay una promoción vigente **por fecha**; la tienda recibe `precio_anterior`.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI, kit `EncabezadoPagina`/`ContenidoAdaptable`/estados compartidos): `pages/productos/` (masivos y promociones), `lib/preciosMasivos.ts`, `lib/promociones.ts`, `pages/tienda-publica`. Planilla con `lib/migracionCsv.ts` (sin dependencia nueva).
- **Base**: Supabase self-hosted; tablas en `dominio`, RPC/vistas en `public`, cálculo en `private`, lectura anónima en `publico`. Todas las RPC `security invoker` (salvo lo estrictamente necesario, justificado), `set search_path = ''`.
- **Permisos**: `private.nivel_seccion('productos' | 'rentabilidad')`. Costo solo con `rentabilidad`.
- **Estado verificado** (repo, no el grafo, que no indexa SQL): existen `dominio.productos`, `dominio.producto_costos`, `dominio.precios_empresa`, `private.a_pesos`, `aplicar_regla_precio`, `precio_neto_empresa`, `precio_final_publico` (usada por catálogo, ficha, destacados, búsqueda, escala y precios de cliente), disparadores de `producto.precio_actualizado` y `publico.catalogo_pagina_por_dominio`. **No existen** `promociones_precio`, `actualizaciones_precio` ni precios propios (F-PRE-08).

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización en las 2 tablas nuevas; FK compuestas; pgTAP con dos organizaciones; `anon` sin privilegios. |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | Clave de operación en la masiva; eventos de actividad en ambas historias. |
| IV Despliegues independientes | Sin infraestructura nueva. |
| V Simplicidad | Sin workers ni Kestra. |
| VI Panel operable | «Actualizar precios» cuelga de Productos (botón, ruta `/productos/precios-masivos`); «Promociones» en `/productos/promociones` dentro de Productos, ícono de oferta, audiencia `productos`; estados compartidos, teclado/lector, 320/768/1440 px; sin ids técnicos; carga diferida de ambas pantallas (rutas fuera del recorrido principal). |
| VII Esquemas | `actualizaciones_precio` y `promociones_precio` → `dominio` (negocio del producto); RPC/vistas en `public`; cálculo en `private`. Se re-verifica en cada fase y en el PR. |
| VIII Empresa activa | Promociones respeta la barra superior (FR-016, con test de cambio de empresa); Actualizar precios: **no aplica** (datos de la organización). |
| VIII Documentación | `docs/precios-masivos.md`, `docs/promociones-precio.md`, `docs/precios.md`, `pnpm docs:check`. |

## Diseño

### F-PRE-10
1. **Vista previa y aplicar usan el mismo núcleo SQL** (una función `private` compartida) para que lo previsto sea lo aplicado. Aplicar **revalida**; no recibe los valores calculados por el cliente en modo porcentaje (recibe parámetros), y en modo planilla recibe las filas y las vuelve a validar.
2. **Atomicidad**: una sola sentencia/transacción de RPC; cualquier error ⇒ rollback. Tope técnico por llamada (supuesto: 5.000 filas) con mensaje claro; se confirma en T002.
3. **Conflicto**: la vista previa devuelve el `updated_at` de cada producto; aplicar compara y rechaza (`40001`) si cambió.
4. **Idempotencia**: `actualizaciones_precio.clave` única por organización; repetir devuelve el lote ya aplicado.
5. **Auditoría**: los disparadores existentes registran `producto.precio_actualizado` por producto; el lote suma `precios.actualizacion_masiva` sin importes de costo.
6. **Planilla**: el CSV se parsea en el navegador (`migracionCsv`) y viaja como JSON; no hay Storage ni worker.

### F-PRE-11
1. **Vencimiento por consulta** (Decisión 1): `desde <= ahora < hasta` con `ahora` inyectable (`p_ahora`) para probar los bordes en pgTAP; en producción `now()`.
2. **Sin solapes en la base**: disparador `before insert/update` que rechaza promociones no anuladas solapadas del mismo producto y empresa (no se habilita `btree_gist` para una restricción de exclusión: evita sumar una extensión sin otro uso; si el equipo la prefiere, es un cambio local a T011).
3. **Cálculo único**: `precio_vigente_empresa` = promo (si hay) → alícuota → interruptor; devuelve `precio` y `precio_anterior` (el que habría sin promoción). Reutiliza las funciones de MSF-114; no duplica fórmulas.
4. **Tienda**: catálogo, ficha, destacados y búsqueda en alcance (Decisión 7). Escala y precios de cliente por dominio siguen con `precio_final_publico*` (seguimiento MSF-816).
5. **Mercado Libre y ventas**: fuera (Decisión 6). El cálculo único queda disponible.

## Migraciones (todas aditivas, con reversión)

| Historia | Migración | Reversión |
|---|---|---|
| F-PRE-10 | `actualizaciones_precio` | `drop table dominio.actualizaciones_precio` (migración posterior, no en el mismo PR) |
| F-PRE-10 | `precios_masivos_previsualizar` / `_aplicar` | `drop function public.previsualizar_actualizacion_precios, public.aplicar_actualizacion_precios` |
| F-PRE-11 | `promociones_precio` | `drop table dominio.promociones_precio` (posterior) |
| F-PRE-11 | `promociones_precio_rpc` / `_vigente` | `drop` de RPC, vista y funciones `private` |
| F-PRE-11 | `tienda_precio_anterior` | restaurar la versión previa de `publico.catalogo_pagina_por_dominio` y la ficha (la clave extra `precio_anterior` es aditiva y se ignora) |

Cada historia tiene su propio timestamp y **no se encadenan** entre sí.

## Pruebas y calidad

pgTAP (`precios_masivos`, `promociones_precio`), Vitest (pantallas, planilla, tachado), E2E (vista previa; tienda con tachado). Las UI se revisan a 320/768/1440 px y con teclado. Contratos en [`contracts/precios-masivos-y-promociones.md`](./contracts/precios-masivos-y-promociones.md) (sin `BREAKING`; sin Edge Functions, no aplica OpenAPI).

## Ejecución

F-PRE-10 y F-PRE-11 en **paralelo** (grupo 1), cierre al final (grupo 2); ver tabla en `tasks.md`.

## Riesgos

- Cobrar distinto de lo mostrado si ventas/POS no adoptan la promoción (Decisión 6).
- Escalas de precio que quedan por encima de x1 tras una masiva (Decisión 5).
- Dependencia de despliegue: MSF-114 aún espera la aprobación DEV→STG; esto no bloquea la spec, sí el despliegue.
