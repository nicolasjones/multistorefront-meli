# Tasks: Inicio · Tablero completo (MSF-824)

## F-INI-04 · MSF-820
- [ ] T001 RPC `resumen_inicio_periodo` + pgTAP (permisos, signo de NC, tienda, depósito)
- [x] T002 Barra de filtros con estado en URL (Período, Tienda, Depósito) — `pages/inicio/tablero/{filtros.ts,FiltrosTablero.tsx}`; `tablero-filtros.test.ts` y `tablero-inicio.test.tsx` (FR-001)
- [x] T003 Filas «Ventas del período» y «Stock hoy» con enlaces filtrados — `TableroInicio.tsx`, `Indicador.tsx`; Reportes de ventas y Stock leen `desde/hasta` y `filtro/deposito` de la URL. Desvío: ajustes de stock y los indicadores sin filtro propio enlazan sin filtrar (ver docs/inicio-y-alertas.md)
- [x] T004 Dependencia `@mui/x-charts` (versión fija, doc, supply-chain) y gráfico «Ventas y stock en el tiempo» (claro/oscuro, axe) — `@mui/x-charts` 8.29.3 exacta (MIT), nota en docs/inicio-y-alertas.md; `GraficoVentasStock.tsx` con colores del tema. Desvío: el tema del panel es solo claro, no hay modo oscuro que verificar
- [x] T005 Tests Vitest + axe 320/768/1440 — 31 tests: `tablero-filtros.test.ts` (10) y `tablero-inicio.test.tsx` (21, con axe a 320/768/1440)

## F-INI-05 · MSF-821
- [ ] T006 Ampliar la RPC (resumen por tienda, salidas por depósito) + pgTAP
- [ ] T007 RPC `actividad_reciente_inicio` + pgTAP
- [ ] T008 Cuatro bloques con vacío/error independientes y permisos (margen solo con `rentabilidad`)
- [ ] T009 Tests Vitest + axe

## F-INI-06 · MSF-822
- [ ] T010 RPC `movimientos_por_producto` (12 columnas, orden/filtros en servidor) + pgTAP
- [ ] T011 Tabla con carga infinita, vistas rápidas, búsqueda, categoría, orden
- [ ] T012 Exportación CSV por lotes (sin exportar para Consulta)
- [ ] T013 Tests Vitest + axe

## F-INI-07 · MSF-823
- [ ] T014 RPC `previsualizar_impacto_dolar` + pgTAP (no escribe)
- [x] T015 Montar el diálogo del dólar en Inicio con empresa activa y vista previa pura (`DialogoCargarDolarConImpacto`, hook `usePrevisualizarImpactoDolar`; `TarjetaDolar` lo abre desde «Cargar ahora», solo con edición). Evidencia: `components/cotizacion/DialogoCargarDolarConImpacto.tsx`, `pages/inicio/TarjetaDolar.tsx`. Desvío: no hay un acceso directo de dólar en `AccesosDirectos` (la spec base fija tres); el acceso es el aviso y su botón.
- [x] T016 Tests Vitest (umbrales 1 % y 15 %, cancelar, valor inválido, operador sin botón). Evidencia: 20 tests del diálogo (con axe a 320/768/1440), 8 de la tarjeta y 4 del hook; la pantalla Cotización sigue verde (suites de `components/cotizacion` y `pages/cotizacion`).

## Cierre
- [ ] T017 Documentación (`docs/inicio-y-alertas.md`, contratos, roadmap) y revisión de seguridad integral
- [ ] T018 Guards, CI completo, revisiones QA y Código/Seguridad por historia, merge a `dokploy`, verificación en dev
