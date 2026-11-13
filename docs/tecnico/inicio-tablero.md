---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Inicio: tablero de ventas y stock, listado por producto y carga del dólar (MSF-824)

Épica **MSF-824** — Inicio · Tablero completo (ventas, stock, listado y dólar). Spec, plan y tareas en
`specs/20270305-100000-inicio-tablero-completo/` (`spec.md`, `plan.md`, `tasks.md`). Rama
`epic/MSF-824-inicio-tablero-completo`, PR #899 a `dokploy`, merge commit `6477bba4`. Historias: F-INI-04
(MSF-820), F-INI-05 (MSF-821), F-INI-06 (MSF-822) y F-INI-07 (MSF-823).

> **Estado:** implementada y mergeada en `dokploy`; todavía **no está en `main`** (esta rama sale de `main`). El
> detalle largo de la épica (definiciones de los indicadores, matriz de permisos, contratos de las RPC,
> decisiones D-1..D-12 y desvíos) está en `docs/inicio-y-alertas.md` de `dokploy`, que llega a `main` con la
> promoción; esta página no lo duplica: resume lo que hay que saber para operar y probar. Producto:
> [Inicio: el tablero, las alertas y la búsqueda](../producto/inicio-y-alertas.md). Base:
> [Inicio y alertas](inicio-y-alertas.md) (MSF-156).

## Alcance de entrega

- **`refine`:** la pantalla de Inicio (`apps/web/src/pages/inicio/tablero/`), la tarjeta del dólar y el
  diálogo nuevo de carga con impacto.
- **`supabase`:** cinco migraciones **aditivas** (cinco RPC en `public` y un índice). **Ninguna tabla nueva**:
  `rls_en_toda_tabla` no cambia.
- **Sin** `superset`, `kestra` ni `workers`: todo son consultas en vivo desde Refine (decisión D-3 de la
  spec base, reafirmada acá).

| Tarea | Migración | Qué aporta |
|---|---|---|
| T001 | `20270305105000_resumen_inicio_periodo.sql` | `public.resumen_inicio_periodo` + índice `dominio.movimientos_stock_org_fecha_dia_idx` |
| T006 | `20270305110000_resumen_inicio_bloques.sql` | `public.resumen_inicio_bloques` (resumen por tienda y salidas por depósito) |
| T010 | `20270305120000_movimientos_por_producto.sql` | `public.movimientos_por_producto` |
| T014 | `20270305130000_previsualizar_impacto_dolar.sql` | `public.previsualizar_impacto_dolar` (solo lectura) |
| T014 | `20270305140000_aplicar_cotizacion.sql` | `public.aplicar_cotizacion` (carga + confirma en una transacción) |

Todas son `security definer`, `set search_path = ''`, `revoke execute … from public, anon` y
`grant execute … to authenticated`. La organización sale de la sesión (`private.organizacion_id()`), nunca de
un parámetro. Cada migración declara su reversión en el encabezado (`drop function` de la RPC; `drop index`
del índice nuevo).

## Decisiones

Numeradas **D-1 a D-12** de la spec del tablero (`specs/20270305-100000-inicio-tablero-completo/spec.md`).
No confundir con D-1..D-4 de la spec base ([Inicio y alertas](inicio-y-alertas.md)). Salvo D-6, la spec las
declara **a confirmar por Nicolás**; D-8 y D-12 se apartan de la spec porque manda la historia.

| # | Decisión | Dónde se ve |
|---|---|---|
| D-1 | «Qué hacer hoy» reusa los cinco tipos de `alertas_inicio`; no hay migración de alertas | Bloque «Qué hacer hoy» |
| D-2 | Ingresos **con IVA** (`total_con_iva`), rotulado; devoluciones = notas de crédito de las tres clases | Ventas del período |
| D-3 | «Entradas» de **Stock hoy** = movimientos `entrada` sin traslados, devoluciones de cliente ni anulaciones; «Ajustes» = solo `ajuste` | Stock hoy |
| D-4 | Costo, valor y margen solo con `rentabilidad` ≥ lectura | Resumen por tienda |
| D-5 | Margen estimado = margen **real** con el costo guardado en la línea al confirmar | Resumen por tienda |
| D-6 | Gráfico con **`@mui/x-charts`** (8.29.3 exacta, MIT) — aprobado por Nicolás el 2026-11-13 | Gráfico |
| D-7 | «Movimientos por producto» completo, con carga infinita y exportación CSV | Movimientos por producto |
| D-8 | Período, tienda y depósito viajan en la URL; sin `tienda` sigue a la empresa activa y su cambio la descarta; períodos hoy, 7 días, mes y rango | Filtros |
| D-9 | Vista previa pura `previsualizar_impacto_dolar`; sin Mercado Libre en el diálogo | Dólar |
| D-10 | «Actividad reciente» sin «Cant.»; muestra lo que el registro guarda hoy | Actividad reciente |
| D-11 | Con `ventas` solo en algunas tiendas, se suman únicamente las visibles | Ventas, resumen, listado |
| D-12 | En la **lista** de movimientos, entradas/salidas/ajustes cuentan todos los movimientos para que cuadre; con una tienda elegida el listado muestra solo sus productos (manda CA-INI-06-11 sobre D-8) | Movimientos por producto |

## Frontend (`apps/web/src/`)

| Pieza | Archivo |
|---|---|
| Montaje del tablero | `pages/inicio/index.tsx` (monta `TableroInicio` si el rol tiene `ventas`, `stock` o `actividad`) |
| Tablero | `pages/inicio/tablero/TableroInicio.tsx`, lecturas en `lib/inicioTablero.ts` |
| Filtros | `pages/inicio/tablero/FiltrosTablero.tsx` y `pages/inicio/tablero/filtros.ts` (estado en la URL) |
| Indicadores | `pages/inicio/tablero/Indicador.tsx` |
| Gráfico | `pages/inicio/tablero/GraficoVentasStock.tsx` (`@mui/x-charts`, cargado con `React.lazy`) |
| Bloques de gestión | `pages/inicio/tablero/BloquesGestion.tsx`, lecturas en `lib/inicioBloques.ts` |
| Listado por producto | `pages/inicio/tablero/MovimientosPorProducto.tsx`, `hooks/useMovimientosPorProducto.ts` |
| Dólar | `pages/inicio/TarjetaDolar.tsx` + `components/cotizacion/DialogoCargarDolarConImpacto.tsx`, `CampoDolar.tsx`, `AlertaVariacionInusual.tsx`, `LimiteDialogoDolar.tsx`, `hooks/usePrevisualizarImpactoDolar.ts` |
| Estado de carga por bloque | `pages/inicio/useLecturaInicio.ts` (clave de filtros: no se muestran datos de filtros anteriores) |
| Enlaces filtrados | `pages/stock/list.tsx` lee `filtro` y `deposito` de la URL; `pages/ventas-reportes/index.tsx` lee `desde` y `hasta` |

Puntos de diseño que importan para operar:

- **Los filtros viajan en la URL**: `?periodo=hoy|siete-dias|este-mes|rango` (más `desde` y `hasta` si es
  rango), `?deposito=<uuid>` y `?tienda=<uuid>|todas`. Se puede compartir el enlace de una vista.
- **El filtro de tienda no cambia la empresa activa** (usa `FiltroEmpresa`, que no la toca). Sin `tienda` en
  la URL, el tablero sigue a la empresa activa de la barra superior; con `tienda` manda la URL y **un cambio
  de la empresa activa descarta el parámetro** (Principio VIII: el cambio de arriba siempre gana). Una tienda
  que no es accesible se ignora; un depósito que no existe en la organización cae a «Todos los depósitos».
- **Un bloque sin permiso ni se muestra ni se consulta**: la base devuelve `null` y la pantalla distingue
  «sin permiso» de «cero».
- **«Resumen por tienda» y «Salidas por depósito» salen de la misma lectura** (`resumen_inicio_bloques`): si
  falla, fallan los dos con su propio reintento. «Actividad reciente» es independiente.
- **El gráfico y el diálogo del dólar se bajan con `lazy`**: ninguno de los dos entra en el chunk inicial de
  Inicio. El gráfico se baja al montar el tablero (con un esqueleto de carga) y el diálogo, solo al abrirlo;
  si ese chunk falla, `LimiteDialogoDolar` avisa en la tarjeta sin romper la pantalla.
- **Mercado Libre queda oculto** mientras no exista la funcionalidad (no hay feature registrada): no se
  muestran sus columnas, tarjetas ni filas.

## Datos: contratos de las cinco RPC

| Función | Devuelve | Errores |
|---|---|---|
| `public.resumen_inicio_periodo(p_desde date, p_hasta date, p_empresa uuid = null, p_deposito uuid = null)` | `jsonb` `{ desde, hasta, anterior_desde, anterior_hasta, ventas \| null, stock \| null, serie[] }` | `42501` sin organización; `22023` rango inválido o de más de 366 días |
| `public.resumen_inicio_bloques(p_desde, p_hasta, p_empresa = null, p_deposito = null)` | `jsonb` `{ por_tienda \| null, salidas_por_deposito \| null }` | igual que la anterior |
| `public.movimientos_por_producto(p_desde, p_hasta, p_empresa, p_deposito, p_busqueda, p_categoria, p_vista, p_orden, p_direccion, p_pagina, p_tamano)` | tabla de 14 columnas (las 12 visibles más `producto_id` y `total`) | `42501` sin `stock`; `22023` rango, vista, orden o dirección inválidos |
| `public.previsualizar_impacto_dolar(p_valor numeric, p_empresa uuid = null)` | `jsonb` `{ variacion_pct, recalcula, empresas[], muestra[], umbral_pct, confirmacion_pct, redondeo_pesos }`; **no escribe** | `42501` sin edición de `cotizacion_dolar`; `22023` valor nulo, ≤ 0, NaN, infinito, con más de 4 decimales o ≥ 1e10 |
| `public.aplicar_cotizacion(p_valor numeric, p_empresa uuid = null, p_variacion_vista numeric = null)` | el `jsonb` de `confirmar_cotizacion` `{ id, recalculo_aplicado, precios_recalculados }` | los de `cargar_cotizacion` (`42501`, `23514`) y `confirmar_cotizacion` (`22023` con `variacion_inusual` o `variacion_cambio`) |

- **Forma `null` por permiso**: `ventas` (de `resumen_inicio_periodo`), `por_tienda`,
  `salidas_por_deposito`, `ingresos`, `margen_pct` y la columna `ventas` de `movimientos_por_producto` vuelven
  `null` cuando al rol no le corresponde ese permiso.
- **Topes**: período de hasta **366 días**; `movimientos_por_producto` acota `p_tamano` a 1–100, `p_pagina` a
  1–100000 y la búsqueda a 100 caracteres; el orden y la dirección van por **lista blanca**, nunca como texto
  libre en el SQL dinámico.
- **Índice nuevo** `dominio.movimientos_stock_org_fecha_dia_idx (organizacion_id, fecha) include (diferencia,
  deposito_id, producto_id, tipo)` en `20270305105000`: el índice previo de esa tabla es por `creado_en`, no por
  `fecha`.
- **Actividad reciente no tiene RPC**: usa `public.listar_actividad` (existente, `security invoker`); el plan
  original proponía `actividad_reciente_inicio` y no se creó.

Detalle completo de los contratos: [API y RPC](api.md) y `specs/20261030-100000-inicio-y-alertas/contracts/inicio-y-alertas.md`.

## Quién ve qué por bloque y por rol

La autorización real está en la base (RLS / `private.nivel_seccion`); la pantalla solo oculta lo que la base le
devuelve `null`.

| Bloque | Sección | Cómo se evalúa el nivel |
|---|---|---|
| Ventas del período, «Resumen por tienda» (unidades), gráfico de ventas, columna **Ventas** del listado | `ventas` ≥ lectura | **Por tienda** (`private.nivel_ventas_en_empresa`): solo suman las tiendas accesibles donde el rol tiene `ventas` (D-11) |
| Ingresos y margen estimado de «Resumen por tienda» | `rentabilidad` ≥ lectura | Rol de la **organización** (no por tienda) |
| Stock hoy, gráfico de stock, «Salidas por depósito», «Movimientos por producto» | `stock` ≥ lectura | Mejor rol del usuario entre sus tiendas (sección compartida) |
| «Actividad reciente» | `actividad` ≥ lectura | Rol de la organización; la RLS de `registro_actividad` filtra por tienda |
| Enlace de «Ventas» a Reportes | `reportes` ≥ lectura | Rol en la tienda activa (sección por tienda) |
| Botón «Exportar» de Movimientos por producto | acción `exportar` de `stock` | Control de interfaz (`usePuedeAccion`); los datos los autoriza `stock` ≥ lectura |
| Tarjeta «Dólar»; aviso, «Cargar ahora» y «Corregir» | `cotizacion_dolar` ≥ lectura; **edición** para cargar | La RPC de vista previa y la de aplicar exigen edición (`42501` si no) |

Con la **matriz inicial** de permisos (`private.matriz_inicial()`; cada organización puede editarla, así que
esto es el valor de fábrica):

| Rol | Ventas y resumen por tienda | Ingresos y margen | Stock, salidas y movimientos | Actividad reciente | Enlace a Reportes | Exportar CSV | Dólar |
|---|---|---|---|---|---|---|---|
| Administrador | sí, todas las tiendas | sí | sí | sí | sí | sí | ve y carga |
| Administración | sí (sus tiendas) | **sí** | sí | sí | sí | sí | ve y carga |
| Operador | sí | no | sí | sí | no | sí | solo ve |
| Mostrador | sí | no | sí | no | no | no | solo ve |
| Consulta | sí | no | sí | no | no | no | solo ve |
| Depósito | sí (lectura) | no | sí | no | no | no | no |
| Miembro | sí (lectura) | no | sí | no | no | no | solo ve |
| Técnico | no | no | sí (lectura) | no | no | no | no |

Un rol con **solo `actividad`** ve únicamente «Actividad reciente» (y no se consulta el resumen de ventas y
stock). Un rol sin ninguna de las tres secciones no ve el tablero.

## Dependencia nueva: `@mui/x-charts`

Versión **exacta `8.29.3`** (publicada el 2026-08-21), licencia **MIT** (el paquete base de gráficos; no se
usa la edición Pro/Premium), mismo mantenedor y familia que `@mui/material` (peer `^5.15.14 || ^6 || ^7`).
Sin scripts de instalación propios; `pnpm audit --prod` no marca ningún aviso sobre esta cadena.

**Excepción de antigüedad y `overrides`.** Al incorporarlo, los 10 paquetes `d3-*` transitivos se resolvían a
versiones publicadas el 2026-11-03 (menos de 2 semanas, regla de la revisión de cadena de suministro). Se
descartaron (solo cambia el empaquetado, `src` pasa a `dist/*.mjs`, sin `fetch`, `child_process` ni `eval`;
con provenance SLSA de GitHub Actions) y se **fijaron a la versión inmediata anterior** con `overrides` en
`pnpm-workspace.yaml`: d3-array 3.2.4, d3-color 3.1.0, d3-format 3.1.2, d3-interpolate 3.0.1, d3-path 3.1.0,
d3-scale 4.0.2, d3-shape 3.2.0, d3-time 3.1.0, d3-time-format 4.1.0 y d3-timer 3.0.1. Se puede quitar el bloque
desde el 2026-11-17 y re-resolver el lockfile. Detalle de la revisión: `docs/seguridad-inicio-tablero.md` de
`dokploy`.

## Guía de prueba técnica

### Prerrequisitos

- Stack local (`pnpm dev:supabase`) con el panel servido (`pnpm dev:refine:host`), o **DEV**.
- Migraciones `20270305105000`–`20270305140000` aplicadas (vienen con la promoción de `dokploy`).
- Una organización con **dos empresas** y al menos un **depósito**, con ventas, notas de crédito y movimientos
  de stock de ambos lados; productos con y sin costo cargado.
- Usuarios con rol **Administrador**, **Operador**, **Mostrador** y **Consulta** (para ver la matriz de
  permisos por bloque).
- `@mui/x-charts` instalado en `apps/web` (aparece en `apps/web/package.json`).

### Pasos a mano

1. **Filtros en la URL.** Entrá a Inicio y elegí **7 días**: la barra de direcciones cambia a
   `?periodo=siete-dias`. Elegí **Rango**, poné dos fechas y confirmá que se voient en la URL
   (`&desde=…&hasta=…`). Poné una fecha de fin anterior a la de inicio: el campo avisa y el tablero sigue con
   el último período válido. Rótulo `[MSF-824:T002]`.
2. **Tienda y depósito.** Elegí una tienda en el filtro **Tienda** (la barra superior **no** cambia de
   empresa) y un depósito. Cambiá la empresa activa arriba: el tablero vuelve a seguirla y descarta la tienda
   del filtro. Rótulo `[MSF-824:T002]`.
3. **Indicadores de ventas.** Con una nota de crédito cargada, verificá que **Devoluciones (con IVA)** la
   reste de **Ventas (con IVA)** y que **Comprobantes** cuente solo facturas. La variación se mide contra el
   período anterior de igual largo. Rótulo `[MSF-824:T001]` y `[MSF-824:T003]`.
4. **Signo de la nota de crédito en la base.** En SQL: `select public.resumen_inicio_periodo(…)` con un rango
   que incluya la nota de crédito; el `ventas.monto` es menor que la suma de las facturas. Rótulo
   `[MSF-824:T001]`.
5. **Depósito y tienda ajenos.** Llamá la RPC con un `p_deposito` de otra organización: devuelve ceros o
   `null`, **sin error**. Rótulo `[MSF-824:T001]`.
6. **Gráfico.** Cambiá el período y verificá las dos series (barras de unidades vendidas y línea de stock al
   cierre) y el desplegable **Ver los datos como tabla**. Sin ventas en el período: «Sin datos en el
   período». Rótulo `[MSF-824:T004]`.
7. **Bloques de gestión.** Con **ventas** y **stock**: «Resumen por tienda», «Salidas por depósito» y
   «Actividad reciente». Entrá con un rol **solo de actividad**: no se consulta el resumen y solo se ve
   «Actividad reciente». Rótulo `[MSF-824:T007]` y `[MSF-824:T008]`.
8. **Margen sin permiso.** Entrá como **Operador**: en «Resumen por tienda» no hay ingresos ni margen, pero la
   tienda no desaparece. Rótulo `[MSF-824:T008]`.
9. **Listado por producto.** Verificá las 12 columnas, las vistas rápidas **Todos / En alerta / Quietos**, la
   búsqueda por nombre o SKU, el filtro por categoría, **Ordenar por** y la dirección, y que la carga
   continua muestre «Mostrando N de M productos». Con una tienda elegida, el listado trae solo sus
   productos. Rótulo `[MSF-824:T011]`.
10. **Cuadre del listado.** Con el período hasta hoy: `stock inicial + entradas − salidas + ajustes = stock
    actual`. Rótulo `[MSF-824:T010]`.
11. **Exportación.** Como **Administrador**, **Exportar** baja el CSV con los filtros aplicados (mismo nombre
    `movimientos-por-producto-AAAA-MM-DD.csv`); como **Mostrador**, el botón no está. Rótulo `[MSF-824:T012]`.
12. **Carga del dólar.** Como **Administrador**, en la tarjeta **Dólar** hacé clic en **Cargar ahora**:
    escribí un valor y mirá la vista previa (una tarjeta por tienda y la tabla de muestra) **sin que se
    guarde nada**; cancelá y comprobá que no quedó nada cargado. Rótulo `[MSF-824:T014]` y `[MSF-824:T015]`.
13. **Variación inusual.** Escribí un valor que se aleje más del 15 %: aparece **Variación inusual** y hay que
    tildar «Revisé el valor y quiero aplicarlo igual». Rótulo `[MSF-824:T016]`.
14. **Valor absurdo.** Escribí un valor 20 veces mayor que el vigente: el sistema avisa que puede ser un
    error de tipeo y no pide vista previa ni deja aplicar. Rótulo `[MSF-824:T016]`.
15. **Guardado atómico.** Confirmá con **Aplicar y recalcular**: el aviso dice «Cotización aplicada · N
    precios recalculados» y queda **una sola** cotización confirmada, con fecha y usuario. Intentá el mismo
    guardado con un valor inválido y comprobá en SQL que **no queda ninguna cotización pendiente** en
    `dominio.cotizacion_pendiente`. Rótulo `[MSF-824:T014]`.
16. **La base no ejecuta sin permiso.** Como `anon`, `select public.resumen_inicio_periodo(…)` debe fallar con
    `42501`; lo mismo con `public.movimientos_por_producto(…)`, `public.previsualizar_impacto_dolar(…)` y
    `public.aplicar_cotizacion(…)`. Rótulo `[MSF-824:T001]`, `[MSF-824:T010]` y `[MSF-824:T014]`.

### Resultado esperado

- Dado un administrador, cuando abre Inicio y elige período, tienda y depósito, entonces ve las ventas (con
  IVA) y el stock del período, el gráfico, el resumen por tienda, las salidas por depósito, la actividad
  reciente y el listado de movimientos por producto, todo con los mismos filtros.
- Dado un rol sin una de las secciones, cuando abre Inicio, entonces el bloque de esa sección no aparece y no
  se consulta; los demás siguen funcionando.
- Dado un administrador que carga el dólar, cuando escribe un valor, entonces ve el impacto por tienda antes
  de guardar; si cancela, no queda nada escrito; si confirma, queda una sola cotización confirmada, con fecha
  y usuario.

### Cómo automatizarlo

| Rótulo | Cobertura actual | Automatización pendiente |
|---|---|---|
| `[MSF-824:T001]` | pgTAP `supabase/tests/database/resumen_inicio_periodo.test.sql` (23 aserciones: signo de la NC, período anterior, tienda y depósito ajenos, serie diaria, tope de 366 días) | E2E de la barra de filtros con el período en la URL |
| `[MSF-824:T002]` | Vitest `apps/web/src/pages/inicio/__tests__/tablero-filtros.test.ts` (10 casos) | E2E de los tres filtros |
| `[MSF-824:T003]` | Vitest `tablero-inicio.test.tsx` (21 casos) + `pages/stock/list.test.tsx` y `pages/ventas-reportes/index.test.tsx` (lectura de los parámetros de la URL) | E2E del enlace a Reportes con el período |
| `[MSF-824:T004]` | `@mui/x-charts` 8.29.3 exacta con `overrides` de `d3-*`; Vitest `tablero-inicio.test.tsx` (gráfico vacío, tabla equivalente) | Verificación visual en dev; el modo oscuro sigue pendiente (MSF-849) |
| `[MSF-824:T005]` | Vitest + axe a 320/768/1440 px en `tablero-inicio.test.tsx` | — |
| `[MSF-824:T006]` | pgTAP `supabase/tests/database/inicio_tablero_bloques.test.sql` | — |
| `[MSF-824:T007]` | Vitest `apps/web/src/pages/inicio/__tests__/bloques-gestion.test.tsx` | E2E de la actividad (MSF-851) |
| `[MSF-824:T008]` | Vitest `bloques-gestion.test.tsx` (vacío, error con reintento y permisos) | E2E del error independiente por bloque (MSF-850) |
| `[MSF-824:T009]` | Vitest + axe `bloques-gestion.test.tsx` (CA-INI-05-3..9) | Sin E2E: no se pudo correr Supabase local en la sesión (MSF-851) |
| `[MSF-824:T010]` | pgTAP `inicio_tablero_bloques.test.sql` (12 columnas, orden y dirección por lista blanca, cuadre del stock inicial) | — |
| `[MSF-824:T011]` | Vitest `apps/web/src/pages/inicio/__tests__/movimientos-por-producto.test.tsx` (19 casos: vistas, búsqueda, categoría, orden, tienda, tope de búsqueda) | E2E del listado (MSF-851) |
| `[MSF-824:T012]` | Vitest `movimientos-por-producto.test.tsx` (exportación por lotes, prefijo del archivo, neutralización de fórmulas en el CSV) | — |
| `[MSF-824:T013]` | Vitest + axe `movimientos-por-producto.test.tsx` | Sin E2E (MSF-851) |
| `[MSF-824:T014]` | pgTAP `inicio_tablero_bloques.test.sql` (13 aserciones del dólar: permiso `42501`, valores inválidos, no escribe, `anon` sin ejecución) | — |
| `[MSF-824:T015]` | Vitest `components/cotizacion/DialogoCargarDolarConImpacto.test.tsx` y `pages/inicio/__tests__/tarjeta-dolar.test.tsx` | E2E del diálogo (MSF-851) |
| `[MSF-824:T016]` | Vitest `DialogoCargarDolarConImpacto.integrado.test.tsx` (contrato con las RPC: una sola llamada a `aplicar_cotizacion`, sin cargar ni descartar) y `hooks/usePrevisualizarImpactoDolar.test.tsx`; axe a 320/768/1440 px | E2E `apps/web/e2e/inicio.e2e.ts` (ya incluye un paso del diálogo; no se pudo correr en la sesión, queda para el CI) |
| `[MSF-824:T017]` | `docs/seguridad-inicio-tablero.md`, `docs/inicio-y-alertas.md`, los contratos y la fila de la épica en `docs/roadmap-template.md` | Manual de usuario de Inicio con capturas: esta página y la de producto |
| `[MSF-824:T018]` | CI verde del PR #899 (`application`, `database`, `web (1..3)`, `quality`) sobre `e8ef239e`; revisiones independientes de QA y Código/Seguridad por historia y re-revisión de las correcciones | Verificación en dev con el bundle y las RPC (posterior al merge) |

```bash
pnpm dev:supabase
pnpm --filter @platform/web test
pnpm test:db
pnpm --filter @platform/web test:e2e inicio
```

## Desvíos y pendientes

| Tema | Estado / dueño |
|---|---|
| El tema del panel no tiene modo oscuro: hoy no hay modo oscuro que verificar en el gráfico (RF-INI-04-7) | **MSF-849** |
| «Resumen por tienda» y «Salidas por depósito» comparten una lectura: si falla, fallan juntos (RF-INI-05-7 / CA-INI-05-8 pide error independiente por bloque) | **MSF-850** |
| Sin E2E de Playwright de los bloques, el listado y el diálogo del dólar: no se pudo correr Supabase local en las sesiones de desarrollo | **MSF-851** |
| Los indicadores de stock sin filtro propio y «Ajustes de stock» enlazan sin filtrar; el enlace a Reportes lleva solo el período (Reportes no admite tienda ni depósito) | Documentado en `docs/inicio-y-alertas.md` de `dokploy`; sin seguimiento: es alcance de esas pantallas |
| Sin acceso directo del dólar en `AccesosDirectos` (la spec base fija tres): el acceso es el aviso y su botón | Documentado en F-INI-07 |
| `AlertasInicio` sigue mostrando la alerta `dolar_sin_cargar` a quien solo tiene lectura (comportamiento previo de MSF-344) | Decisión de Nicolás (CA-INI-07-7) |
| `rentabilidad` se evalúa por organización y `ventas` por tienda | Decisión pendiente de Nicolás (ver `tasks.md` de la spec) y H-3 de la revisión de seguridad |
| H-2: el KPI «Ventas (con IVA)» y el ticket promedio se gatean por `ventas`, mientras que los ingresos por tienda exigen `rentabilidad` | Decisión de producto de Nicolás (ver la revisión de seguridad) |
| H-4: el permiso del dólar es compartido entre tiendas (la tienda se valida contra la organización, no contra las accesibles) | Heredado de `cargar_cotizacion`; Tarea `seguimiento` por crear |
| H-5: costo de `movimientos_por_producto` y de su exportación sin medir con volumen real | Medir en dev; `tasks.md` de la spec |
| **Capturas del manual de usuario** | TODO (dueño: Documentador / equipo de diseño): no se pudieron generar con `pnpm docs:capturas` (la herramienta no existe en este repo) y el código de la épica todavía no está en `main`. Cuando exista, guardar las capturas en `docs/producto/img/inicio-y-alertas/`: los tres filtros, «Ventas del período», «Stock hoy», el gráfico, «Resumen por tienda», «Salidas por depósito», «Actividad reciente», el listado «Movimientos por producto» y el cuadro «Cargar dólar del día» con su vista previa. |
| Verificación en dev con el bundle y las RPC | Posterior al merge; a cargo de la sesión principal (registrado en el PR #899) |

## Reversión

Migración posterior que haga `drop function` de las cinco RPC y `drop index
dominio.movimientos_stock_org_fecha_dia_idx` (sin datos que guardar). En el front, volver la pantalla de
Inicio a la de la spec base: quitar `pages/inicio/tablero/`, `lib/inicioTablero.ts`, `lib/inicioBloques.ts`,
`hooks/useMovimientosPorProducto.ts`, `hooks/usePrevisualizarImpactoDolar.ts` y
`components/cotizacion/DialogoCargarDolarConImpacto.tsx`, y dejar `TarjetaDolar` como estaba (con
`DialogoCargarDolar`). El cierre de la épica es un merge commit: `git revert -m 1 <hash>` deshace la épica
completa.
