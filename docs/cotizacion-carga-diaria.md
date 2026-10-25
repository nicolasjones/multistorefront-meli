---
owner: producto
sources: [specs]
---
# Carga diaria de la cotización del dólar (F-PRE-02)

Historia F-PRE-02 (MSF-246) de la épica MSF-116 (`specs/20261023-120000-dolar-y-recalculo/`).
Cubre la tabla de la cotización pendiente, el historial vacío, las RPC de carga y estado, la
pantalla **Cotización del dólar** (`/cotizacion`) y el diálogo **Cargar dólar del día**. La vista previa,
la confirmación y el recálculo son F-PRE-03; el historial inmutable, F-PRE-04; el aviso diario, F-PRE-05.
El cierre de la épica (`docs/dolar-y-recalculo.md`) integra este documento.

## Modelo

- La cotización es **una por organización** (no depende de la empresa activa de la barra superior).
- Se carga **a mano**, con edición en la sección `cotizacion_dolar` (hoy Administrador y Administración).
- Cargar deja la cotización **pendiente**: no cambia ningún precio. Vence a las **24 h**; el
  vencimiento se resuelve **al consultar** (`expira_en > now()`), sin worker ni barrido.
- Volver a cargar **reemplaza** la pendiente (una por organización) y renueva las 24 h.
- «Vigente» = última cotización confirmada o, mientras no haya ninguna (F-PRE-03 es quien confirma),
  la cotización inicial de MSF-114 (`dominio.cotizacion_inicial`), que es la que usa `private.a_pesos`.

## Datos (Principio VII: todo en `dominio`)

| Objeto | Esquema | Acceso |
|---|---|---|
| `cotizacion_pendiente` | `dominio` | RLS por organización; select/insert/update/delete solo con `cotizacion_dolar`=`edicion`; los tiempos (`cargada_en`, `expira_en`) los fija un disparador, la API no puede extenderlos |
| `cotizaciones` (historial) | `dominio` | RLS por organización; select con `cotizacion_dolar` ≥ `lectura`; **sin** insert/update/delete para `authenticated` (la escritura llega con `confirmar_cotizacion`, F-PRE-03; la inmutabilidad, F-PRE-04) |

`anon` no tiene privilegios sobre ninguna. Migraciones aditivas:
`20261023140000_cotizacion_tablas.sql` y `20261023140100_cotizacion_cargar_estado.sql`.

## RPC (`public`, `security invoker`, `revoke … from public, anon`, `grant execute … to authenticated`)

- `cargar_cotizacion(p_valor numeric)` → `{ valor, anterior, variacion_pct, expira_en }`. Exige `edicion`.
  Errores: `42501` sin permiso, `23514` valor inválido (≤ 0, nulo, NaN/Infinity o más de 4 decimales),
  `22003` fuera de rango (≥ 10.000.000.000). `anterior` es la vigente.
- `estado_cotizacion()` → `{ vigente: { valor, cargada_en, cargada_por } | null, productos_usd, pendiente | null }`.
  Exige `lectura`. `cargada_por` es `null` si la vigente es la cotización inicial. `productos_usd` cuenta los
  productos **activos** en USD de la organización. La pendiente solo la ve quien tiene `edicion`.
  El «Anterior» del diálogo es la vigente.

## Pantalla

- Ruta `/cotizacion` (carga diferida), ítem **Cotización del dólar** en *Administración*, protegida por
  `cotizacion_dolar` ≥ `lectura` (`RequiereAccesoSeccion` y recurso Refine `cotizacion`).
- Botón **Cargar cotización** solo con `edicion`. El diálogo también se carga de forma diferida.
- El campo solo admite dígitos, `.` y `,`. Formatos válidos: `1490`, `1490,50`, `1.490,5`; `1490.50` se
  rechaza por ambiguo. Variación inusual (> 15 %) solo avisa.
- Tras cargar, el diálogo pasa a la vista previa y la confirmación (ver [cotizacion-recalculo.md](cotizacion-recalculo.md), F-PRE-03).
- Si cambia la organización de trabajo (superadmin) el estado se descarta y se vuelve a leer.

## Pruebas

- pgTAP `supabase/tests/database/cotizacion_carga.test.sql` (SC-001): dos organizaciones, permisos por rol,
  validación, reemplazo, vencimiento, historial sin escritura directa y `anon`.
- Vitest (SC-002): `lib/cotizacion.test.ts`, `hooks/useCotizacion.test.tsx`,
  `components/cotizacion/DialogoCargarDolar.test.tsx` y `pages/cotizacion/index.test.tsx`.

## Aviso de cotización no cargada (F-PRE-05, MSF-305)

- `public.cotizacion_del_dia()` (migración `20261023140500_cotizacion_aviso.sql`, `security invoker`, sin
  tablas nuevas; `anon` sin ejecución) → `{ cargada_hoy, cargada_en, cargada_por, valor }`. «Hoy» es el día
  calendario de `America/Argentina/Buenos_Aires` (de 00:00 a 24:00, todos los días: sin calendario de
  feriados). Solo cuentan las cargas **confirmadas** de `dominio.cotizaciones`; la pendiente no. Con varias
  cargas hoy vale la más reciente. Exige `cotizacion_dolar` ≥ `lectura` (`42501` si no).
- `AvisoCotizacion` («Todavía no se cargó el dólar de hoy» + «Los precios en dólares se siguen calculando con
  {valor} ({última carga}).») se monta en `/cotizacion` y en la portada (`Home`). No consulta nada si el rol
  no tiene `lectura`; «Cargar ahora» solo con `edicion` y abre el diálogo de carga (carga diferida). Si la
  consulta falla muestra un error con «Reintentar» (no se calla). Inicio (MSF-156) hospedará el mismo componente.
- La tarjeta «Vigente» suma el indicador «Al día» / «Sin cargar hoy» y, si hoy se cargó, «Cargada hoy <hora> por <quién>».
- Fuera de alcance: apagar el aviso (F-PRE-06) y distinguir días hábiles o feriados.
- Pruebas: pgTAP `cotizacion_aviso.test.sql` (SC-007) y Vitest `AvisoCotizacion.test.tsx`,
  `useCotizacionDelDia.test.tsx`, `lib/cotizacion.test.ts`, `pages/cotizacion/index.test.tsx` y `App.test.tsx` (SC-008).
- Reversión: migración posterior con `drop function public.cotizacion_del_dia();` y quitar el componente de `Home` y de la pantalla.

## Reversión

Migración posterior (exportar antes los datos): quitar las dos RPC, el disparador
`cotizacion_pendiente_vencimiento` y la función `private.fijar_vencimiento_cotizacion`, y las tablas
`dominio.cotizaciones` y `dominio.cotizacion_pendiente`. Quitar también la ruta, el ítem de menú y el
recurso `cotizacion` de `SECCION_POR_RECURSO`.
