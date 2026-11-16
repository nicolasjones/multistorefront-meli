---
owner: datos
sources:
  - specs/20270328-100000-gastos-de-la-empresa
  - apps/web/src/pages/gastos
  - supabase/tests/database
---

# Gastos de la empresa y margen después de costos fijos

Referencia técnica de F-GAS-01 «Registrar gastos», F-GAS-02 «Consultar gastos por período y categoría» y F-GAS-03 «Margen después de costos fijos» (épica MSF-469). Spec: `specs/20270328-100000-gastos-de-la-empresa`.

**Alcance entregado**: el registro y la consulta (fases 1 y 2, sin efecto en ninguna cifra) y la medida «margen después de costos fijos» (fase 3: vistas de `analitica`, bandera `margen_costos_fijos` **apagada**, pestaña de Rentabilidad y tablero de Superset), más el cierre (fase 4). Nada de lo existente (márgenes, rentabilidad, reportes, correo semanal, Inicio) lee gastos ni cambia su resultado: la medida nueva se calcula **sobre** `analitica.margen_real_categoria` sin modificarla.

## Modelo

- Tabla `dominio.gastos` (migración `20270349000000_gastos.sql`): una fila por gasto de **una** empresa, con fecha (define el mes de imputación), concepto (catálogo cerrado de 7: Alquiler, Servicios, Sueldos, Fletes, Insumos, Impuestos, Otros), tipo de costo (`fijo` o `variable`), detalle (hasta 200), importe en la moneda original, moneda (`ARS` o `USD`), cotización usada e importe en pesos **congelados al guardar**, marca «recurrente» (informativa), anulación (`anulado_en`, `anulado_por`, `motivo_anulacion`) y `updated_at` como bloqueo optimista.
- Un `check` liga moneda, cotización e importe en pesos; otro exige el motivo si y solo si el gasto está anulado.
- Seguridad: RLS por organización, empresa accesible (`private.empresas_accesibles()`) y sección `rentabilidad` (lectura o edición). `authenticated` solo tiene `select`; no hay política ni privilegio de `insert`, `update` ni `delete` para los roles de la aplicación: **no existe borrado físico**, lo cargado por error se anula con motivo. `anon` no tiene privilegios. `service_role` opera la tabla como el resto de `dominio`.
- La tabla entra a la exportación total de la organización (`20270349000200_gastos_exportacion_total.sql`).

## RPC (`public`, `security definer`, `search_path = ''`)

| Función | Qué hace | Errores |
|---|---|---|
| `guardar_gasto` | Crea (`p_id` nulo) o edita; exige `edicion` en `rentabilidad`; congela la cotización | `42501`, `P0002`, `22023`, `40001` |
| `anular_gasto` | Anula con motivo obligatorio; repetirla no falla | `42501`, `P0002`, `22023`, `40001` |
| `listar_gastos` | Tandas con cursor `(fecha desc, id)` y filtros de empresa, concepto, tipo y anulados | `42501` |
| `resumen_gastos` | Total en pesos, conteo y desglose por concepto y tipo (excluye anulados) | `42501` |
| `exportar_gastos` | Filas del listado filtrado (tope 10.000) y evento `gasto.exportado` | `42501` |

`exportar_gastos` es una quinta función respecto del contrato original: el evento de exportación solo puede registrarse desde la base.

**Dólar congelado**: un gasto en USD guarda la cotización aplicada del dólar de la empresa (o la general) **más cercana a la fecha del gasto** (`analitica.cotizacion_cercana`) y el importe en pesos resultante; una cotización cargada después no lo reescribe. Sin cotización, el alta se rechaza con «Cargá la cotización del dólar».

**Actividad**: `gasto.creado`, `gasto.editado`, `gasto.anulado` y `gasto.exportado`. No son tipos sensibles (no son cambios de acceso ni permisos), por eso el catálogo de tipos sensibles de la auditoría no cambia. **Decisión (delegada, D19): los eventos no llevan cifras.** Actividad se lee con la sección `actividad`, que no implica `rentabilidad`; por eso el `detalle` y el jsonb guardan solo el concepto, el nombre de la empresa y, al editar, los nombres de los campos modificados (`campos_modificados`), nunca el importe, la moneda, los pesos ni el motivo de anulación (ese vive en `dominio.gastos`). `exportar_gastos` con una empresa no accesible lanza `42501` y no la nombra.

**Nota de privacidad de Actividad**: Actividad muestra la categoría del gasto, el nombre de la empresa y los nombres de los campos modificados, nunca cifras; quien tiene `actividad` sin `rentabilidad` puede inferir que existe un gasto de esa categoría (p. ej. «Sueldos») y que se cambió su importe. Es la consecuencia aceptada de D19; si más adelante se decide ocultar también la categoría, bastaría cambiar el `detalle` y el jsonb de las RPC `guardar_gasto` y `anular_gasto`. Ese hueco (`registro_actividad_select` filtraba por organización y sección `actividad` pero no por empresa accesible) se cerró en la fase 3 con el seguimiento MSF-968: ver [Actividad por empresa accesible](#actividad-por-empresa-accesible-msf-968).

**Validación**: fecha entre 2000-01-01 y 31 días a futuro; importe con hasta 2 decimales y menor que 10^12; si el importe en pesos de un gasto en USD desborda, `22023` con mensaje claro. Al editar un gasto en USD la cotización se recalcula si cambia el importe, la fecha, la tienda o la moneda; si solo cambia otro dato, se conserva.

## Pantalla

Administración → **Gastos** (`/gastos`, solo administradores con la sección `rentabilidad`). Períodos Hoy, Semana (últimos 7 días), Mes y Mes anterior en hora de Buenos Aires, filtro de tienda (`FiltroEmpresa`), de concepto y de tipo de costo, total con desglose, «Mostrar anulados», «Exportar» y «Nuevo gasto». El listado carga por tandas con carga infinita y «Cargar más». Al cambiar la empresa activa se recarga todo y un diálogo abierto se cierra con aviso sin guardar. El manual de producto está en [producto/gastos.md](producto/gastos.md).

## Margen después de costos fijos (fase 3, F-GAS-03)

Medida **nueva y separada**, detrás de la bandera `margen_costos_fijos` (apagada por defecto en todo entorno). Con la bandera apagada la pestaña no existe, las vistas nuevas no devuelven filas y todo lo existente es idéntico (`margen_costos_fijos_paridad.test.sql`).

**Migraciones** (ventana `20270421…`, renumeradas por encima de la máxima de `dokploy`): `20270421000000_costos_fijos_bandera_y_vistas.sql`, `20270421000100_margen_despues_costos_fijos.sql` y `20270421000200_actividad_por_empresa_accesible.sql` (MSF-968).

| Objeto (esquema `analitica`) | Qué es |
|---|---|
| `bandera_activa(text)` | `true` solo si la bandera existe y está encendida; la ejecuta únicamente `superset_analitica` |
| `costos_fijos_empresa_mes` | Σ `importe_pesos` de los gastos **fijos** vigentes por organización × empresa × mes. Sin detalle, categoría ni importes individuales |
| `ventas_netas_empresa_mes` | Σ signo × `subtotal_sin_iva` de todas las líneas facturadas por empresa y mes, con el predicado y el signo del margen real (incluye líneas sin costo guardado) |
| `margen_despues_costos_fijos` | Las columnas de `margen_real_categoria` más `tasa_fija`, `cargo_costos_fijos`, `margen_despues_fijos` y `margen_despues_fijos_pct` |
| `margen_costos_fijos_empresa_mes` | **Cuarta vista, desvío declarado**: por empresa y mes, ventas, fijos, margen vigente, cargo atribuido, margen después de fijos y «Sin atribuir». No se puede sumar desde la vista por producto sin repetir el costo fijo por cada fila |

**Fórmula** (D4 a D8): `tasa_fija = costos_fijos(empresa, mes) ÷ ventas_netas(empresa, mes)` (nula si las ventas son ≤ 0); `cargo = vendido × tasa_fija`; `margen después de fijos = margen − cargo`. La nota de crédito resta porque el `vendido` ya lleva el signo. **«Sin atribuir»** = costos fijos − Σ cargo: la parte que le toca a las ventas sin costo guardado. No hay redondeo en la base (la suma de cargos más «Sin atribuir» da exactamente el costo fijo del mes, SC-002); el tablero muestra a 2 decimales. Un gasto en USD entra con su cotización congelada al guardarlo. El mes en curso es provisorio y el tablero lo rotula. El umbral de «margen bajo» no se aplica a la medida nueva.

**Seguridad**: las cuatro vistas y la función solo las lee `superset_analitica`; el token de Superset del tablero lleva `organizacion_id` y `empresa_id` (`reportes.filtro_empresa = true`: todas las vistas exponen `empresa_id`). Ninguna otra función ni vista lee `dominio.gastos` (`gastos_superficies.test.sql`).

**Pantalla**: pestaña «Después de costos fijos» en Rentabilidad (`/rentabilidad/costos-fijos`, `pages/rentabilidad/CostosFijos.tsx`), visible solo con la bandera encendida y `lectura` en `rentabilidad`; con la bandera apagada la ruta redirige a Rentabilidad. Sigue la empresa activa de la barra superior (`FiltroEmpresa` y filtro nativo «Empresa» del tablero), muestra el método y el aviso del mes en curso, y ante un 403 del token muestra el acceso restringido. Tablero: `infra/superset/dashboards/rentabilidad/` («Rentabilidad · Después de costos fijos»: tarjetas por tienda y consolidado, cortes por producto y por categoría y rótulo del método).

**Encender** (equipo técnico, dev → stg → prd): `update public.banderas_plataforma set activa = true where clave = 'margen_costos_fijos';`. **Apagar** (reversión inmediata, sin migrar): `activa = false`. Importar el tablero nuevo con `pnpm superset:importar-dashboards` antes de encender (sin el tablero, la pestaña muestra «todavía no está disponible»).

**Rendimiento (EXPLAIN en dev)**: el cruce por mes arma ventas y fijos por `organizacion_id`, `empresa_id` y mes (columnas del `GROUP BY`, así el filtro del token se empuja al escaneo). En dev, con 282 líneas de comprobantes y 300 gastos sintéticos por empresa, `margen_costos_fijos_empresa_mes` ejecuta en ~180 ms y el plan usa `gastos_org_empresa_fecha_idx` y los índices de comprobantes. La base de dev no tiene ventas con costo guardado, así que **hay que volver a medir con datos reales antes de encender en producción**.

### Actividad por empresa accesible (MSF-968)

`registro_actividad_select` y `exportar_actividad` (`security definer`) ahora también filtran por empresa: un evento con empresa solo lo ve quien accede a esa empresa (administrador: todas las de su organización; el resto, las asignadas; superadmin: las de su organización activa); los eventos sin empresa siguen visibles para quien tiene la sección. Se usa `private.empresas_de_actividad()`, igual que `empresas_accesibles()` pero **incluyendo las empresas pausadas**, para que su historial no desaparezca. `listar_actividad`, `obtener_detalle_actividad` y `opciones_actividad` son `security invoker` y heredan el cambio. Ningún evento se modifica. Pruebas: `actividad_por_empresa.test.sql`. Efecto visible: quien tiene `actividad` y una sola tienda asignada ya no ve el historial de las demás tiendas.

## Reversión

La tabla y las funciones son aditivas. La medida nueva se apaga al instante con la bandera (`activa = false`); las vistas y la función de `analitica` se retiran con `drop view` y `drop function` en una migración posterior. Para retirar el registro hay que escribir una migración posterior (`drop function` de las cinco funciones y `drop table dominio.gastos`, exportando antes los datos); no se hace en el mismo PR que las crea.
