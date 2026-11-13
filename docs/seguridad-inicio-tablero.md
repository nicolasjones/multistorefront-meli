# Revisión de seguridad integral · Inicio, tablero completo (MSF-824)

Cierre de la épica **MSF-824** (spec `specs/20270305-100000-inicio-tablero-completo/`, tarea T017). Cubre las cuatro
historias: filtros, indicadores y gráfico (F-INI-04, MSF-820), bloques de gestión (F-INI-05, MSF-821), «Movimientos por
producto» (F-INI-06, MSF-822) y «Cargar dólar del día» con impacto (F-INI-07, MSF-823). La guía funcional es
[`inicio-y-alertas.md`](./inicio-y-alertas.md); acá solo va lo que importa para seguridad.

- **Revisado**: rama `epic/MSF-824-inicio-tablero-completo` hasta el HEAD final `712e83ed` (PR #899 a `dokploy`, mergeado como `6477bba4`), 2026-11-13, con el CI en verde sobre ese commit (`application`, `database` con pgTAP, `web (1..3)`, `quality`). Hubo una re-revisión independiente de las correcciones (sin hallazgos bloqueantes) y una **revisión final de Código+Seguridad** del delta y de la épica completa, cuyos hallazgos (S-1 a S-5, más lo que movió H-3 y H-5) se resuelven en el PR #909 con la migración `20270306110000`.
- **Código leído**: las cinco migraciones `20270305105000`…`20270305140000`, sus pgTAP (`resumen_inicio_periodo.test.sql`,
  `inicio_tablero_bloques.test.sql`), `apps/web/src/pages/inicio/`, `components/cotizacion/`, `lib/inicioTablero.ts`,
  `lib/inicioBloques.ts`, `lib/exportarCsv.ts`, los cambios de `pages/stock/list.tsx` y `pages/ventas-reportes/`, y el
  cambio de `pnpm-lock.yaml`, `pnpm-workspace.yaml` y `apps/web/package.json`. Se contrastó con las funciones que las nuevas
  reutilizan (`private.nivel_seccion`, `private.nivel_ventas_en_empresa`, `private.empresas_accesibles`,
  `private.empresa_de_cotizacion`, `cargar_cotizacion`, `confirmar_cotizacion`, `listar_actividad`).
- **Comandos ejecutados**: `pnpm audit --prod`, `npm view` de la cadena de `@mui/x-charts` (licencias, scripts de instalación y
  fechas) y los guards `node scripts/verificar-documentacion-cambios.mjs` y `node scripts/verificar-migraciones.mjs`.
  **No se ejecutaron** pgTAP, Vitest ni E2E (no hay Supabase local en esta sesión): para eso vale el CI del PR (ver «Lo que no se verificó»).

## Resultado

**Sin hallazgos Altos.** Diez observaciones: una de severidad **Media** (H-5, rendimiento; ya corregida) y nueve Baja o Informativa (H-1 a H-4, H-6, H-7, S-2, S-3 y S-5); ninguna es una fuga entre
organizaciones, ninguna permite escribir y ninguna expone costo o margen a un rol sin `rentabilidad`.

| # | Severidad | Resumen | Seguimiento |
|---|---|---|---|
| H-1 | Baja | `movimientos_por_producto` no cruza la tienda pedida con las tiendas accesibles al listar sus productos | **Corregido** en la propia épica: la RPC devuelve lista vacía si la tienda no es accesible (con pgTAP) |
| H-2 | Baja (decisión de producto) | El KPI «Ventas (con IVA)» y el ticket promedio se gatean por `ventas`, mientras que «ingresos» por tienda exige `rentabilidad`: el control sobre los ingresos es parcial | Decisión de Nicolás; `tasks.md` |
| H-3 | Baja | `rentabilidad` se evaluaba por organización y `ventas` por tienda | **Corregido** (PR #909, `20270306110000`): ingresos y margen se evalúan con el rol del usuario en cada tienda |
| H-4 | Baja (heredado) | El permiso del dólar es compartido entre tiendas: la tienda se valida contra la organización, no contra las accesibles | Tarea `seguimiento` por crear |
| H-5 | Media (rendimiento) | El índice `(organizacion_id, fecha)` de la épica hacía que `max(fecha)` por producto recorriera todo el libro: 565 ms por producto sin movimientos con 1 M de filas (medición de la revisión independiente de Código+Seguridad (informe del 2026-11-13), en un Postgres 16 efímero con datos sintéticos; no es dev ni producción) | **Corregido** (PR #909, `20270306110000`): índice por `(organizacion_id, producto_id, fecha desc)` y último movimiento calculado después del orden y el límite; sigue sin límite por usuario ni `statement_timeout` versionado |
| S-2 | Baja | `aplicar_cotizacion` tomaba los locks en orden inverso al resto del módulo (fila de la pendiente y luego el advisory): deadlock 40P01 reproducido en un Postgres efímero por la revisión independiente de Código+Seguridad (informe del 2026-11-13, datos sintéticos) | **Corregido** (PR #909): toma primero el advisory lock de la organización |
| S-3 | Informativa | La exportación avisaba «truncado» con exactamente 100.000 filas y no deduplicaba productos entre lotes | **Corregido** (PR #909, pantalla: lotes siempre de 100, truncado solo si llega una fila más allá del tope, deduplicación por producto) |
| S-5 | Informativa | Fechas infinitas daban 22008 con un mensaje en inglés | **Corregido** (PR #909): 22023 en las tres RPC |

**Escala de severidad** de este documento: Alta, Media, Baja, Informativa. Las revisiones finales de Código+Seguridad usaron «Mayor» y «Menor»; equivalen a Media y Baja. **Equivalencias con los códigos de esos informes:** S-1 = H-5 (rendimiento del último movimiento), S-4 = H-3 (rentabilidad por tienda); S-2, S-3 y S-5 son hallazgos nuevos de esa revisión (locks de `aplicar_cotizacion`, exportación en el tope, fechas infinitas); D-1 (carrera del total conservado en el listado) es un defecto de pantalla sin código H.
| H-6 | Informativa | El permiso `exportar` es un control de interfaz: los datos los autoriza `stock` ≥ lectura | Documentado; sin acción |
| H-7 | Informativa (ajena a la épica) | `pnpm audit --prod` marca 30 avisos preexistentes; ninguno en la cadena de `@mui/x-charts` | Tarea `seguimiento` por crear |

Los «seguimientos por crear» no tienen clave de tracker todavía: están anotados en `tasks.md` para que el flujo los abra como
Tarea `seguimiento` (no se crearon desde esta rama).

## Qué se verificó y cómo

### Tablas y RLS: no hay tablas nuevas

Las cinco migraciones solo hacen `create or replace function`, `revoke`, `grant`, `comment on function` y **un**
`create index if not exists` sobre una tabla existente. Una búsqueda en ellas de `create table`, `create policy`,
`enable row level security`, `create view` y `grant select` no encuentra nada. Por eso `rls_en_toda_tabla.test.sql` no cambia y no hay
política nueva que revisar. Las funciones leen tablas con RLS (`dominio.comprobantes_venta`, `…_lineas`, `existencias`,
`existencias_deposito`, `movimientos_stock`, `productos`, `producto_empresa`, `depositos`, `empresas`) **como `security definer`**,
es decir, saltean esa RLS: la autorización está escrita adentro de cada función (siguientes secciones).

### Privilegios de las cinco funciones

Cada migración termina con `revoke execute on function … from public, anon;` y `grant execute on function … to authenticated;`
(`resumen_inicio_periodo(date,date,uuid,uuid)`, `resumen_inicio_bloques(date,date,uuid,uuid)`,
`movimientos_por_producto(date,date,uuid,uuid,text,uuid,text,text,text,integer,integer)`,
`previsualizar_impacto_dolar(numeric,uuid)` y `aplicar_cotizacion(numeric,uuid,numeric)`). Hay una aserción
`has_function_privilege('anon', …, 'EXECUTE')` negativa por cada una (`resumen_inicio_periodo.test.sql`, aserción «anon no ejecuta la RPC»;
`inicio_tablero_bloques.test.sql`, las aserciones «anon no ejecuta …» de bloques y movimientos, de la vista previa del dólar y de `aplicar_cotizacion`) y una positiva para `authenticated` en las dos de F-INI-05/06. No
verifiqué que exista un test genérico que recorra todo `public` buscando funciones ejecutables por `anon`; el que sí está en el
repo para tablas es `privilegios_anon_endurecidos.test.sql`.

### `security definer` y `search_path`

Las cinco son `security definer` con `set search_path = ''`. Revisé que **todas las referencias están calificadas**
(`dominio.*`, `private.*`, `public.*`), incluido el SQL dinámico de `movimientos_por_producto`; lo no calificado son funciones y
operadores de `pg_catalog` (`lower`, `btrim`, `round`, `sum`, `count`, `jsonb_build_object`, `generate_series`, `row_number`), que
Postgres resuelve aunque el `search_path` esté vacío. `aplicar_cotizacion` es definer pero **no decide nada**: delega en
`cargar_cotizacion` y `confirmar_cotizacion`, que validan permiso (`42501`), valor y variación; el pgTAP lo confirma (sin edición
da `42501`, con `0` da `23514`, y tras aplicar no queda ninguna fila en `dominio.cotizacion_pendiente`). El contexto del usuario
(`auth.uid()`) sigue siendo el de la sesión porque sale del claim del JWT, no del rol de la función.

### Secretos

El cambio **no toca** `infra/`, `.github/`, `supabase/functions/`, Kestra ni archivos `.env*`, y no agrega variables de entorno. Una
búsqueda en las líneas agregadas de `apps/`, `packages/` y `supabase/` de `service_role`, `apikey`, `secret`, `token`, `password`,
`dangerouslySetInnerHTML`, `innerHTML`, `eval(`, `localStorage` y `sessionStorage` no encuentra nada. El navegador usa el cliente
de sesión (`supabaseClient.rpc`); no hay service-role en el front.

### SQL dinámico y lista blanca de `movimientos_por_producto`

Es la única función con SQL dinámico (`return query execute format(…)`). Los dos únicos valores que entran al texto del
SQL son `v_orden` y `v_dir`, y ambos salen de un `case` cerrado: `p_orden` ∈ {`nombre`, `sku`, `categoria`, `stock_inicial`,
`entradas`, `salidas`, `ajustes`, `stock_actual`, `minimo`, `ventas`, `ultimo_movimiento`, `estado`} (cada uno se traduce a
una expresión fija, p. ej. `lower(r.nombre)`; otro valor da `22023`) y `p_direccion` ∈ {`asc`, `desc`} (otro valor da `22023`).
Todo lo demás viaja como parámetro (`using`, `$1`…`$12`): fechas, depósito, tienda, categoría, vista (validada además contra
`todos | alerta | quieto`), tamaño y desplazamiento. La búsqueda (`p_busqueda`) también es parámetro, se recorta a 100 caracteres y
se escapan `\`, `%` y `_` antes de armar el `ilike`, de modo que un `%` o un `_` del usuario no hacen de comodín. El `%` literal
del `format` está duplicado (`%%`) donde corresponde. pgTAP lo cubre: orden `'nombre; drop table x'` y dirección `'asc; drop table x'`
dan `22023`, la búsqueda `'%'` devuelve 0 filas y la vista inventada da `22023`.

### Aislamiento entre organizaciones y entre tiendas

- **Organización**: sale de `private.organizacion_id()` (la sesión), nunca de un argumento; todas las lecturas filtran
  `organizacion_id = v_org` y los `join` repiten la organización en ambos lados. Un depósito que no es de la organización se
  trata como inexistente (bloques `null`, listas vacías o cero filas, sin error: no es un oráculo). pgTAP con dos organizaciones:
  «la organización Dos no ve productos de la Uno» y «solo ve su tienda» (`inicio_tablero_bloques.test.sql`), depósito
  de otra organización → 0 filas, y depósito/tienda ajenos → `null` en ventas y stock (`resumen_inicio_periodo.test.sql`: «un depósito de otra organización apaga ventas y stock» y «una tienda de otra organización no devuelve ventas»).
- **Tienda**: las ventas se suman solo de `empresas_accesibles()` donde `private.nivel_ventas_en_empresa(e.id)` es lectura o
  edición, y `resumen_inicio_bloques` además exige `e.activa`; una tienda no accesible o sin `ventas` no amplía nada (pgTAP: «una tienda de otra organización no devuelve ventas» y, en el listado, «una tienda de la misma organización a la que el operador no accede devuelve lista vacía»).
  La excepción es el filtro de **productos** del listado (H-1).
- **Superadmin**: `nivel_seccion` equivale a edición para un superadmin con organización activa, así que ve todo lo de **esa**
  organización; es el comportamiento del repo, no de esta épica.

### Costo, margen e ingresos por rol

Con la matriz inicial (cada organización puede editarla; la autoridad es la base):

| Dato | Quién lo recibe | Dónde se decide |
|---|---|---|
| `margen_pct` e `ingresos` por tienda | `rentabilidad` ≥ lectura **en esa tienda** (Administrador y Administración; el superadmin con organización activa) | `resumen_inicio_bloques`: nivel de la organización **y** `private.nivel_de_rol(org, private.rol_en_empresa(tienda), 'rentabilidad')` por tienda (migración `20270306110000`); sin permiso **vuelven `null` desde la base** |
| Costo unitario | **nadie**: ninguna de las cinco funciones lo devuelve | solo se usa adentro para calcular `margen_pct` |
| Costo y margen en «Movimientos por producto» | **nadie**: no están entre las 12 columnas visibles | contrato de la función |
| «Ventas (con IVA)», comprobantes, ticket, unidades, devoluciones | `ventas` ≥ lectura en la tienda (todos los roles salvo Técnico) | `resumen_inicio_periodo` (H-2) |
| Stock, reservado, mínimo, entradas, salidas, ajustes | `stock` ≥ lectura (los ocho roles de fábrica) | las tres funciones de stock |
| Columna «Ventas» del listado | `ventas` en alguna tienda accesible | `null` si no |
| Impacto del dólar (precios hoy y nuevo, por tienda) | edición de `cotizacion_dolar` (Administrador y Administración) | `previsualizar_impacto_dolar` |

El costo guardado en `comprobantes_venta_lineas.costo_unitario` está fuera del `select` por columna de `authenticated`
(`docs/rentabilidad.md`); estas funciones lo leen como definer **solo** para un porcentaje, y solo para quien tiene `rentabilidad`.
El detalle de qué ve cada rol está en [`inicio-y-alertas.md`](./inicio-y-alertas.md#quién-ve-qué-por-bloque-y-por-rol). pgTAP (`inicio_tablero_bloques.test.sql`) cubre
`ingresos` y `margen_pct` en `null` sin `rentabilidad` (rol del operador y rol «mixto»: mostrador en una tienda y administración en otra), el acceso del superadmin con y sin organización activa, y la columna `ventas` en `null` sin `ventas`.

### Denegación de servicio: topes e índice

- **Período**: `22023` si excede 366 días, en las tres funciones con período (pgTAP lo prueba en `resumen_inicio_periodo` y
  `movimientos_por_producto`). Un rango inválido o de más de 366 días tampoco se consulta desde la pantalla (`errorDeRango`).
- **Página**: `p_tamano` se acota a 1–100 y `p_pagina` a 1–100000 (la pantalla pide 25); `max_rows = 1000` de PostgREST no interviene.
- **Búsqueda**: 100 caracteres, con espera de 300 ms en la pantalla y comodines escapados; existen los índices trigrama
  `productos_nombre_trgm_idx` y `productos_sku_trgm_idx`.
- **Vista previa del dólar**: espera de 400 ms; un valor a más de 10 veces de la vigente no pide vista previa (evita una llamada
  por cada tecla en «1», «14», «149»…); la muestra se acota a 6 productos y la función rechaza NaN, infinito, ≤ 0, más de 4 decimales y ≥ 1e10.
- **Índice nuevo** `dominio.movimientos_stock_org_fecha_dia_idx (organizacion_id, fecha) include (diferencia, deposito_id,
  producto_id, tipo)`: hace falta porque el índice previo de esa tabla es por `creado_en`, no por `fecha`. Es aditivo y se revierte con
  `drop index`; es de un libro de solo agregado, así que el costo en escritura es bajo (ver H-5 por el bloqueo al crearlo).
- **Lo que no hay**: un límite de consultas por usuario o por minuto, ni un `statement_timeout` versionado para `authenticated` en
  el repo (el de la plataforma no está versionado acá). Ver H-5.

### Frontend: URL, XSS y CSV

- **Parámetros de URL**: `leerFiltros` acepta `periodo` solo de una lista, `deposito` y `tienda` solo con formato UUID (o `todas`) y las
  fechas solo si `leerFecha` las valida; Stock acepta `filtro` solo de `sin_stock | stock_bajo` y `deposito` con la misma regex UUID; Reportes
  de ventas valida el rango. Ningún valor de la URL se interpola en SQL ni en HTML; la base vuelve a validar todo.
- **XSS**: ningún `dangerouslySetInnerHTML` ni `innerHTML` en lo agregado. Nombres de tienda, depósito y producto se renderizan como
  texto de React; las etiquetas del gráfico salen de textos fijos y de fechas formateadas.
- **CSV**: la exportación pasa **todo texto** por `neutralizarFormula` (anteponer `'` a lo que empieza con `=`, `+`, `-`, `@`, tab o
  retorno de carro) antes de escapar comillas, `;` y saltos de línea (`lib/exportarCsv.ts`, `campo()`); los números salen como
  números. El nombre y el SKU de un producto son los únicos textos libres del archivo y quedan neutralizados (hay un test con un nombre
  que empieza en `=`). El archivo se arma en el navegador y se descarga como `text/csv;charset=utf-8` con BOM.

### Dólar: atomicidad y vista previa de solo lectura

`previsualizar_impacto_dolar` está declarada `stable` y no ejecuta `insert`/`update`: pgTAP comprueba que no deja filas en
`dominio.cotizacion_pendiente`. `aplicar_cotizacion` ejecuta `cargar_cotizacion` y `confirmar_cotizacion` en la misma transacción
(un solo llamado de PostgREST): si la confirmación falla, la carga se revierte y no queda un pendiente huérfano; ésa era la razón de
agregarla. El rechazo por «el dólar cambió mientras revisabas» (`22023`, `variacion_cambio`) sigue siendo el de `confirmar_cotizacion`.

### Cadena de suministro: `@mui/x-charts` y los `overrides` de `d3-*`

- **Versión y lockfile**: `apps/web/package.json` fija `"@mui/x-charts": "8.29.3"` (sin rango). El lockfile agrega 26 paquetes
  (los tres `@mui/x-*` nuevos, 10 `@types/d3-*`, 10 `d3-*`, `bezier-easing`, `flatqueue` e `internmap`) con `integrity` sha512 (verificado en el diff de `pnpm-lock.yaml`) y ninguno con `requiresBuild` ni `hasBin`.
- **Licencias** (consultadas en el registro de npm el 2026-11-13): `@mui/x-charts`, `@mui/x-internals`, `@mui/x-internal-gestures`,
  `bezier-easing` y `reselect`, MIT; `@mui/x-charts-vendor`, `MIT AND ISC`; los diez `d3-*` fijados, `flatqueue` e `internmap`, ISC. No hay
  paquetes Pro/Premium ni `x-license`.
- **Scripts de instalación**: ninguno de los paquetes de la cadena declara `install`, `preinstall` ni `postinstall`
  (`bezier-easing` tiene `prepublish`, que corre al publicar, no al instalar). `onlyBuiltDependencies` de `pnpm-workspace.yaml` no se amplía.
- **Antigüedad**: `@mui/x-charts@8.29.3` se publicó el 2026-08-21 (más de dos semanas). Los diez `d3-*` que resolvía por defecto
  habían salido el 2026-11-03: se **fijaron a la versión anterior** con `overrides` en `pnpm-workspace.yaml` (d3-array 3.2.4,
  d3-color 3.1.0, d3-format 3.1.2, d3-interpolate 3.0.1, d3-path 3.1.0, d3-scale 4.0.2, d3-shape 3.2.0, d3-time 3.1.0,
  d3-time-format 4.1.0, d3-timer 3.0.1). El lockfile resuelve exactamente esas versiones. El bloque se puede quitar **desde el 2026-11-17**
  re-resolviendo el lockfile; hasta entonces la nota del `pnpm-workspace.yaml` y la de `inicio-y-alertas.md` explican por qué.
- **Avisos**: `pnpm audit --prod` el 2026-11-13 devuelve 30 avisos (0 críticos, 12 altos, 15 moderados, 3 bajos); **ninguno** cuelga de
  `@mui/x-charts`, `d3-*`, `bezier-easing`, `flatqueue`, `internmap`, `reselect` ni `@mui/x-internal*`. Son preexistentes (H-7).
- **Carga**: el gráfico se importa con `React.lazy`, así que el paquete no entra al arranque de Inicio; el diálogo del dólar
  también se carga diferido.

## Hallazgos

### H-1 · Baja · La tienda del listado de movimientos no se cruza con las accesibles (CORREGIDO)

> Corregido antes del merge: `movimientos_por_producto` devuelve una lista vacía si `p_empresa` no está en `private.empresas_accesibles()` (no se distingue de una tienda inexistente) y `inicio_tablero_bloques.test.sql` lo prueba. Lo que sigue describe el hallazgo original.

`public.movimientos_por_producto` (migración `20270305120000`) filtra los productos de una tienda con
`exists (select 1 from dominio.producto_empresa pe where … pe.empresa_id = $12::uuid)`, donde `$12` es `p_empresa` tal cual, **sin
intersectarla con `private.empresas_accesibles()`**. Las **ventas** de la misma función sí se acotan a `v_empresas` (accesibles con `ventas`).
Escenario: una persona con `stock` ≥ lectura asignada solo a la tienda A llama la RPC con el UUID de la tienda B (misma organización) y recibe
nombre, SKU, categoría y stock de los productos asignados a B; con `ventas` en A no recibe ventas de B. Hace falta conocer el UUID de B (no es adivinable, pero aparece en URLs y respuestas a quien
lo usa). Impacto: bajo, porque el catálogo y el stock son
datos de la organización que esa persona ya puede listar sin filtro; solo revela **qué productos están asignados a qué tienda**.
Recomendación: intersectar `p_empresa` con las tiendas accesibles (o devolver cero filas si no lo es) en una migración posterior, y sumar el
caso a pgTAP. No se corrige acá: el alcance de esta tarea excluye migraciones.

### H-2 · Baja (decisión de producto) · Los ingresos se gatean por `rentabilidad`, el KPI de ventas no

La spec fija que «Ventas» se ve con `ventas` ≥ lectura (FR-006) y que costo, valor y margen solo con `rentabilidad` (D-4); «ingresos» por
tienda se gateó con `rentabilidad`. Consecuencia verificable en `resumen_inicio_periodo`: un Mostrador, Consulta, Depósito o Operador (con
`ventas` pero sin `rentabilidad` ni `reportes`) recibe `ventas.monto` (con IVA), `comprobantes`, `ticket_promedio`, `devoluciones_monto`
y la variación contra el período anterior; y si elige una tienda en el filtro, `monto` **es** el ingreso con IVA de esa tienda, que es justamente el
dato que `resumen_inicio_bloques` le devuelve `null`. El **margen** sigue protegido. El listado de comprobantes de Ventas ya muestra importes a
esos roles, así que no se abre un dato nuevo; lo que queda es un control parcial. Recomendación: que Nicolás decida si
«Ventas (con IVA)», ticket y devoluciones exigen `reportes` o `rentabilidad` (como el enlace a Reportes) o si «ingresos» por tienda pasa a
`ventas`. Mientras tanto, la guía lo dice (sección «Quién ve qué»).

### H-3 · Baja · `rentabilidad` por organización, `ventas` por tienda (CORREGIDO)

> **Corregido** en el PR #909 (migración `20270306110000`): `resumen_inicio_bloques` evalúa `rentabilidad` con el rol del usuario **en cada tienda** (`private.nivel_de_rol(org, private.rol_en_empresa(tienda), 'rentabilidad')`) además del nivel de la organización; el superadmin con organización activa conserva el acceso. `inicio_tablero_bloques.test.sql` prueba un usuario con rol de organización «administracion» que es «mostrador» en una tienda (ingresos `null`) y «administracion» en otra (ve sus ingresos). Lo que sigue describe el hallazgo original.

`resumen_inicio_bloques` evalúa `rentabilidad` con `private.nivel_seccion('rentabilidad')`, que es el rol de la **organización** (la sección no es
«por tienda» ni «compartida»), y `ventas` por tienda con `nivel_ventas_en_empresa`. Una persona con `rentabilidad` en la organización pero sin
`ventas` en una tienda no ve esa tienda (no entra a `v_empresas`), así que no hay filtración; y una con `ventas` en una tienda y `rentabilidad`
de organización ve ingresos y margen de esa tienda aunque su rol **en esa tienda** no sea el que tiene `rentabilidad`. Es el criterio del resto del
repo (precios masivos, exportar productos) y ya está como **decisión pendiente de Nicolás** en `tasks.md`.

### H-4 · Baja (heredado) · El dólar se valida contra la organización, no contra las tiendas accesibles

`private.empresa_de_cotizacion` (usada por `previsualizar_impacto_dolar` y, vía `cargar_cotizacion`/`confirmar_cotizacion`, por
`aplicar_cotizacion`) solo comprueba que la tienda pertenece a la organización (`P0002` si no), y `cotizacion_dolar` es una sección **compartida**:
el nivel es el mejor rol del usuario entre sus tiendas. Escenario: con alcance «una cotización por empresa», una persona con edición del dólar en la
tienda A y solo lectura en B puede cargar o previsualizar el dólar de B. Con alcance global no aplica (la cotización es de toda la organización). No es una
regresión: es el comportamiento de las funciones de F-PRE ya mergeadas, que las nuevas heredan. La vista previa además lista **todas** las tiendas activas
con su cantidad de precios en USD y una muestra de hasta 6 productos con su precio (datos de catálogo de la organización, no de costo). Recomendación: decidir
si el dólar por tienda debe exigir la tienda accesible y aplicarlo a las cuatro funciones de una vez.

### H-5 · Media (rendimiento) · Costo del último movimiento, sin límite por usuario e índice sin `concurrently` (CORREGIDO lo medido)

> **Corregido** en el PR #909 (migración `20270306110000`): el índice de la épica `(organizacion_id, fecha)` empeoraba el `max(fecha)` por producto (el planner lo recorría entero filtrando por producto: **565 ms por producto sin movimientos con 1.000.000 de movimientos** contra 0,05–0,09 ms con el índice por producto; fuente: medición de la revisión independiente de Código+Seguridad (informe del 2026-11-13), en un Postgres 16 efímero con datos sintéticos; no es dev ni producción). Se agrega `movimientos_stock_org_producto_fecha_idx (organizacion_id, producto_id, fecha desc)` y `movimientos_por_producto` calcula `ultimo_movimiento` **después del orden y el límite** (hasta la página pedida, es decir offset + límite, y no para todo el listado), salvo que se ordene por esa columna. Sigue abierto: no hay límite por usuario ni `statement_timeout` versionado, y el índice no se crea `concurrently`. Lo que sigue describe el hallazgo original.

- **`movimientos_por_producto`** arma el listado completo, calcula `count(*) over ()` y recién entonces corta la página. El **último movimiento** es una
  subconsulta por producto (`max(fecha)` sobre `movimientos_stock` del producto) y el índice por producto de esa tabla es por `creado_en`, no por `fecha`, así que no sirve para ese `max`; por
  eso el costo crece con productos × movimientos. Con el catálogo y el libro de dev no se nota; **no lo medí con volumen real**.
- **La exportación** (`useExportarCsv`) llama la misma RPC por lotes de 100 hasta un tope de 100.000 filas, una a una, y cada llamada vuelve a computar el
  listado entero; en el peor caso son ~1.000 llamadas secuenciales por exportación. Hay una sola exportación en curso por pantalla, pero nada limita
  cuántas puede disparar una persona con distintas pestañas.
- **`resumen_inicio_periodo`** recorre los comprobantes de hasta 732 días (el período y el anterior) con subconsultas por comprobante; está acotado por
  la regla de 366 días y por el índice `(organizacion_id, fecha)` de `comprobantes_venta`.
- **No hay límite por usuario** ni un `statement_timeout` versionado para `authenticated` en el repo.
- **Índice**: `create index if not exists movimientos_stock_org_fecha_dia_idx` no es `concurrently`, así que al crearlo bloquea las escrituras sobre
  `movimientos_stock` mientras dura. Es una tabla de solo agregado y el índice es angosto; con el volumen actual debería ser instantáneo, pero conviene
  desplegar fuera de un horario de movimientos intensos.
Recomendación: medir los tres listados con un volumen realista en dev; si hace falta, un índice por `(organizacion_id, producto_id, fecha)` y/o un
`statement_timeout` para `authenticated`.

### S-2 · Baja · `aplicar_cotizacion` invertía el orden de locks (CORREGIDO)

`aplicar_cotizacion` delega en `cargar_cotizacion` (toma el lock de la fila de la pendiente) y después en `confirmar_cotizacion` (pide `pg_advisory_xact_lock('cotizacion:'||org)`), mientras que `confirmar_cotizacion`, `descartar_cotizacion` y el cambio de alcance toman primero el advisory y luego la fila. Antes de la épica eran dos transacciones separadas, así que no había inversión. Escenario: el administrador B dejó una pendiente cargada desde Cotización; el administrador A aplica desde Inicio (pisa la pendiente y tiene la fila) mientras B confirma o descarta (tiene el advisory y pide la fila): Postgres aborta uno con `40P01` (reproducido por la revisión independiente de Código+Seguridad en un Postgres efímero con datos sintéticos). **Corrección** (PR #909, `20270306110000`): `aplicar_cotizacion` toma como primera línea el advisory lock de la organización (solo si hay organización de sesión: sin ella no se comparte una clave global y `cargar_cotizacion` rechaza con 42501); es reentrante en la misma transacción. Anotado además que `aplicar_cotizacion` **reemplaza una cotización pendiente ajena** cargada desde Cotización, de acuerdo con el texto «Ya se cargó hoy: esto reemplaza la cotización».

### S-5 · Informativa · Fechas infinitas (CORREGIDO)

`p_desde`/`p_hasta` con `infinity` o `-infinity` rompían `(p_hasta - p_desde)` con SQLSTATE 22008 y un mensaje en inglés, antes del chequeo de 366 días. Inofensivo (sin costo, escritura ni fuga; el front valida con regex), pero inconsistente: ahora las tres RPC validan `isfinite()` y devuelven 22023 (PR #909, `20270306110000`, con pgTAP).

### S-3 · Informativa · Exportación en el tope de filas (CORREGIDO)

`useExportarCsv` sondeaba el tope con `pedirLote(100000, 1)`; en «Movimientos por producto» eso era la página 100001 de tamaño 1, que la RPC acota a 100000 y devuelve la fila 100.000 aunque no hubiera más: con exactamente 100.000 filas avisaba «se exportaron las primeras 100.000» en falso. Además la paginación por desplazamiento sobre datos que cambian podía repetir un producto entre lotes. **Corrección** (PR #909): el hook pide siempre lotes de `tamanoLote`, solo marca truncado cuando llega una fila más allá del tope y deduplica por producto; probado con el tope reducido a 300 filas. Sin impacto de seguridad: cosmético y de consistencia.

### H-6 · Informativa · `exportar` es control de interfaz

El botón «Exportar» solo se ve con la acción `exportar` de `stock` (`usePuedeAccion`), pero el CSV se arma en el navegador paginando la **misma** RPC, que solo
exige `stock` ≥ lectura. Una persona con `stock` de lectura sin la acción `exportar` puede obtener los mismos datos llamando la RPC por lotes, o
copiándolos de la pantalla. No hay nada en el archivo que no se vea en el listado (no lleva costo ni margen). Se deja como está y se documenta para que nadie
lo tome por una barrera de datos.

### H-7 · Informativa (ajena a la épica) · Avisos preexistentes de `pnpm audit`

`pnpm audit --prod` (2026-11-13) marca 30 avisos, todos en dependencias que **esta épica no agrega**: `axios` (12, vía `@nangohq/frontend` en `apps/web`),
`follow-redirects`, `qs` (vía `@refinedev/core`), `fast-uri` (vía `packages/ia`) y varios de `packages/mcp-server` (`@hono/node-server`, `hono`, `body-parser`,
`ip-address`, `zod`). Los de `axios` y `follow-redirects` cuelgan de una dependencia de producción de `apps/web`; no verifiqué si llegan al bundle. No se trata acá; queda como seguimiento propio para que alguien
decida las actualizaciones o los `overrides`.

## Riesgo residual

Con lo anterior, el riesgo residual de la épica es **bajo**: lo que queda es (a) decisiones de producto sobre quién ve los ingresos totales (H-2) y el dólar por tienda
(H-4) y (b) la ausencia de un límite por usuario y de un `statement_timeout` versionado (H-5, lo restante). La validación de tienda del listado (H-1), el margen por tienda (H-3), el costo del último movimiento (H-5), el orden de locks (S-2) y las fechas infinitas (S-5) quedaron corregidos en el PR #909. Ninguno bloquea el merge. Los seguimientos están en `specs/20270305-100000-inicio-tablero-completo/tasks.md`; los de la épica de producto siguen siendo **MSF-849**
(modo oscuro), **MSF-850** (error independiente por bloque) y **MSF-851** (E2E de bloques, listado y dólar).

## Lo que no se verificó

- **pgTAP, Vitest y E2E**: no los corrí yo en esta revisión. Lo que afirmo de las pruebas es lo que **dicen** los archivos, respaldado por el CI verde del PR #899 sobre el HEAD final `712e83ed` (`database` ejecuta todo `supabase/tests/database`; el E2E necesita Supabase local y no corre en el CI).
- **Desempeño con volumen real en dev** (H-5): la medición de 565 ms contra 0,05 ms es sintética (medición de la revisión independiente de Código+Seguridad (informe del 2026-11-13), en un Postgres 16 efímero con datos sintéticos; no es dev ni producción); en dev, con 2.286 productos, una página de 100 filas respondió en 0,10 s (fuente: comentario «Registro de verificación en dev · MSF-824 (2026-11-13)» del issue MSF-824 (plan.agenmatica.com/MSF-824)). El **`statement_timeout`** efectivo de `authenticated` en dev y producción tampoco se verificó.
- **Los permisos efectivos de cada organización**: la tabla por rol usa la matriz de fábrica; una organización puede haberla editado.
- **La verificación en dev** sí se hizo el 2026-11-13 (bundle desplegado, migraciones aplicadas, 39/39 pruebas de las RPC con una sesión real de administrador; fuente: comentario «Registro de verificación en dev · MSF-824 (2026-11-13)» del issue MSF-824 (plan.agenmatica.com/MSF-824)); no hay una sesión de otros roles en dev.
- **El manual de usuario de Inicio con capturas**: vive en la rama `main`; no se revisó ni se tocó.

## Pruebas que respaldan estas afirmaciones

pgTAP: `supabase/tests/database/resumen_inicio_periodo.test.sql` (signo de la nota de crédito, período anterior, tienda y depósito
ajenos, serie, tope de 366 días, `anon`) e `inicio_tablero_bloques.test.sql` (más de 50 aserciones: permisos por rol, ingresos y margen `null`, lista blanca y comodines,
dos organizaciones, vista previa sin escritura, valores inválidos, `aplicar_cotizacion` atómica, `anon`). Vitest: `tablero-filtros`, `tablero-inicio`,
`tablero-solo-actividad`, `bloques-gestion`, `movimientos-por-producto` (incluye la neutralización de fórmulas del CSV), `DialogoCargarDolarConImpacto.test.tsx`
y su variante `.integrado.test.tsx`.
