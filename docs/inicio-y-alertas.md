# Inicio y alertas

Spec base: `specs/20261030-100000-inicio-y-alertas/` (épica MSF-156). Cubre las tres historias de la épica:
la pantalla de inicio (F-INI-01), las alertas accionables (F-INI-02) y la búsqueda global (F-INI-03).
La épica **MSF-824 «Inicio · Tablero completo»** (spec `specs/20270305-100000-inicio-tablero-completo/`) suma
a la misma pantalla el tablero de ventas y stock (F-INI-04), los bloques de gestión (F-INI-05), el listado
«Movimientos por producto» (F-INI-06) y la carga del dólar con impacto (F-INI-07). Las decisiones se numeran
por spec: **«D-n (spec base)»** son las de MSF-156 (D-1 a D-4) y **«D-n (tablero)»** las de MSF-824 (D-1 a D-12,
ver [Decisiones de la épica MSF-824](#decisiones-de-la-épica-msf-824)). Qué ve cada rol, los contratos de las RPC y
los desvíos están en las secciones [Quién ve qué](#quién-ve-qué-por-bloque-y-por-rol),
[Contratos de las RPC](#contratos-de-las-rpc-de-la-épica-msf-824) y [Desvíos y seguimientos](#desvíos-y-seguimientos-de-la-épica-msf-824);
la revisión de seguridad integral está en [`seguridad-inicio-tablero.md`](./seguridad-inicio-tablero.md).

**Alcance (decisión D-3 de la spec base):** Inicio es una **pantalla de Refine con consultas en vivo**, no un
tablero de Superset. Es lo que dice el documento del componente de la épica; la fila del roadmap quedó
alineada con esta decisión (`docs/roadmap-template.md`).

## Pantalla de inicio (F-INI-01, MSF-344)

Ruta canónica `/` (ítem «Inicio» del menú, audiencia: todos los roles de organización). Reemplaza la portada
de servicios del template. Código en `apps/web/src/pages/inicio/`; lecturas en `apps/web/src/lib/inicio.ts`.
F-INI-01 no agrega tablas ni RPC: lee objetos existentes (las RPC del tablero son de F-INI-04 a F-INI-07).

| Elemento | Fuente | Se ve con |
|---|---|---|
| Saludo «Buen día, <nombre>», fecha, subtítulo | `perfiles_usuario` (fila propia) | siempre |
| Accesos `Nuevo comprobante`, `Registrar movimiento`, `Nuevo producto` | — | **edición** en `ventas`, `stock`, `productos` |
| Tus empresas | `empresas_para_selector()` (`empresas_accesibles()`) | siempre (lista vacía = explicación) |
| Stock hoy | `public.stock_estados` (`sin_stock`, `stock_bajo`) | `stock` ≥ lectura |
| Consultas nuevas | `public.consultas_bandeja` (`nueva`, empresa activa) | `consultas` ≥ lectura |
| Dólar | `estado_cotizacion()` + `cotizacion_del_dia()` | `cotizacion_dolar` ≥ lectura; `Cargar ahora` con edición |

- **Permisos**: un elemento sin lectura de su sección no se renderiza ni se consulta; las acciones piden
  edición. La base (RLS / `nivel_seccion`) es la autorización real.
- **Estados**: carga y error («No pudimos cargar este dato») son **por tarjeta**; una falla no tumba el resto.
  Un rol sin ninguna sección ve «Tu rol todavía no tiene secciones habilitadas».
- **Empresa activa** (Principio VIII): al cambiar la de la barra superior, Inicio se remonta y recarga todas
  sus consultas; no queda ningún dato de la anterior. El stock y el dólar son de la organización (no tienen
  empresa); las consultas se acotan a la empresa activa.
- **Decisión D-1 (spec base)**: «estado de las empresas» = nombre de cada empresa accesible y marca de la activa. El
  selector solo devuelve empresas activas, por eso no hay estado «desactivada».
- **Mercado Libre / precios en revisión**: no hay tarjetas hasta que existan esas épicas (FR-009).
- `Registrar movimiento` lleva a Stock, donde está el botón «Nuevo movimiento».

## Tablero de ventas y stock (F-INI-04, MSF-820, épica MSF-824)

Spec: `specs/20270305-100000-inicio-tablero-completo/`. Debajo de las alertas, Inicio suma un **tablero con
consultas en vivo** (Refine, sin Superset) que se monta solo si el rol tiene `ventas` o `stock` ≥ lectura.
Una única lectura, la RPC `public.resumen_inicio_periodo(p_desde, p_hasta, p_empresa, p_deposito)`, devuelve
ventas, stock y la serie diaria; la base devuelve `null` en el bloque que el rol no puede ver y ese bloque no
se muestra.

- **Filtros** (`apps/web/src/pages/inicio/tablero/filtros.ts`): Período (Hoy, 7 días, Este mes o Rango libre;
  por defecto el mes en curso, calculado con el día de Buenos Aires), Tienda y Depósito. Los tres
  viven en la URL (`?periodo=…&desde=…&hasta=…&deposito=<uuid>&tienda=<uuid>|todas`) para compartir la vista
  (CA-INI-04-7). Sin `tienda` el tablero sigue a la empresa activa de la barra superior; con `tienda` manda
  la URL (si es una empresa accesible; si no, se ignora) y un cambio de la empresa activa en la barra superior
  la descarta (Principio VIII: el cambio de arriba siempre gana). Un depósito de la URL que no existe en la
  organización cae a «Todos los depósitos». Un rango inválido se avisa en el campo y no se consulta; el
  máximo es de 366 días. «Todas las tiendas» deja afuera las empresas desactivadas (no son accesibles).
- **«Ventas del período»**: ventas con IVA (rotuladas), comprobantes, ticket promedio, unidades vendidas netas
  de devoluciones y devoluciones, con la variación contra el período anterior de igual largo (sin período
  anterior no se inventa una variación). La nota de crédito resta; presupuestos y comprobantes anulados no
  cuentan. **No se muestra costo ni margen** en este bloque.
- **«Stock hoy»**: unidades, reservado, disponible, productos sin stock y con stock bajo, y ajustes del período
  (cantidad de movimientos de tipo ajuste; el detalle muestra además las unidades que **entraron**, sin traslados,
  devoluciones de cliente ni anulaciones de factura, D-3 del tablero). El stock depende del depósito, no del período
  ni de la tienda. Definiciones exactas en [Definiciones de los indicadores](#definiciones-de-los-indicadores).
- **Gráfico «Ventas y stock en el tiempo»**: barras de unidades vendidas y línea del stock al cierre de cada
  día con doble eje (`@mui/x-charts`, colores del tema), con descripción accesible y la misma información en
  una tabla («Ver los datos como tabla»). Cada serie aparece solo si el bloque correspondiente se ve.
- **Enlaces (FR-005)**: las ventas llevan a Reportes de ventas con el período ya elegido
  (`/ventas/reportes?desde=…&hasta=…`) **solo si el rol tiene la sección `reportes`** (muchos roles con `ventas`
  no la tienen: sin ella el indicador no enlaza); «Sin stock» y «Stock bajo» llevan a Stock ya filtrado
  (`/stock?filtro=sin_stock|stock_bajo&deposito=<id>`). Reportes de ventas y la lista de Stock leen esos
  parámetros al abrir. Desvíos: (1) los indicadores de stock sin filtro propio y «Ajustes de stock» llevan a la
  pantalla sin filtrar (`/stock`, `/stock/movimientos`); (2) Reportes de ventas sigue a la empresa activa, no
  admite una tienda por URL ni tiene filtro de depósito, así que el enlace lleva solo el período (las cifras
  pueden diferir si el tablero usa otra tienda); (3) con depósito, «Sin stock»/«Stock bajo» del tablero se
  calculan por depósito y solo con productos activos, mientras la lista de Stock filtra por el estado global
  (`stock_estados`): el número del indicador y el listado pueden no coincidir.
- **Modo oscuro (RF-INI-04-7)**: el tema del panel no tiene esquema oscuro, así que hoy no hay modo oscuro que
  verificar; el gráfico usa los colores del tema y lo hereda cuando exista. Desvío trazado en MSF-849.
- **Estados**: carga, error («No pudimos cargar este dato») con «Reintentar» y vacío; mientras llegan los datos
  de otros filtros no se muestran los anteriores ni un error previo. El ticket promedio también se compara con
  el del período anterior. El gráfico queda vacío («Sin datos en el período») si no hubo ventas en ningún día
  (un rol que solo ve stock ve la línea de stock) y se carga diferido (`React.lazy`) para no pesar en el
  arranque de Inicio.

### Dependencia nueva: `@mui/x-charts` (revisión de cadena de suministro)

Aprobada por Nicolás el 2026-11-13 (D-6 del tablero). Se fija la versión **exacta `8.29.3`** (publicada el
2026-08-21): licencia **MIT** (el paquete base de gráficos; no se usa la edición Pro/Premium), mismo mantenedor y
familia que `@mui/material` (peer `^5.15.14 || ^6 || ^7`, compatible con el MUI 6 del panel) y sin scripts de
instalación propios. Dependencias directas: `@mui/x-internals`, `@mui/x-internal-gestures`, `@mui/x-charts-vendor`
(`MIT AND ISC`; trae 10 paquetes `d3-*` —array, color, format, interpolate, path, scale, shape, time, time-format,
timer, todos ISC—, `flatqueue` e `internmap` (ISC) y 10 `@types/d3-*`) y, del propio `x-charts`, `bezier-easing`
(MIT, **de un tercero**, no del mantenedor de MUI), `reselect`, `use-sync-external-store`, `clsx`, `prop-types` y
`@mui/utils`. No hay paquetes Pro/Premium ni de licencia (`x-license`) en el lockfile. Verificado el 2026-11-13
contra el registro de npm: ninguno de estos paquetes declara `install`, `preinstall` ni `postinstall`, y `pnpm audit
--prod` no marca ningún aviso sobre esta cadena (ver [`seguridad-inicio-tablero.md`](./seguridad-inicio-tablero.md)).

**Excepción de antigüedad y override.** Al incorporarlo, los 10 `d3-*` se resolvían a versiones publicadas el
2026-11-03 (menos de 2 semanas, regla de la revisión de cadena de suministro). Se descartaron (comparación de
`d3-array` 3.2.4→3.2.5 y `d3-color` 3.1.0→3.1.1: solo cambia el empaquetado, `src` pasa a `dist/*.mjs`, sin
`fetch`, `child_process` ni `eval`; con provenance SLSA de GitHub Actions) y se **fijaron a la versión
inmediata anterior** con `overrides` en `pnpm-workspace.yaml` (d3-array 3.2.4, d3-color 3.1.0, d3-format
3.1.2, d3-interpolate 3.0.1, d3-path 3.1.0, d3-scale 4.0.2, d3-shape 3.2.0, d3-time 3.1.0, d3-time-format
4.1.0, d3-timer 3.0.1), que cumplen los rangos de `x-charts-vendor` y tienen meses o años de antigüedad. Se
puede quitar el bloque desde el 2026-11-17 y re-resolver el lockfile. El `pnpm-lock.yaml` deja las
integridades fijadas y pasa la política de cadena de suministro de pnpm. El gráfico se carga con `lazy`: el
paquete no entra en el chunk inicial de Inicio.

## Bloques de gestión (F-INI-05, MSF-821, épica MSF-824)

Debajo del tablero, Inicio suma cuatro bloques que **respetan los filtros** Período, Tienda y Depósito
(`apps/web/src/pages/inicio/tablero/BloquesGestion.tsx`). Cada uno tiene carga, vacío y error con
**reintento propio**; un bloque sin permiso ni se muestra ni se consulta.

| Bloque | Fuente | Quién lo ve |
|---|---|---|
| «Qué hacer hoy» | `alertas_inicio_visibles` (MSF-361, ya existente: ordenado por urgencia, con enlace; sin alertas dice «Todo al día») | cada alerta, según su sección de origen |
| «Resumen por tienda» | RPC `public.resumen_inicio_bloques` | `ventas` ≥ lectura; **ingresos y margen estimado solo con `rentabilidad` ≥ lectura** (la base los devuelve `null`) |
| «Salidas por depósito» | `public.resumen_inicio_bloques` | `stock` ≥ lectura |
| «Actividad reciente» | `public.listar_actividad` (sin RPC nueva) | `actividad` ≥ lectura |

- **Una fila por tienda activa**, sin nombres fijos: una tienda nueva aparece sola; una sin ventas queda con ceros.
  Unidades netas de devoluciones; ingresos **con IVA**. Mercado Libre no se muestra (no hay funcionalidad activa).
- **Margen estimado** = margen real de lo vendido con el costo guardado en cada línea al confirmar; las ventas sin
  costo guardado quedan fuera («sin costo cargado»). Es una estimación: el costo es el de la confirmación.
- **Salidas por depósito**: unidades de movimientos de tipo salida del período, sin traslados, y el stock actual de
  cada depósito activo.
- **Actividad reciente**: los últimos 10 eventos del período y de la tienda elegida, con fecha, usuario y enlace
  (cada fila y «Ver todo» llevan a Actividad). No lleva depósito (el registro no lo guarda) ni columna «Cant.»
  (el registro guarda un texto de detalle, no una cantidad).
- «Resumen por tienda» y «Salidas por depósito» salen de la **misma lectura**: si falla, fallan los dos con su
  propio reintento; la actividad es independiente. **Desvío** de RF-INI-05-7 / CA-INI-05-8 (error independiente por
  bloque): seguimiento en **MSF-850**.
- Si la base devuelve `null` en un bloque (por ejemplo, una tienda donde el rol no tiene `ventas`), el bloque dice
  «No tenés ventas habilitadas en esta tienda» (o «No tenés Stock habilitado») en vez de quedar en blanco. Una tienda
  sin ventas dice «Sin ventas en el período»; «sin costo cargado» queda para una tienda con ventas sin costo guardado.
- **Quién ve el tablero**: con `ventas` o `stock` ≥ lectura se ve todo el tablero; un rol con **solo `actividad`**
  ≥ lectura ve únicamente «Actividad reciente» (no se consulta el resumen de ventas y stock).
- **Actividad reciente no se filtra por depósito** (el registro no lo guarda): con un depósito elegido la tarjeta lo
  avisa y muestra la actividad de toda la organización.
- **Enlace «Ver»**: lleva a Actividad (`/actividad`). No hay una ruta de detalle por evento: el detalle es un
  diálogo dentro de ese listado (F-AUD-02); por eso la fila no apunta a un detalle propio.

## Movimientos por producto (F-INI-06, MSF-822, épica MSF-824)

Al pie de Inicio, un listado de **una fila por producto activo** con 12 columnas ordenables: producto, SKU,
categoría, stock inicial, entradas, salidas, ajustes, stock actual, mínimo, ventas, último movimiento y estado
(`apps/web/src/pages/inicio/tablero/MovimientosPorProducto.tsx`, RPC `public.movimientos_por_producto`). Lo ve quien
tiene `stock` ≥ lectura; la columna **Ventas** solo con `ventas` (si no, la base la devuelve `null` y no se dibuja).

- **Vistas rápidas** (Todos, En alerta, Quietos), búsqueda por nombre o SKU (espera 300 ms), categoría (el menú
  muestra solo las de la tienda elegida), «Ordenar por» con dirección y orden por encabezado. **Todo se resuelve en
  el servidor**; el orden va por lista blanca, nunca como texto libre.
- **Carga infinita** (`CargaInfinita` + `useListadoAcumulado`): tandas de 25 que conservan filtros y orden; muestra
  «Mostrando N de M productos». En pantallas angostas cada fila es una tarjeta.
- **Estado**: «En alerta» (disponible ≤ mínimo, incluye sin stock) tiene prioridad sobre «Quieto» (sin movimientos
  en el período); el resto es «Normal». Vacío «Sin movimientos para estos filtros» con «Limpiar filtros».
  - La vista **«Quietos»** filtra por «sin movimientos en el período», así que **incluye productos con el chip «En
    alerta»** (la alerta tiene prioridad en el chip, no en el filtro). Ordenar por «Estado» ordena por severidad
    (alerta, quieto, normal).
  - Con un **depósito** elegido, «alerta» compara el disponible **de ese depósito** contra el mínimo **global** del
    producto (el mínimo no es por depósito).
  - Con una **tienda** elegida el listado muestra **solo los productos de esa tienda** (`producto_empresa`, CA-INI-06-11:
    para esta historia manda la historia sobre la decisión D-8 de la spec); las ventas son las de esa tienda.
  - La paginación por offset puede **repetir un producto entre tandas** si el stock cambia mientras se carga más; la
    pantalla lo muestra una sola vez. Búsqueda de hasta 100 caracteres.
- **Cuadre**: en la lista, entradas, salidas y ajustes cuentan **todos** los movimientos del período (traslados,
  devoluciones y anulaciones incluidos) para que `stock inicial + entradas − salidas + ajustes = stock actual`
  cuando el período llega hasta hoy (decisión D-12). Los indicadores de «Stock hoy» excluyen traslados,
  devoluciones y anulaciones de las entradas (D-3); por eso los dos números pueden diferir.
- **Exportar** baja a CSV por lotes de 100 lo mismo que se ve (mismos filtros), con tope de filas; el botón solo lo
  ve quien puede exportar Stock. El archivo es `movimientos-por-producto-AAAA-MM-DD.csv`.
- **No expone costo ni margen**: ninguna de las 12 columnas los trae.

## Cargar dólar del día desde Inicio (F-INI-07, MSF-823, épica MSF-824)

La tarjeta «Dólar» muestra el aviso «Todavía no se cargó el dólar de hoy» con **Cargar ahora** solo a quien tiene **edición** en «Cotización del dólar» (con la matriz inicial: Administrador y Administración; el Operador y los demás roles con lectura no ven ni el aviso ni el botón). El botón abre `DialogoCargarDolarConImpacto`:

- **Vista previa antes de guardar.** Mientras se escribe el valor (con una espera corta de 400 ms) se pide `public.previsualizar_impacto_dolar(valor, empresa)`, una RPC de **solo lectura**: no deja una cotización pendiente. Cancelar o cerrar no guarda nada. El diálogo de Cotización (`DialogoCargarDolar`) mantiene su flujo de siempre (cargar → vista previa → confirmar); solo comparte con el de Inicio el campo del valor (`CampoDolar`) y el aviso de variación inusual (`AlertaVariacionInusual`), de modo que **también allí** un valor negativo ya no se corrige en silencio: muestra el mensaje de formato.
- **Qué se ve.** La cotización vigente, la variación contra ella (chip), una tarjeta de impacto por cada tienda activa de la organización (sin nombres fijos: una tienda nueva suma su tarjeta) y la tabla de muestra con precio de hoy y nuevo. Sin Mercado Libre.
- **Umbrales** (los configurados en la base): menos del umbral (1 %) solo registra y lo informa; más de la variación inusual (15 %) advierte y exige tildar «Revisé el valor…» antes de aplicar.
- **Guardar, atómico.** Recién al confirmar se llama a `public.aplicar_cotizacion(valor, empresa, variación vista)`, que **carga y confirma en una sola transacción** (delega en `cargar_cotizacion` y `confirmar_cotizacion`, con sus mismas validaciones, permisos y errores; fecha y usuario quedan en el historial). Si algo falla no queda ninguna cotización pendiente: ya no hay paso intermedio que descartar. Doble clic en «Aplicar» guarda una sola vez. El aviso se actualiza sin recargar la página y muestra el resultado («Cotización aplicada · N precios recalculados» o «registrada»); el foco pasa a ese aviso porque el botón «Cargar ahora» desaparece.
- **Si el dólar cambió mientras se revisaba** (la variación real ya no es la que se vio), la base rechaza, el diálogo recalcula el impacto y **el tilde «Revisé el valor…» se desmarca**: hay que revisar de nuevo.
- **Corregir.** Ya cargado hoy, quien tiene edición en «Cotización del dólar» ve «Corregir cotización» en la tarjeta: abre el mismo diálogo e indica «Ya se cargó hoy: esto reemplaza la cotización».
- **Reemplaza una pendiente ajena.** `aplicar_cotizacion` carga y confirma sobre la cotización pendiente de la organización o empresa: si otra persona había dejado una cargada desde la pantalla Cotización, se **reemplaza** (consistente con «Ya se cargó hoy: esto reemplaza la cotización»; es el comportamiento de `cargar_cotizacion`).
- **Una por empresa.** Con ese alcance la carga es de la empresa activa de la barra superior; en «Todas mis empresas» el botón queda deshabilitado hasta elegir una.
- **Valores inválidos.** El campo admite dígitos, punto, coma y «-»: un negativo **no se corrige en silencio**, se rechaza con el mensaje de formato; cero o vacío tampoco piden vista previa ni dejan guardar. La base valida además NaN, infinito, más de 4 decimales y valores ≥ 1e10 (error 22023 en la vista previa, con las mismas reglas que la carga; `cargar_cotizacion` responde esos casos con 23514 o 22003).
- **Costo de la vista previa.** Cada pausa de 400 ms al tipear es una llamada a la base (la parte que no depende del valor se recalcula). Para no pedir valores a medio escribir («1», «14», «149»…) un valor que se aleja **más de 10 veces** de la cotización vigente no pide vista previa y no se puede aplicar (avisa que puede ser un error de tipeo). Mientras llega el impacto del valor nuevo se deja el anterior atenuado (sin parpadeo del esqueleto) y no se habilita guardar.
- **Estados.** Sin productos en dólares: «No hay precios en dólares para mostrar.»; una tienda sin precios en dólares figura «Sin cambios». Si el diálogo (que se baja con `lazy`) no carga, un límite de errores avisa en la tarjeta sin romper Inicio.
- **Desvíos.** (1) No hay un acceso directo de dólar en `AccesosDirectos` (la spec base fija tres): el acceso es el aviso y su botón. (2) La lista «Qué hacer hoy» (`AlertasInicio`, MSF-344) sigue mostrando la alerta `dolar_sin_cargar` a quien solo tiene lectura: es comportamiento previo, **decisión de Nicolás** si debe ocultarse (el CA-INI-07-7 habla del botón y el aviso de carga).

## Definiciones de los indicadores

Todas salen de la base (las RPC de abajo); el período es de fechas de calendario de Buenos Aires y los dos extremos
entran. «Venta» es todo comprobante que `private.comprobante_cuenta_como_facturado(tipo, estado)` acepta (no cuentan
presupuestos ni comprobantes anulados) con el signo de `private.signo_comprobante` (la nota de crédito resta).

| Indicador | Definición | Notas |
|---|---|---|
| **Ventas (con IVA)** | Σ signo × `total_con_iva` de los comprobantes del período, ya neta de notas de crédito | **Con IVA** (D-2 del tablero), rotulado así en pantalla. Con un depósito elegido suma las **líneas** de ese depósito (`subtotal_sin_iva + iva`) y las notas de crédito de importe o descuento (sin líneas) no entran |
| **Comprobantes** | Cantidad de **facturas** del período (`tipo = 'factura'`) | Las notas de crédito no suman como comprobante (sí restan del monto) |
| **Ticket promedio (con IVA)** | Ventas ÷ comprobantes, redondeado a 2 decimales; «—» sin comprobantes | Se compara con el del período anterior |
| **Unidades vendidas** | Σ signo × cantidad de las líneas | **Netas de devoluciones** |
| **Devoluciones (con IVA)** | Σ de los importes de las notas de crédito del período, en positivo, y sus unidades | «Devoluciones» = notas de crédito de las tres clases (D-2) |
| **Variación vs período anterior** | (actual − anterior) ÷ \|anterior\|; el período anterior tiene **igual largo** y termina el día previo al «Desde» | Se calcula en pantalla; si el anterior es cero no se inventa una variación. Con Período «Hoy» el anterior es ayer |
| **Stock actual / Reservado / Disponible** | Existencias de los productos **activos**; con depósito, las de ese depósito. Disponible = stock − reservado | No dependen del período ni de la tienda |
| **Sin stock / Stock bajo** (indicadores) | Sin stock: disponible ≤ 0. Stock bajo: 0 < disponible ≤ mínimo | Con depósito: disponible del depósito contra el mínimo global del producto |
| **Ajustes de stock** (indicador) | **Cantidad de movimientos** de tipo ajuste del período (no unidades) | El detalle suma las **entradas**: unidades de movimientos `entrada` sin traslados ni los motivos «devolución de cliente» y «anulación de factura» (D-3) |
| **Stock al cierre del día** (gráfico) | Stock de hoy menos lo movido después de ese día | Solo productos activos, igual que el indicador |
| **Ingresos (con IVA)** por tienda | Σ signo × `total_con_iva` de la tienda (con depósito, de sus líneas) | Solo con `rentabilidad` ≥ lectura |
| **Margen estimado** | Σ signo × (subtotal sin IVA − cantidad × costo guardado en la línea) ÷ Σ signo × subtotal sin IVA, **solo de las líneas con costo guardado**; «sin costo cargado» si no hay ninguna | Estimación: el costo es el de la confirmación del comprobante (D-5). Solo con `rentabilidad` ≥ lectura |
| **Salidas por depósito** | Unidades de movimientos `salida` del período, sin traslados, por depósito activo, y su stock actual | Con un depósito elegido, solo ese depósito |
| **Movimientos por producto** | Stock inicial = stock actual − Σ diferencias **desde** el inicio del período; entradas, salidas (en positivo) y ajustes (con signo) de **todos** los movimientos del período, traslados, devoluciones y anulaciones incluidos (D-12) | Cuadra `inicial + entradas − salidas + ajustes = actual` cuando el período llega hasta hoy; por eso difiere de las «entradas» de «Stock hoy». Estado: alerta (disponible ≤ mínimo) > quieto (sin movimientos en el período) > normal |

## Quién ve qué por bloque y por rol

La pantalla oculta (y **no consulta**) un bloque sin permiso; la autorización real es de la base, que devuelve `null`
en el bloque o rechaza con `42501`. La sección que decide cada bloque y cómo se evalúa:

| Bloque | Sección | Cómo se evalúa el nivel |
|---|---|---|
| Ventas del período, «Resumen por tienda» (unidades), gráfico de ventas, columna **Ventas** del listado | `ventas` ≥ lectura | **Por tienda** (`private.nivel_ventas_en_empresa`): solo suman las tiendas accesibles donde el rol tiene `ventas` (D-11). Sin ninguna, el bloque vuelve `null` |
| Ingresos y margen estimado de «Resumen por tienda» | `rentabilidad` ≥ lectura | Rol de la organización **y rol del usuario en cada tienda** (`private.nivel_de_rol` con `rol_en_empresa`; el superadmin con organización activa conserva el acceso): en una tienda donde su rol no tiene `rentabilidad`, la base devuelve `null` en esos dos campos aunque la tenga en otra tienda (migración `20270305150000`) |
| Stock hoy, gráfico de stock, «Salidas por depósito», «Movimientos por producto» | `stock` ≥ lectura | Mejor rol del usuario entre sus tiendas (sección compartida) |
| «Actividad reciente» | `actividad` ≥ lectura | Rol de la organización; la RLS de `registro_actividad` filtra por tienda |
| Enlace de «Ventas» a Reportes | `reportes` ≥ lectura | Rol en la tienda activa (sección por tienda) |
| Botón «Exportar» de Movimientos por producto | acción `exportar` de `stock` | Control de interfaz (`usePuedeAccion`); los datos los autoriza `stock` ≥ lectura |
| Tarjeta «Dólar»; aviso, «Cargar ahora» y «Corregir» | `cotizacion_dolar` ≥ lectura; **edición** para cargar | La RPC de vista previa y la de aplicar exigen edición (`42501` si no) |
| «Qué hacer hoy» | la sección de origen de cada alerta | Sin cambios de MSF-361 |

Con la **matriz inicial** de permisos (`private.matriz_inicial()`; cada organización puede editarla desde Usuarios y
permisos, así que lo de abajo es el valor de fábrica, no una garantía):

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

Un rol con **solo `actividad`** ve únicamente «Actividad reciente»; un rol sin ninguna de las tres (`ventas`, `stock`,
`actividad`) no ve el tablero. Los roles con `ventas` pero sin `reportes` (todos salvo Administrador y Administración)
ven el **monto total con IVA, el ticket promedio y las devoluciones** de las tiendas donde tienen `ventas`, pero no
los ingresos por tienda ni el margen: es lo que fija FR-006 de la spec (ventas se gatea por `ventas`). Ver el
hallazgo H-2 de la revisión de seguridad, que lo deja como decisión de Nicolás.

## Contratos de las RPC de la épica MSF-824

Cinco funciones nuevas en `public`, todas `security definer`, `set search_path = ''`, `revoke execute … from public,
anon` y `grant execute … to authenticated`; **ninguna tabla nueva**. La organización sale de la sesión
(`private.organizacion_id()`), nunca de un parámetro. Reversión de cada una: `drop function`. El detalle de firma y
errores está también en `specs/20261030-100000-inicio-y-alertas/contracts/inicio-y-alertas.md`.

| Función (migración) | Historia | Devuelve | Errores |
|---|---|---|---|
| `resumen_inicio_periodo(p_desde date, p_hasta date, p_empresa uuid = null, p_deposito uuid = null)` (`20270305105000`) | F-INI-04 | `jsonb` `{ desde, hasta, anterior_desde, anterior_hasta, ventas \| null, stock \| null, serie[] }` | `42501` sin organización; `22023` rango inválido o de más de 366 días |
| `resumen_inicio_bloques(p_desde, p_hasta, p_empresa = null, p_deposito = null)` (`20270305110000`) | F-INI-05 | `jsonb` `{ por_tienda \| null, salidas_por_deposito \| null }` | igual que la anterior |
| `movimientos_por_producto(p_desde, p_hasta, p_empresa, p_deposito, p_busqueda, p_categoria, p_vista, p_orden, p_direccion, p_pagina, p_tamano)` (`20270305120000`) | F-INI-06 | tabla de 14 columnas (las 12 visibles más `producto_id` y `total`): `producto_id`, las 12 del listado y `total` (cuántas filas tiene el filtro, repetido en cada fila) | `42501` sin `stock`; `22023` rango, vista, orden o dirección inválidos |
| `previsualizar_impacto_dolar(p_valor numeric, p_empresa uuid = null)` (`20270305130000`) | F-INI-07 | `jsonb` `{ variacion_pct, recalcula, empresas[], muestra[], umbral_pct, confirmacion_pct, redondeo_pesos }`; **no escribe** | `42501` sin edición de `cotizacion_dolar`; `22023` valor nulo, ≤ 0, NaN, infinito, con más de 4 decimales o ≥ 1e10 |
| `aplicar_cotizacion(p_valor numeric, p_empresa uuid = null, p_variacion_vista numeric = null)` (`20270305140000`) | F-INI-07 | el `jsonb` de `confirmar_cotizacion` `{ id, recalculo_aplicado, precios_recalculados }` | los de `cargar_cotizacion` (`42501`, `23514`) y `confirmar_cotizacion` (`22023` con `variacion_inusual` o `variacion_cambio`); carga y confirma en **una** transacción |

**Migración de correcciones `20270305150000`** (PR #909, hallazgos de la revisión final): redefine con `create or replace` `resumen_inicio_periodo`,
`resumen_inicio_bloques`, `movimientos_por_producto` y `aplicar_cotizacion` (mismas firmas y mismos grants) y agrega el índice
`movimientos_stock_org_producto_fecha_idx (organizacion_id, producto_id, fecha desc)`. Cambios de comportamiento:
las tres RPC de lectura rechazan fechas infinitas con 22023; `movimientos_por_producto` calcula `ultimo_movimiento` después del orden y el límite (hasta la página
pedida, es decir offset + límite, y no para todo el listado; salvo que se ordene por esa columna); `resumen_inicio_bloques` evalúa `rentabilidad` con el rol del usuario en cada tienda; y
`aplicar_cotizacion` toma primero el advisory lock de la organización (sin deadlock con confirmar o descartar). Detalle en
[`seguridad-inicio-tablero.md`](./seguridad-inicio-tablero.md).


- **Forma `null` por permiso**: `ventas` (de `resumen_inicio_periodo`), `por_tienda`, `salidas_por_deposito`, `ingresos`,
  `margen_pct` y la columna `ventas` de `movimientos_por_producto` vuelven `null` cuando el rol no tiene el permiso;
  la pantalla distingue «sin permiso» de «cero».
- **`por_tienda` solo es `null` sin `ventas`**: con `ventas` (aunque sea en una sola tienda) y sin `rentabilidad` el bloque
  sigue siendo un arreglo con la fila de la tienda y solo `ingresos` y `margen_pct` vienen `null`; la tienda no desaparece.
  Con el filtro de tienda, el `null` corresponde al filtro aplicado (la tienda elegida sin `ventas`), no a la organización
  entera. Lo fija el pgTAP `supabase/tests/database/inicio_tablero_bloques.test.sql`.
- **Filtros ajenos**: un depósito que no es de la organización devuelve bloques `null`, listas vacías o cero filas (sin error); una
  tienda no accesible no amplía el alcance de las **ventas** (ver H-1 de la revisión de seguridad para el listado).
- **Topes**: período de hasta **366 días**; `movimientos_por_producto` acota `p_tamano` a 1–100, `p_pagina` a 1–100000 y
  la búsqueda a 100 caracteres; orden y dirección van por **lista blanca**.
- **Índice nuevo** `dominio.movimientos_stock_org_fecha_dia_idx (organizacion_id, fecha) include (diferencia, deposito_id,
  producto_id, tipo)`, en la migración `20270305105000`: el índice previo de esa tabla es por `creado_en`, no por `fecha`.
  Reversión: `drop index dominio.movimientos_stock_org_fecha_dia_idx`.
- Sin RPC nueva para «Actividad reciente» (usa `public.listar_actividad`, `security invoker`) ni para «Qué hacer hoy»
  (`alertas_inicio_visibles`).

## Decisiones de la épica MSF-824

Numeradas **D-1 a D-12 de la spec del tablero** (no confundir con D-1 a D-4 de la spec base). Salvo D-6, quedan
**a confirmar por Nicolás** (así lo declara la spec); D-8 y D-12 se apartan de lo que dice la spec cuando la historia manda.

| # | Decisión | Dónde se ve |
|---|---|---|
| D-1 | «Qué hacer hoy» reusa los cinco tipos de `alertas_inicio`; no hay migración de alertas | Bloque «Qué hacer hoy» |
| D-2 | Ingresos **con IVA** (`total_con_iva`), rotulado; devoluciones = notas de crédito de las tres clases | Ventas del período |
| D-3 | «Entradas» de **Stock hoy** = movimientos `entrada` sin traslados, devoluciones de cliente ni anulaciones; «Ajustes» = solo `ajuste` | Stock hoy |
| D-4 | Costo, valor y margen solo con `rentabilidad` ≥ lectura (Administrador y Administración) | Resumen por tienda |
| D-5 | Margen estimado = margen **real** con el costo guardado en la línea (la historia dice «costo vigente»; manda la historia si Nicolás lo pide) | Resumen por tienda |
| D-6 | Gráfico con `@mui/x-charts` — **aprobada por Nicolás el 2026-11-13** | Gráfico |
| D-7 | «Movimientos por producto» completo, con carga infinita y exportación CSV | Movimientos por producto |
| D-8 | Período, tienda y depósito viajan en la URL; sin `tienda` sigue a la empresa activa y su cambio la descarta; períodos hoy, 7 días, mes y rango | Filtros |
| D-9 | Vista previa pura `previsualizar_impacto_dolar`; sin Mercado Libre en el diálogo | Dólar |
| D-10 | «Actividad reciente» sin «Cant.»; muestra lo que el registro guarda hoy | Actividad reciente |
| D-11 | Con `ventas` solo en algunas tiendas, se suman únicamente las visibles | Ventas, resumen, listado |
| D-12 | En la **lista** de movimientos, entradas/salidas/ajustes cuentan todos los movimientos para que cuadre; con una tienda elegida el listado muestra solo sus productos (manda CA-INI-06-11 sobre D-8) | Movimientos por producto |

## Desvíos y seguimientos de la épica MSF-824

| Desvío | Seguimiento |
|---|---|
| El tema del panel no tiene modo oscuro: no hay modo oscuro que verificar en el gráfico (RF-INI-04-7) | **MSF-849** |
| «Resumen por tienda» y «Salidas por depósito» comparten una lectura: si falla, fallan juntos (RF-INI-05-7 / CA-INI-05-8 pide error independiente por bloque) | **MSF-850** |
| Sin E2E de Playwright de los bloques, el listado y el diálogo del dólar: no se pudo correr Supabase local en las sesiones de desarrollo | **MSF-851** |
| Los indicadores de stock sin filtro propio y «Ajustes de stock» enlazan sin filtrar; el enlace a Reportes lleva solo el período (Reportes no admite tienda ni depósito) | Documentado arriba (Enlaces); sin seguimiento: es alcance de esas pantallas |
| Sin acceso directo del dólar en `AccesosDirectos` (la spec base fija tres): el acceso es el aviso y su botón | Documentado en F-INI-07 |
| `AlertasInicio` sigue mostrando la alerta `dolar_sin_cargar` a quien solo tiene lectura (comportamiento previo de MSF-344) | Decisión de Nicolás (CA-INI-07-7) |
| ~~Rentabilidad se evalúa por organización y ventas por tienda~~ | **Resuelto** en el PR #909 (migración `20270305150000`): ingresos y margen se evalúan con el rol del usuario en cada tienda (H-3 = S-4 de la revisión de seguridad) |
| **Falta el manual de usuario de Inicio con sus capturas**: los manuales viven en la rama `main` y se publican aparte | Anotado en `tasks.md` (cierre) y en el PR; no se toca desde esta rama |

## Alertas accionables (F-INI-02, MSF-361)

Tarjeta «Qué hacer hoy» en Inicio (`pages/inicio/AlertasInicio.tsx`, ancho completo). Muestra las alertas
que la base calcula cada 15 minutos; cada una enlaza a la pantalla donde se resuelve.

### Tipos y origen (FR-021)

| Tipo | Qué cuenta | Alcance | Sección | Enlace |
|---|---|---|---|---|
| `sin_stock` | productos activos sin stock disponible (`stock_estados`) | organización | `stock` | `/stock` |
| `stock_bajo` | productos activos bajo el mínimo | organización | `stock` | `/stock` |
| `consultas_sin_atender` | consultas en estado `nueva` | por empresa | `consultas` | `/consultas` |
| `dolar_sin_cargar` | no hay carga confirmada hoy (hora de Buenos Aires) | organización | `cotizacion_dolar` | `/cotizacion` |
| `margen_negativo` | productos con margen negativo (`analitica.margen_producto_canal`, solo si la vista existe) | por empresa | `rentabilidad` | `/rentabilidad/productos` |

Las alertas de **Mercado Libre / precios en revisión no existen** (FR-027): el `check` de `tipo` no las admite,
el cálculo no las genera y la pantalla ignora cualquier tipo que no esté en su lista cerrada. Se agregan
cuando lo habiliten las épicas de Mercado Libre.

### Objetos de base (todo aditivo)

| Objeto | Esquema | Para qué | Reversión |
|---|---|---|---|
| `dominio.alertas_inicio` | `dominio` (dato del producto) | una fila por alerta, RLS por organización + sección ≥ lectura + empresa accesible; sin escritura desde la app | `drop table` (migración posterior) |
| `dominio.alertas_inicio_calculos` | `dominio` | último cálculo por organización (fecha y cantidad); la app solo lee `calculada_en` | `drop table` |
| `public.recalcular_alertas_inicio(uuid)` | `public` | reemplaza el conjunto de la organización bajo `pg_advisory_xact_lock`; solo `service_role` | `drop function` |
| `public.alertas_inicio_visibles` | `public` | vista `security_invoker` que lee la app | `drop view` |
| `public.alertas_inicio_calculo` | `public` | fecha del último cálculo (base del aviso de demora) | `drop view` |

Migraciones `20270121120000`, `20270121121100`, `20270121121200`. El enlace sale de una lista cerrada
(`check` en la tabla y mapa fijo por tipo en el cliente), nunca de texto libre (FR-025).

### Recálculo (FR-022)

Flow de Kestra `infra/kestra/flows/alertas-inicio.yml` (cada 15 minutos, D-2) → Edge Function
`recalcular-alertas-inicio` (`POST {"barrer": true}` con `x-aviso-token`) → `recalcular_alertas_inicio` por
organización. Es idempotente: correrlo dos veces deja el mismo conjunto. Si una organización falla, la función
sigue con las demás y responde 502 para que Kestra reintente. Cada cálculo queda en
`dominio.alertas_inicio_calculos`; los errores, sin datos de negocio, en los registros de la función.

Variables (solo ejemplos, valores reales en archivos ignorados por Git):

| Variable | Dónde | Qué es |
|---|---|---|
| `ALERTAS_INICIO_URL`, `ALERTAS_INICIO_APIKEY` | `infra/kestra/.env` | URL de la función alcanzable desde Kestra y clave pública (anon) para el gateway |
| `SECRET_ALERTAS_INICIO_TOKEN` | `infra/kestra/.env` | token compartido **en base64** (Kestra decodifica los `SECRET_*`) |
| `ALERTAS_INICIO_TOKEN` | secretos de la función (`supabase/functions/.env`) | el mismo token decodificado |

### Demora y estados (FR-024, FR-026)

- Pasada **1 hora** desde `calculada_en` se muestra «Las alertas se calcularon por última vez a las HH:MM y
  pueden estar desactualizadas.»; si nunca se calcularon, «Todavía no se calcularon las alertas.».
- Sin alertas: estado vacío compartido «Sin alertas». Error: «No pudimos cargar este dato» con `Reintentar`.
- **Empresa activa** (Principio VIII): la tarjeta pide las alertas de la empresa activa más las de la
  organización entera; en «Todas mis empresas», todas las accesibles. Al cambiar de empresa se recarga.

## Búsqueda global (F-INI-03, MSF-374)

Campo en la barra superior (`EncabezadoPanel` → `BusquedaGlobal`), visible en todas las pantallas del panel.

- **Qué busca**: solo productos, por nombre o SKU (decisión D-4 de la spec); clientes y comprobantes
  quedan fuera.
- **RPC**: `public.buscar_productos_global(p_q text, p_limite int default 8)` — `security invoker`: rige la
  RLS de `dominio.productos` (organización + `productos` ≥ `lectura`), así que un rol sin lectura recibe
  0 filas. Mínimo 2 caracteres (error `22023`) y tope 20; tolera mayúsculas y tildes, y el nombre además
  tolera errores leves de tipeo (`pg_trgm`).
- **Interfaz**: espera 300 ms tras escribir; elegir un resultado abre `/productos/:id/edit`; sin
  coincidencias, «No encontramos productos»; si falla, el estado de error compartido con «Reintentar» sin
  vaciar el campo. Teclado: flechas, Enter y Escape; una región `role="status"` anuncia la cantidad de
  resultados.
- **Empresa activa**: no aplica (los productos son del catálogo de la organización, no de una empresa).
- **Reversión**: `drop function public.buscar_productos_global(text, integer);` (migración posterior).
- Detalle: [`docs/busqueda-global.md`](./busqueda-global.md).

## Pruebas

pgTAP `supabase/tests/database/alertas_inicio.test.sql` y `supabase/tests/database/busqueda_global.test.sql`;
Vitest de Inicio (`inicio`, `accesos-directos`, `tarjeta-empresas`, `tarjeta-stock`, `tarjeta-consultas`,
`tarjeta-dolar`, `permisos-inicio`, `estados-inicio`, `feature-ml`, `empresa-activa-inicio`,
`navegacion-inicio`, `alertas-lista`, `alertas-demora`, `tablero-inicio`, `tablero-filtros`, `tablero-solo-actividad`, `bloques-gestion`, `movimientos-por-producto`) y de la búsqueda (`busqueda-global`);
`supabase/tests/database/resumen_inicio_periodo.test.sql` (tablero) y `inicio_tablero_bloques.test.sql` (bloques, movimientos por producto y vista previa del dólar);
`pnpm test:edge:recalcular-alertas-inicio`; `pnpm test:kestra:alertas-inicio`.

E2E de cierre (MSF-578 · T024): `apps/web/e2e/inicio.e2e.ts` — Administrador, Consulta y Mostrador con sus
tarjetas, alertas y accesos según su permiso, y el cambio de empresa activa que recarga Inicio sin dejar
datos de la empresa anterior (SC-001, SC-002, SC-003). Requiere el stack local (`pnpm dev:supabase`) y la
web servida; se omite sin `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (ver [`docs/e2e-app.md`](./e2e-app.md)).

## Alerta de dólar: se recalcula al cambiar la configuración (MSF-352)

`guardar_configuracion_cotizacion` y `cambiar_alcance_cotizacion` llaman a `recalcular_alertas_inicio` en la misma transacción: apagar o encender «Aviso en Inicio» o cambiar el alcance actualiza `dolar_sin_cargar` de inmediato (antes quedaba desfasada hasta el siguiente barrido). Prueba: `cotizacion_revision_msf352.test.sql`.
