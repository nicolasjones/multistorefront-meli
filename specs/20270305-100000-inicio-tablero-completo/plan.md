# Plan de implementación: Inicio · Tablero completo (MSF-824)

**Spec**: `spec.md` · **Rama**: `epic/MSF-824-inicio-tablero-completo` (PR #899 a `dokploy`)

## Orden

F-INI-04 (filtros + RPC base + gráfico) → F-INI-05 (bloques; reusa filtros) → F-INI-06 (listado) → F-INI-07 (dólar, independiente: puede ir en paralelo). Cada historia termina con tests, guards y las revisiones QA y Código/Seguridad antes de su merge.

## Esquemas y reversión (aditivo)

| Migración (> 20270304100000) | Historia | Objetos | Reversión |
|---|---|---|---|
| `20270305105000_resumen_inicio_periodo.sql` | F-INI-04 | `public.resumen_inicio_periodo` + índice `dominio.movimientos_stock_org_fecha_dia_idx` | `drop function` + `drop index` |
| `20270305110000_resumen_inicio_bloques.sql` | F-INI-05 | `public.resumen_inicio_bloques` (resumen por tienda y salidas por depósito) | `drop function` |
| `20270305120000_movimientos_por_producto.sql` | F-INI-06 | `public.movimientos_por_producto` | `drop function` |
| `20270305130000_previsualizar_impacto_dolar.sql` | F-INI-07 | `public.previsualizar_impacto_dolar` | `drop function` |
| `20270305140000_aplicar_cotizacion.sql` | F-INI-07 | `public.aplicar_cotizacion` (carga + confirma atómico) | `drop function` |

«Actividad reciente» no tiene migración: usa `public.listar_actividad` (el plan original proponía `actividad_reciente_inicio`; no se creó).

Sin tablas: `rls_en_toda_tabla` no cambia. Tests pgTAP por función: permisos por rol, `anon` sin ejecución, tienda no accesible, notas de crédito que restan, costo `null` sin `rentabilidad`.

## Front

- `apps/web/src/pages/inicio/tablero/`: barra de filtros (estado en la URL, sigue a la empresa activa con `useFiltroPorEmpresaActiva`), filas de indicadores, gráfico (`@mui/x-charts` con tema), cuatro bloques, listado con `CargaInfinita` + `useListadoAcumulado`, exportación CSV con `useExportarCsv`.
- Dólar: `TarjetaDolar` abre `DialogoCargarDolarConImpacto` (comparte `CampoDolar` y `AlertaVariacionInusual` con `DialogoCargarDolar`, que no cambia), con la empresa activa; vista previa con `previsualizar_impacto_dolar` y guardado con `aplicar_cotizacion`. El acceso directo en `AccesosDirectos` no se hizo (la spec base fija tres): el acceso es el aviso.
- Cada bloque con `TarjetaInicio`-style: carga, vacío y error con reintento independientes; oculto y sin consulta si no hay permiso.

## Riesgos

- Dependencia nueva: versión fijada, documentación y revisión de cadena de suministro (CLAUDE.md).
- `productos_mas_vendidos` suma sin signo: no se reutiliza.
- Costo y margen por rol: se filtran en la RPC, no solo en pantalla.
- Fechas: usar el día de Buenos Aires en las RPC (trampa conocida UTC vs ART).
- Documentación en el mismo cambio: `docs/inicio-y-alertas.md`, contratos y `docs/roadmap-template.md`.
