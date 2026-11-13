# Feature Specification: Inicio · Tablero completo (ventas, stock, listado y dólar)

**Épica**: MSF-824 · **Spec**: `inicio-tablero-completo` · **Historias**: F-INI-04 (MSF-820), F-INI-05 (MSF-821), F-INI-06 (MSF-822), F-INI-07 (MSF-823) · **Prioridad**: P1
**Alcance de entrega**: `refine`, `supabase` (sin `superset`, `kestra` ni `workers`: consultas en vivo desde Refine)
**Fuente**: las cuatro historias de la épica (mandan los requisitos), prototipo `design/pantallas/Main.dc.html` y el mapa verificado del código (2026-11-13). Completa lo que la spec base `specs/20261030-100000-inicio-y-alertas/` dejó fuera de alcance (su matriz pantalla↔criterios, filas «Fuera de alcance»).

## Objetivo

Al terminar, el administrador abre Inicio y, sin entrar a Reportes, filtra por período, tienda y depósito, ve ventas y stock del período con su gráfico, qué atender hoy, cómo rinde cada tienda, de qué depósito salió la mercadería, la actividad reciente y un listado de movimientos por producto, y puede cargar el dólar del día viendo el impacto antes de confirmar.

## Modelo y supuestos

- Todo en Refine con consultas en vivo. Las RPC nuevas son `security definer`, `search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`; filtran por la organización de la sesión y por `private.empresas_accesibles()`.
- «Tienda» = `empresa_id` (la UI ya la rotula «Tienda»). Solo **ventas y devoluciones** son por tienda; stock, costos y movimientos son de la organización. El filtro Tienda acota ventas/devoluciones, como dice el prototipo («Entradas, ajustes y stock son compartidos»).
- Venta = `private.comprobante_cuenta_como_facturado(tipo, estado)` con `private.signo_comprobante` (la nota de crédito resta; presupuestos y anuladas no cuentan). **No se reutiliza el cuerpo de `productos_mas_vendidos`** (suma sin signo).
- Permisos por bloque, en la base y en la pantalla: ventas → `ventas` (por empresa activa); stock y salidas por depósito → `stock`; actividad → `actividad`; costo, valor y margen → `rentabilidad` ≥ lectura (la RPC devuelve `null`, no solo se oculta); dólar → `cotizacion_dolar` (edición solo administrador). Un bloque sin permiso no se muestra **ni se consulta** (FR-007 de la spec base).
- Mercado Libre queda oculto mientras no exista la funcionalidad (no hay feature registrada): se omiten sus columnas, tarjetas y filas.
- El repo no tenía librería de gráficos: se agrega **`@mui/x-charts`** (MIT, misma familia que MUI; versión fijada, documentada y con revisión de cadena de suministro). Usa los colores del tema (tokens), con texto alternativo y tabla equivalente accesible.
- Los listados usan **carga infinita** (`CargaInfinita` + `useListadoAcumulado`), nunca paginación (CLAUDE.md, Principio VI).

### Esquema de datos (Principio VII)

| Objeto | Esquema | Historia | Justificación | Acceso |
|---|---|---|---|---|
| `public.resumen_inicio_periodo(p_desde, p_hasta, p_empresa, p_deposito)` (**nueva**, jsonb) | `public` | F-INI-04 | Una sola lectura agregada: ventas con variación, devoluciones, stock, ajustes y serie diaria. Sin tablas nuevas; suma el índice `movimientos_stock_org_fecha_dia_idx`. | `security definer`; `null` en el bloque sin permiso |
| `public.resumen_inicio_bloques(p_desde, p_hasta, p_empresa, p_deposito)` (**nueva**, jsonb) | `public` | F-INI-05 | «Resumen por tienda» y «Salidas por depósito» en una lectura hermana (la historia admite ampliar la anterior o una RPC aparte). | `security definer`; ingresos y margen `null` sin `rentabilidad` |
| «Actividad reciente» | — | F-INI-05 | **Sin RPC nueva**: usa `public.listar_actividad` (ya trae fecha, usuario y tienda; RLS de `actividad`). La `actividad_reciente_inicio` del plan original no se creó. | `security invoker` (existente) |
| `public.movimientos_por_producto(…, p_pagina, p_tamano)` (**nueva**) | `public` | F-INI-06 | Una fila por producto con 12 columnas, orden/filtros en servidor, `total`. | `security definer`; costo/valor `null` sin `rentabilidad` |
| `public.previsualizar_impacto_dolar(p_valor numeric, p_empresa uuid)` (**nueva**, solo lectura) | `public` | F-INI-07 | Vista previa del impacto **sin escribir** la cotización pendiente; reusa `private.precios_usd_por_empresa` y `private.precio_visible_con_cotizacion`. | `security definer`; exige `cotizacion_dolar` = edición |
| `public.aplicar_cotizacion(p_valor, p_empresa, p_variacion_vista)` (**nueva**, jsonb) | `public` | F-INI-07 | Carga y confirma el dólar en **una** transacción (delega en `cargar_cotizacion` y `confirmar_cotizacion`): evita una cotización pendiente huérfana si la confirmación falla. No estaba en el plan original. | `security definer`; los permisos y errores son los de las funciones delegadas |

Sin tablas nuevas: la prueba `rls_en_toda_tabla` no cambia. Migraciones aditivas, versión mayor a `20270304100000` (`20270305105000` a `20270305140000`); reversión = `drop function` de cada RPC y `drop index dominio.movimientos_stock_org_fecha_dia_idx` (sin datos).

## User Scenarios & Testing

### Historia 1 — Filtros, indicadores y gráfico (F-INI-04 · MSF-820)

- **FR-001** Filtros Período (hoy, 7 días, mes, rango), Tienda y Depósito; por defecto: mes en curso, todas las tiendas, todos los depósitos. Se reflejan en la URL.
- **FR-002** Fila «Ventas del período»: monto (con IVA, rotulado), cantidad de comprobantes y ticket promedio, con variación contra el período anterior.
- **FR-003** Fila «Stock hoy»: unidades, productos sin stock y con stock bajo; depende de tienda y depósito, no del período.
- **FR-004** Gráfico «Ventas y stock en el tiempo»: ventas y stock por día del período, legible en modo claro y oscuro.
- **FR-005** Cada indicador enlaza al listado correspondiente ya filtrado.
- **FR-006** Ventas solo con `ventas` ≥ lectura; Mercado Libre solo si la funcionalidad está activa (hoy no).

### Historia 2 — Bloques de gestión (F-INI-05 · MSF-821)

- **FR-007** «Qué hacer hoy»: pendientes ordenados por urgencia con enlace (reusa las reglas de alertas de MSF-361); «Todo al día» si no hay.
- **FR-008** «Resumen por tienda»: una fila por tienda de la organización (sin nombres fijos): unidades, ingresos y margen estimado rotulado como estimado.
- **FR-009** «Salidas por depósito»: unidades que salieron de cada depósito en el período.
- **FR-010** «Actividad reciente»: últimos eventos con fecha, usuario y enlace; sin columna «Cant.» (el registro no la guarda).
- **FR-011** Los cuatro bloques respetan los filtros; margen e ingresos solo con `rentabilidad` ≥ lectura; cada bloque tiene vacío y error con reintento independientes. *Desvío al cierre:* «Resumen por tienda» y «Salidas por depósito» comparten una lectura y fallan juntos (seguimiento MSF-850).

### Historia 3 — Movimientos por producto (F-INI-06 · MSF-822)

- **FR-012** Una fila por producto con 12 columnas ordenables: producto, SKU, categoría, stock inicial, entradas, salidas, ajustes, stock actual, mínimo, ventas, último movimiento, estado.
- **FR-013** Vistas rápidas (Todos, En alerta, Quietos), búsqueda por nombre o SKU, filtro por categoría, «Ordenar por» y dirección, orden por encabezado.
- **FR-014** Respeta Período, Tienda y Depósito; estado con chips (En alerta, Quieto, Normal); abrir el producto.
- **FR-015** «Exportar» CSV por lotes con los filtros aplicados; el rol Consulta no exporta.
- **FR-016** Vacío «Sin movimientos para estos filtros» con «Limpiar filtros» y error con reintento. Costo y margen no se exponen sin permiso.

### Historia 4 — Cargar dólar del día (F-INI-07 · MSF-823)

- **FR-017** El aviso «Todavía no se cargó el dólar de hoy» abre `DialogoCargarDolarConImpacto` (solo con edición de `cotizacion_dolar`), pasando la empresa activa (en «Todas» hay que elegir una). *Desvío al cierre:* no hay acceso directo de dólar en `AccesosDirectos` (la spec base fija tres); el diálogo de Cotización (`DialogoCargarDolar`) no cambia.
- **FR-018** Muestra vigente, valor nuevo y variación %; >15 % advierte y exige confirmación; <1 % informa que no se recalculan precios.
- **FR-019** Tarjeta de impacto por cada tienda activa y vista previa con precio actual y nuevo, **sin guardar** (RPC `previsualizar_impacto_dolar`).
- **FR-020** Al confirmar guarda con fecha y usuario (`aplicar_cotizacion`, atómica) y actualiza el aviso sin recargar; cancelar o valor inválido no guarda nada.

## Decisiones tomadas (a confirmar por Nicolás)

| # | Decisión | Alternativa |
|---|---|---|
| D-1 | «Qué hacer hoy» **no suma** tipos nuevos: reusa los 5 de `alertas_inicio` (no hay migración de alertas) | Sumar cobros pendientes y faltantes (migración) |
| D-2 | Ingresos **con IVA** (`total_con_iva`), rotulado; devoluciones = notas de crédito de las tres clases | Neto sin IVA |
| D-3 | «Entradas» = movimientos `entrada` **sin** traslados, devoluciones de cliente ni anulaciones (esas van en Devoluciones); «Ajustes» = solo `ajuste` | Contarlas todas |
| D-4 | Costo, «Valor del stock» y margen solo con `rentabilidad` ≥ lectura (Administrador y Administración) | Todo rol con `stock` |
| D-5 | Margen estimado = margen **real** de lo vendido (costo guardado en la línea) | Margen de lista |
| D-6 | Gráfico con **MUI X Charts** (`@mui/x-charts`), aprobado por Nicolás el 2026-11-13 | SVG propio, sin dependencia nueva |
| D-7 | Movimientos por producto completo con carga infinita; exportación CSV | Muestra de N; .xlsx |
| D-8 | Período, tienda y depósito viajan en la URL (`?tienda=<uuid>|todas`) para compartir la vista (manda la historia, CA-INI-04-7); sin `tienda` sigue a la empresa activa y el cambio de la barra superior la descarta; períodos de la historia (hoy, 7 días, mes, rango) | Tienda fuera de la URL; 7/30/90 del prototipo |
| D-9 | Vista previa pura `previsualizar_impacto_dolar` (lo pide la historia) y guardado atómico con `aplicar_cotizacion`; sin Mercado Libre en el diálogo | Reusar solo cargar→previsualizar |
| D-10 | «Actividad reciente» sin «Cant.»; refleja solo lo que el registro guarda hoy | Agregar columna al registro |
| D-11 | Con `ventas` solo en algunas empresas, se suman únicamente las tiendas visibles | — |
| D-12 | En la LISTA «Movimientos por producto», entradas, salidas y ajustes cuentan **todos** los movimientos del período (traslados, devoluciones y anulaciones) para que cuadre el stock inicial; los indicadores de «Stock hoy» usan D-3. Con una tienda elegida el LISTADO muestra solo los productos de esa tienda (manda la historia, CA-INI-06-11, sobre D-8) | Excluir traslados y devoluciones también en la lista |

## Reconciliación al cierre

Lo entregado se apartó del plan inicial en estos puntos, todos documentados en `docs/inicio-y-alertas.md` y con su seguimiento en `tasks.md`: (1) no existe `actividad_reciente_inicio` (se usa `listar_actividad`); (2) «Resumen por tienda» y «Salidas por depósito» salen de una RPC hermana, `resumen_inicio_bloques`; (3) se sumó `aplicar_cotizacion` para guardar el dólar de forma atómica; (4) D-8 y D-12: manda la historia (tienda en la URL; listado de movimientos solo con productos de la tienda elegida); (5) la matriz de permisos y los contratos de las cinco RPC están en `docs/inicio-y-alertas.md` y en `specs/20261030-100000-inicio-y-alertas/contracts/inicio-y-alertas.md`; (6) la revisión de seguridad integral está en `docs/seguridad-inicio-tablero.md`.

## Matriz pantalla↔criterios

| Ítem del prototipo | Pantalla | Dueño |
|---|---|---|
| Filtros `Período`, `Tienda`, `Depósito` y texto «Con una tienda elegida…» | Main | FR-001 |
| «Ventas del período» (4 KPI) | Main | FR-002 (unidades, ingresos, devoluciones, ajustes) |
| «Stock hoy» (4 KPI) | Main | FR-003 |
| «Ventas y stock en el tiempo» | Main | FR-004 |
| «Qué hacer hoy» con `···Ver` / `···Abrir` | Main | FR-007 |
| «Resumen por tienda» y botón `Ver rentabilidad` | Main | FR-008 |
| «Salidas por depósito» | Main | FR-009 |
| «Actividad reciente» y botón `Ver todo` | Main | FR-010 |
| «Movimientos por producto», `Stock · Movimientos`, `Exportar`, `Categoría: ·`, vistas rápidas, «Ordenar por», campo `Buscar producto o SKU`, estado «No hay productos que coincidan» | Main | FR-012–FR-016 |
| Aviso «Todavía no se cargó el dólar de hoy» y botón `Cargar ahora` | Main | FR-017 |
| Diálogo «Cargar dólar del día», campo «Dólar del día (pesos por dólar)», tabla `Producto (muestra)`/`Mundo JC hoy`/`Nuevo`/`ML hoy`/`Nuevo`, botón `Cancelar` | Main | FR-018–FR-020 (columnas `ML hoy` y mosaico de Mercado Libre: fuera de alcance, sin la funcionalidad) |
| Botones `Nuevo comprobante`, `Registrar movimiento`, `Nuevo producto` | Main | Ya entregado (spec base FR-002) |
