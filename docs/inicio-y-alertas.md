# Inicio y alertas

Spec: `specs/20261030-100000-inicio-y-alertas/` (épica MSF-156). Cubre las tres historias de la épica:
la pantalla de inicio (F-INI-01), las alertas accionables (F-INI-02) y la búsqueda global (F-INI-03).

**Alcance (decisión D-3 de la spec):** Inicio es una **pantalla de Refine con consultas en vivo**, no un
tablero de Superset. Es lo que dice el documento del componente de la épica; la fila del roadmap quedó
alineada con esta decisión (`docs/roadmap-template.md`).

## Pantalla de inicio (F-INI-01, MSF-344)

Ruta canónica `/` (ítem «Inicio» del menú, audiencia: todos los roles de organización). Reemplaza la portada
de servicios del template. Código en `apps/web/src/pages/inicio/`; lecturas en `apps/web/src/lib/inicio.ts`.
No agrega tablas ni RPC: lee objetos existentes.

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
- **Decisión D-1**: «estado de las empresas» = nombre de cada empresa accesible y marca de la activa. El
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
  (con las entradas de mercadería, sin traslados, devoluciones ni anulaciones). El stock depende del
  depósito, no del período ni de la tienda.
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

Aprobada por Nicolás el 2026-11-13 (D-6). Se fija la versión **exacta `8.29.3`** (publicada el 2026-08-21):
licencia **MIT** (el paquete base de gráficos; no se usa la edición Pro/Premium), mismo mantenedor y familia
que `@mui/material` (peer `^5.15.14 || ^6 || ^7`, compatible con el MUI 6 del panel) y sin scripts de
instalación propios. Dependencias directas: `@mui/x-internals`, `@mui/x-internal-gestures` y
`@mui/x-charts-vendor`; esta última trae 10 paquetes `d3-*` (array, color, format, interpolate, path, scale,
shape, time, time-format, timer; MIT o ISC), `flatqueue` y `internmap` (ISC), 11 `@types/d3-*` y `bezier-easing`
(MIT, **de un tercero**, no del mantenedor de MUI). No hay paquetes Pro/Premium ni de licencia (`x-license`) en
el lockfile.

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
  propio reintento; la actividad es independiente.

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
- **Cuadre**: en la lista, entradas, salidas y ajustes cuentan **todos** los movimientos del período (traslados,
  devoluciones y anulaciones incluidos) para que `stock inicial + entradas − salidas + ajustes = stock actual`
  cuando el período llega hasta hoy (decisión D-12). Los indicadores de «Stock hoy» excluyen traslados,
  devoluciones y anulaciones de las entradas (D-3); por eso los dos números pueden diferir.
- **Exportar** baja a CSV por lotes de 100 lo mismo que se ve (mismos filtros), con tope de filas; el botón solo lo
  ve quien puede exportar Stock. El archivo es `movimientos-por-producto-AAAA-MM-DD.csv`.
- **No expone costo ni margen**: ninguna de las 12 columnas los trae.

## Cargar dólar del día desde Inicio (F-INI-07, MSF-823, épica MSF-824)

La tarjeta «Dólar» muestra el aviso «Todavía no se cargó el dólar de hoy» con **Cargar ahora** solo a quien tiene **edición** en «Cotización del dólar» (el operador no ve ni el aviso ni el botón). El botón abre `DialogoCargarDolarConImpacto`:

- **Vista previa antes de guardar.** Mientras se escribe el valor (con una espera corta de 400 ms) se pide `public.previsualizar_impacto_dolar(valor, empresa)`, una RPC de **solo lectura**: no deja una cotización pendiente. Cancelar o cerrar no guarda nada. El diálogo de Cotización (`DialogoCargarDolar`) mantiene su flujo de siempre (cargar → vista previa → confirmar) y no cambia.
- **Qué se ve.** La cotización vigente, la variación contra ella (chip), una tarjeta de impacto por cada tienda activa de la organización (sin nombres fijos: una tienda nueva suma su tarjeta) y la tabla de muestra con precio de hoy y nuevo. Sin Mercado Libre.
- **Umbrales** (los configurados en la base): menos del umbral (1 %) solo registra y lo informa; más de la variación inusual (15 %) advierte y exige tildar «Revisé el valor…» antes de aplicar.
- **Guardar.** Recién al confirmar se carga y se confirma con las RPC de siempre (fecha y usuario quedan en el historial); si la base rechaza, se descarta lo cargado. El aviso se actualiza sin recargar la página y muestra el resultado («Cotización aplicada · N precios recalculados» o «registrada»).
- **Una por empresa.** Con ese alcance la carga es de la empresa activa de la barra superior; en «Todas mis empresas» el botón queda deshabilitado hasta elegir una.
- **Valores inválidos.** El campo solo admite dígitos, punto y coma (no hay signo negativo); cero o vacío no piden vista previa y no dejan guardar.

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
`navegacion-inicio`, `alertas-lista`, `alertas-demora`, `tablero-inicio`, `tablero-filtros`, `bloques-gestion`, `movimientos-por-producto`) y de la búsqueda (`busqueda-global`);
`supabase/tests/database/resumen_inicio_periodo.test.sql` (tablero) y `inicio_tablero_bloques.test.sql` (bloques, movimientos por producto y vista previa del dólar);
`pnpm test:edge:recalcular-alertas-inicio`; `pnpm test:kestra:alertas-inicio`.

E2E de cierre (MSF-578 · T024): `apps/web/e2e/inicio.e2e.ts` — Administrador, Consulta y Mostrador con sus
tarjetas, alertas y accesos según su permiso, y el cambio de empresa activa que recarga Inicio sin dejar
datos de la empresa anterior (SC-001, SC-002, SC-003). Requiere el stack local (`pnpm dev:supabase`) y la
web servida; se omite sin `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (ver [`docs/e2e-app.md`](./e2e-app.md)).

## Alerta de dólar: se recalcula al cambiar la configuración (MSF-352)

`guardar_configuracion_cotizacion` y `cambiar_alcance_cotizacion` llaman a `recalcular_alertas_inicio` en la misma transacción: apagar o encender «Aviso en Inicio» o cambiar el alcance actualiza `dolar_sin_cargar` de inmediato (antes quedaba desfasada hasta el siguiente barrido). Prueba: `cotizacion_revision_msf352.test.sql`.
