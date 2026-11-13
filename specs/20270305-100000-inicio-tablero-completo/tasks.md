# Tasks: Inicio · Tablero completo (MSF-824)

## F-INI-04 · MSF-820
- [x] T001 RPC `resumen_inicio_periodo` + pgTAP (permisos, signo de NC, tienda, depósito) — migración `20270305100000` (serie de stock en una pasada sobre productos activos + índice `movimientos_stock_org_fecha_dia_idx`) y `resumen_inicio_periodo.test.sql` (23 aserciones: signo de NC, período anterior, tienda/depósito ajenos, serie, tope de 366 días). CI `database` pasó en 8589dfb7; la versión corregida (c0482a50) la valida el CI del PR #899.
- [x] T002 Barra de filtros con estado en URL (Período, Tienda, Depósito) — `pages/inicio/tablero/{filtros.ts,FiltrosTablero.tsx}`; `tablero-filtros.test.ts` y `tablero-inicio.test.tsx` (FR-001)
- [x] T003 Filas «Ventas del período» y «Stock hoy» con enlaces filtrados — `TableroInicio.tsx`, `Indicador.tsx`; Reportes de ventas y Stock leen `desde/hasta` y `filtro/deposito` de la URL. Desvío: ajustes de stock y los indicadores sin filtro propio enlazan sin filtrar (ver docs/inicio-y-alertas.md)
- [x] T004 Dependencia `@mui/x-charts` (versión fija, doc, supply-chain) y gráfico «Ventas y stock en el tiempo» (claro/oscuro, axe) — `@mui/x-charts` 8.29.3 exacta (MIT), nota en docs/inicio-y-alertas.md; `GraficoVentasStock.tsx` con colores del tema. Desvío: el tema del panel no tiene modo oscuro; seguimiento MSF-849. Los 10 `d3-*` transitivos se fijan con `overrides` por antigüedad (nota en docs). Desvío: el tema del panel es solo claro, no hay modo oscuro que verificar
- [x] T005 Tests Vitest + axe 320/768/1440 — 31 tests: `tablero-filtros.test.ts` (10) y `tablero-inicio.test.tsx` (21, con axe a 320/768/1440)

## F-INI-05 · MSF-821
- [x] T006 RPC hermana `resumen_inicio_bloques` (resumen por tienda, salidas por depósito) + pgTAP. Evidencia: migración `20270305110000`, `supabase/tests/database/inicio_tablero_bloques.test.sql`; CI `database` verde sobre `8589dfb7`. Desvío: RPC hermana, no ampliación de `resumen_inicio_periodo` (la historia admite ambas).
- [x] T007 «Actividad reciente» usa `public.listar_actividad` existente, **sin RPC nueva** (ya trae fecha, usuario, tienda y filtra por la RLS de `actividad`). Evidencia: `lib/inicioBloques.ts` (`leerActividadReciente`), `bloques-gestion.test.tsx`.
- [x] T008 Bloques con vacío/error y permisos (ingresos y margen solo con `rentabilidad`). Evidencia: `tablero/BloquesGestion.tsx`; «Qué hacer hoy» ya existía (ahora dice «Todo al día» sin alertas). Desvío: «Resumen por tienda» y «Salidas por depósito» comparten una lectura (si falla, fallan juntos con su reintento); la actividad es independiente.
- [x] T009 Tests Vitest + axe (320/768/1440). Evidencia: `__tests__/bloques-gestion.test.tsx` (CA-INI-05-3..9). CA-INI-05-1/2 los cubren `alertas-lista`/`alertas-demora`.

## F-INI-06 · MSF-822
- [x] T010 RPC `movimientos_por_producto` (12 columnas, orden/filtros en servidor) + pgTAP. Evidencia: migración `20270305120000`, `inicio_tablero_bloques.test.sql`; CI `database` verde sobre `8589dfb7`.
- [x] T011 Tabla con carga infinita, vistas rápidas, búsqueda, categoría, orden. Evidencia: `tablero/MovimientosPorProducto.tsx`, `hooks/useMovimientosPorProducto.ts`, `lib/inicioBloques.ts`.
- [x] T012 Exportación CSV por lotes (sin exportar para quien no puede exportar Stock). Evidencia: `useExportarCsv` + prefijo `movimientos-por-producto` en `lib/exportarCsv.ts`; test «exportar baja por lotes…».
- [x] T013 Tests Vitest + axe (320/768/1440). Evidencia: `__tests__/movimientos-por-producto.test.tsx` (19 tests, CA-INI-06-1..11).

## F-INI-07 · MSF-823
- [ ] T014 RPC `previsualizar_impacto_dolar` + pgTAP (no escribe)
- [x] T015 Montar el diálogo del dólar en Inicio con empresa activa y vista previa pura (`DialogoCargarDolarConImpacto`, hook `usePrevisualizarImpactoDolar`; `TarjetaDolar` lo abre desde «Cargar ahora», solo con edición). Evidencia: `components/cotizacion/DialogoCargarDolarConImpacto.tsx`, `pages/inicio/TarjetaDolar.tsx`. Desvío: no hay un acceso directo de dólar en `AccesosDirectos` (la spec base fija tres); el acceso es el aviso y su botón.
- [x] T016 Tests Vitest (umbrales 1 % y 15 %, cancelar, valor inválido, operador sin botón). Evidencia: 20 tests del diálogo (con axe a 320/768/1440), 8 de la tarjeta y 4 del hook; la pantalla Cotización sigue verde (suites de `components/cotizacion` y `pages/cotizacion`).

## Cierre
- [ ] T017 Documentación (`docs/inicio-y-alertas.md`, contratos, roadmap) y revisión de seguridad integral
- [ ] T018 Guards, CI completo, revisiones QA y Código/Seguridad por historia, merge a `dokploy`, verificación en dev
