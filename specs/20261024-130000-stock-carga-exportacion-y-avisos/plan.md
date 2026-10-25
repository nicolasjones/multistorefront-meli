# Implementation Plan: Stock · Stock carga, exportación y avisos

**Spec**: `specs/20261024-130000-stock-carga-exportacion-y-avisos/spec.md` · **Épica**: MSF-368 · **Rama**: `epic/MSF-368-stock-stock-carga-exportacion-y-avisos`

## Resumen

Cinco historias independientes sobre el Stock ya entregado (MSF-136/231/292) y las ventas de MSF-159: carga inicial por planilla (F-STK-07), exportación a CSV (F-STK-08), resumen de reposición por correo (F-STK-09), faltantes con aviso al cliente (F-STK-17) y más vendidos (F-STK-18). Alcance de entrega: `refine`, `supabase`, `kestra`.

## Contexto técnico

- **Stack**: React + Refine + MUI en `apps/web`; Supabase self-hosted (migraciones + pgTAP); Edge Functions en `supabase/functions`; flows de Kestra en `infra/kestra/flows`.
- **Reutiliza** (verificado en el repo): `public.registrar_movimiento_stock(…, p_deposito)`; `public.stock_estados` (con `reservado`/`disponible`); `dominio.reservas_stock` (`estado = 'activa'`, `referencia = 'comprobante:<id>:linea:<orden>'`); `dominio.comprobantes_venta(_lineas)` con `empresa_id`, `a_pedido`; `private.nivel_ventas_en_empresa(empresa)`; `private.comprobante_cuenta_como_facturado(tipo, estado)`; `apps/web/src/lib/exportarClientes.ts` (`neutralizarFormula`, `TAMANO_LOTE_EXPORTACION`); `lib/periodosRanking.ts`; `components/pagina/FiltroEmpresa`; `write-excel-file` (plantilla `.xlsx`); el patrón de avisos de F-CON-03 (`dominio.consultas_avisos`, `supabase/functions/enviar-aviso-consulta`, `infra/kestra/flows/avisos-consultas.yml`, `supabase/functions/_shared/correo.ts`).
- **Dependencia nueva a evaluar**: `read-excel-file` (MIT, misma familia que `write-excel-file`) para leer `.xlsx` en el navegador, cargada de forma diferida en `/stock/excel`. Pasa por `supply-chain-security` antes de fijar versión exacta.
- **Pestañas/rutas compartidas**: `PestanasStock.tsx` y `App.tsx` los editan F-STK-07, F-STK-17 y F-STK-18 (una línea cada una); por eso esas tres historias van en grupos distintos del plan de ejecución.
- **Migraciones** (cada historia trae la suya, sin encadenarse; timestamps posteriores a `20261205200200`): F-STK-07 `20261206100000…100100`; F-STK-09 `20261212140000…110100`; F-STK-17 `20261206120000…120200`; F-STK-18 `20261206130000`. Todas aditivas con reversión en el encabezado.
- **Contratos**: `contracts/stock-carga-exportacion-y-avisos.md`.

## Constitución — verificación

| Principio | Cumplimiento |
|---|---|
| I Aislamiento multi-tenant | 4 tablas nuevas con RLS por organización; vista `security_invoker`; RPC con organización de la sesión (`private.organizacion_id()`), nunca de un argumento. |
| II Especificar antes | Esta spec; permisos, fallos y auditoría declarados en FR-011, FR-207, FR-308. |
| III Idempotencia y auditoría | Carga con clave e índice único; resumen reservado con vencimiento; aviso por línea único; eventos `stock.carga_inicial`; estados, intentos y error útil registrados. |
| IV Despliegues independientes | Flows y funciones propios; sin Compose raíz. |
| V Simplicidad | Sin worker ni Superset: la planilla se lee en el navegador y se aplica con una RPC; los correos reutilizan el patrón F-CON-03. |
| VI Panel operable | Pestañas dentro de Stock, rutas con carga diferida, estados compartidos, teclado y 320/768/1440 px (spec, *Navegación*). |
| VII Esquemas | Verificado tabla por tabla en la spec: `cargas_iniciales_stock`, `stock_avisos_reposicion`, `stock_alertas_avisadas`, `faltantes_avisos` → `dominio`; `faltantes_listado` → vista en `public` (`security_invoker`). Se re-verifica en tareas, implementación y revisión (tarea de cierre). |
| VIII Empresa activa | Faltantes y Más vendidos la respetan con test; Excel y Exportar declaran «no aplica» con motivo (matriz). |
| Documentación | Una guía `docs/stock-*.md` por historia + enlaces en `docs/stock.md` (cierre). |

## Diseño por historia

### F-STK-07 · Carga inicial y masiva

- **Datos**: `dominio.cargas_iniciales_stock(id, organizacion_id, producto_id, deposito_id, movimiento_id, cantidad, actor_id, creado_en)` con `unique (organizacion_id, producto_id)` y FK compuestas a `productos`/`depositos`/`movimientos_stock`. Motivo de sistema «Carga inicial de stock» (tipo ajuste) creado por la RPC si falta (dato, no tabla; sin tocar el sembrado de motivos).
- **RPC** (`contracts/`): `validar_carga_stock(p_deposito, p_filas)` solo lee y devuelve el estado de cada fila; `aplicar_carga_inicial_stock(p_deposito, p_filas, p_clave)` revalida, bloquea por producto en orden estable, llama a `registrar_movimiento_stock` por cada diferencia, inserta en `cargas_iniciales_stock`, emite `stock.carga_inicial` y devuelve `{aplicadas, omitidas, detalle}`.
- **Idempotencia**: la clave se guarda en el evento de actividad; reenviar la misma clave devuelve el resultado previo sin mover stock.
- **UI**: `pages/stock/excel.tsx` (lazy) + `lib/cargaStock.ts` (plantilla, lectura y normalización de filas). Tope técnico de **2.000 filas** por planilla (una transacción acotada); se informa en el mensaje de rechazo.
- **Reversión**: `drop function` de las dos RPC y `drop table dominio.cargas_iniciales_stock`; los movimientos de ajuste ya creados son historial inmodificable y no se deshacen (se corrigen con un ajuste).

### F-STK-08 · Exportar CSV

- Sin SQL nuevo. `lib/exportarCsv.ts` (armado + descarga) y un hook `useExportarCsv` que pide por lotes (`TAMANO_LOTE_EXPORTACION`) **la misma consulta** que la pantalla, con los mismos filtros y sin paginar a la página visible. Cada pantalla declara sus columnas (encabezado + valor ya formateado) en un solo arreglo que usan la tabla y la exportación, para que «columnas visibles» no pueda divergir.
- CSV: UTF-8 con BOM, `;`, CRLF; `neutralizarFormula` reutilizada. Tope de **100.000 filas** (igual que el ranking de clientes) con aviso; error sin archivo parcial.

### F-STK-09 · Avisos de reposición

- **Datos**: `dominio.stock_alertas_avisadas(organizacion_id, producto_id, estado_avisado, avisado_en)` y `dominio.stock_avisos_reposicion(id, organizacion_id, generado_en, estado, intentos, ultimo_error, enviado_en, productos jsonb)`.
- **RPC (solo `service_role`)**: `generar_resumen_reposicion(p_organizacion)` calcula los productos nuevos en alerta contra `stock_estados` y `stock_alertas_avisadas`, crea el registro `pendiente` y lo reserva (vencimiento 2 min); `cerrar_resumen_reposicion(p_id, p_enviado, p_error)` al éxito actualiza las marcas (alta/empeora) y limpia las de productos que volvieron a `disponible`.
- **Envío**: Edge Function `enviar-resumen-reposicion` + flow `avisos-reposicion-stock.yml` (diario; hora en el YAML). Contenido: asunto «N productos sin stock y M con stock bajo», lista (Sin stock primero, luego nombre) con tope de **50 productos** por correo + total + enlace a `/stock`.
- **Mecanismo de Plataforma (MSF-189)**: la función resuelve destinatarios y entrega por el contrato de ese mecanismo; hasta que exista en `main` el contrato queda como **dependencia abierta** (ver Riesgos). Variables nuevas solo en `.env.example` (token del barrido).
- **Reversión**: `drop` de las RPC y de las dos tablas; borrar el flow.

### F-STK-17 · Faltantes con aviso

- **Lectura**: vista `public.faltantes_listado` (`security_invoker`): línea de factura confirmada con `a_pedido` y reserva activa (join por `referencia`), con tienda, cliente, producto, cantidad, número de comprobante, fecha de confirmación, estado y disponible de `stock_estados`, y estado del aviso. Se filtra por `private.nivel_ventas_en_empresa(empresa_id) in ('lectura','edicion')`.
- **Avisos**: `dominio.faltantes_avisos(linea_id pk, organizacion_id, empresa_id, cliente_id, estado, intentos, ultimo_error, enviado_en, creado_en)`; `avisar_faltantes(p_lineas uuid[])` valida permiso `edicion` por tienda, omite ya avisadas / sin stock / sin correo y encola; `service_role`: `faltantes_avisos_pendientes`, `tomar_aviso_faltante` (reserva 2 min, cuenta intento, agrupa por cliente), `cerrar_aviso_faltante`. Agotado el tope → se borra la fila para volver a «Sin avisar» conservando el error en `registro_actividad`.
- **Envío**: Edge Function `enviar-aviso-faltante` + flow `avisos-faltantes.yml` (barrido cada minuto, como `avisos-consultas.yml`).
- **UI**: `pages/stock/faltantes.tsx` (tabla con selección, `FiltroEmpresa`, diálogo) + `lib/faltantes.ts`. Reencuadre completo al cambiar de empresa (Principio VIII).
- **Propiedad frente a MSF-135**: sin tabla `faltantes`; si F-VTA-18 la crea después, se reapunta la vista (Decisiones 6).
- **Reversión**: `drop` de vista, RPC y tabla.

### F-STK-18 · Más vendidos

- **RPC** `productos_mas_vendidos(p_desde, p_hasta, p_empresa_id, p_pagina, p_tamano)` (`security definer`, `search_path = ''`): agrega `cantidad` de `comprobantes_venta_lineas` unidas a comprobantes que cuentan como facturados, fecha en el rango, tiendas con `ventas` visible, orden por unidades desc y nombre, paginada (tope 200) con total.
- **UI**: `pages/stock/mas-vendidos.tsx` con `lib/masVendidos.ts` (reutiliza `periodosRanking` y `FiltroEmpresa`). Sin prototipo: componentes del template y anotación en el PR.
- **Reversión**: `drop function`.

## Riesgos

- **MSF-189 no está en `main`**: F-STK-09 depende de su contrato de avisos/destinatarios. Mitigación: la historia se ejecuta al final del plan; si al llegar MSF-189 no existe, la tarea T020 usa los destinatarios que la épica de Plataforma haya definido o queda trazada como deuda de la épica (no se inventa una pantalla de destinatarios acá).
- **Definición de «faltante»** (Decisiones 7): se apoya en `a_pedido` + reserva activa. Si MSF-135 la define distinto, se ajusta solo la vista.
- **Lectura de `.xlsx` en el navegador**: dependencia nueva y planillas grandes; mitigados con carga diferida, tope de 2.000 filas y validación en servidor.
- **Mails a clientes**: sin correo o con datos sucios; se omiten con conteo y nunca bloquean la venta.

## Documentación (obligatoria)

`docs/stock-carga-excel.md`, `docs/stock-exportacion.md`, `docs/stock-avisos-reposicion.md`, `docs/stock-faltantes.md`, `docs/stock-mas-vendidos.md` (una por historia, en el mismo cambio) y los enlaces desde `docs/stock.md`, `docs/roadmap-template.md` y `pnpm docs:check` en el cierre.
