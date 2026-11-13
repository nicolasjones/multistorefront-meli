# Tasks: Inicio · Tablero completo (MSF-824)

## F-INI-04 · MSF-820
- [ ] T001 RPC `resumen_inicio_periodo` + pgTAP (permisos, signo de NC, tienda, depósito)
- [ ] T002 Barra de filtros con estado en URL (Período, Tienda, Depósito)
- [ ] T003 Filas «Ventas del período» y «Stock hoy» con enlaces filtrados
- [ ] T004 Dependencia `@mui/x-charts` (versión fija, doc, supply-chain) y gráfico «Ventas y stock en el tiempo» (claro/oscuro, axe)
- [ ] T005 Tests Vitest + axe 320/768/1440

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
- [ ] T015 Montar `DialogoCargarDolar` en Inicio con empresa activa y vista previa
- [ ] T016 Tests Vitest (umbrales 1 % y 15 %, cancelar, valor inválido, operador sin botón)

## Cierre
- [ ] T017 Documentación (`docs/inicio-y-alertas.md`, contratos, roadmap) y revisión de seguridad integral
- [ ] T018 Guards, CI completo, revisiones QA y Código/Seguridad por historia, merge a `dokploy`, verificación en dev
