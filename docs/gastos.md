---
owner: datos
sources:
  - specs/20270328-100000-gastos-de-la-empresa
  - apps/web/src/pages/gastos
  - supabase/tests/database
---

# Gastos de la empresa (fases 1 y 2: registro y consulta)

Referencia técnica de F-GAS-01 «Registrar gastos» y F-GAS-02 «Consultar gastos por período y categoría» (épica MSF-469). Spec: `specs/20270328-100000-gastos-de-la-empresa`.

**Alcance entregado**: solo el registro y la consulta. **No** se entregó la medida «margen después de costos fijos» (fase 3: vistas de `analitica`, bandera `margen_costos_fijos`, pestaña de Rentabilidad y tablero de Superset) ni el cierre (fase 4). Nada de lo existente (márgenes, rentabilidad, reportes, correo semanal, Inicio) lee gastos ni cambia su resultado: registrar y consultar gastos no depende de ninguna bandera porque no mueve cifras.

## Modelo

- Tabla `dominio.gastos` (migración `20270343000000_gastos.sql`): una fila por gasto de **una** empresa, con fecha (define el mes de imputación), concepto (catálogo cerrado de 7: Alquiler, Servicios, Sueldos, Fletes, Insumos, Impuestos, Otros), tipo de costo (`fijo` o `variable`), detalle (hasta 200), importe en la moneda original, moneda (`ARS` o `USD`), cotización usada e importe en pesos **congelados al guardar**, marca «recurrente» (informativa), anulación (`anulado_en`, `anulado_por`, `motivo_anulacion`) y `updated_at` como bloqueo optimista.
- Un `check` liga moneda, cotización e importe en pesos; otro exige el motivo si y solo si el gasto está anulado.
- Seguridad: RLS por organización, empresa accesible (`private.empresas_accesibles()`) y sección `rentabilidad` (lectura o edición). `authenticated` solo tiene `select`; no hay política ni privilegio de `insert`, `update` ni `delete` para los roles de la aplicación: **no existe borrado físico**, lo cargado por error se anula con motivo. `anon` no tiene privilegios. `service_role` opera la tabla como el resto de `dominio`.
- La tabla entra a la exportación total de la organización (`20270343000200_gastos_exportacion_total.sql`).

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

**Nota de privacidad de Actividad**: Actividad muestra la categoría del gasto, el nombre de la empresa y los nombres de los campos modificados, nunca cifras; quien tiene `actividad` sin `rentabilidad` puede inferir que existe un gasto de esa categoría (p. ej. «Sueldos») y que se cambió su importe. Es la consecuencia aceptada de D19; si más adelante se decide ocultar también la categoría, bastaría cambiar el `detalle` y el jsonb de las RPC `guardar_gasto` y `anular_gasto`. Además, `registro_actividad_select` filtra por organización y sección `actividad` pero no por empresa accesible (preexistente y común a todos los eventos, no se cambia en este PR): quien tiene `actividad` ve esos datos aun de empresas que no puede acceder. Seguimiento: MSF-968 «Actividad: filtrar registro_actividad por empresas accesibles».

**Validación**: fecha entre 2000-01-01 y 31 días a futuro; importe con hasta 2 decimales y menor que 10^12; si el importe en pesos de un gasto en USD desborda, `22023` con mensaje claro. Al editar un gasto en USD la cotización se recalcula si cambia el importe, la fecha, la tienda o la moneda; si solo cambia otro dato, se conserva.

## Pantalla

Administración → **Gastos** (`/gastos`, solo administradores con la sección `rentabilidad`). Períodos Hoy, Semana (últimos 7 días), Mes y Mes anterior en hora de Buenos Aires, filtro de tienda (`FiltroEmpresa`), de concepto y de tipo de costo, total con desglose, «Mostrar anulados», «Exportar» y «Nuevo gasto». El listado carga por tandas con carga infinita y «Cargar más». Al cambiar la empresa activa se recarga todo y un diálogo abierto se cierra con aviso sin guardar. El manual de producto está en [producto/gastos.md](producto/gastos.md).

## Reversión

La tabla y las funciones son aditivas. Para retirarlas hay que escribir una migración posterior (`drop function` de las cinco funciones y `drop table dominio.gastos`, exportando antes los datos); no se hace en el mismo PR que las crea.
