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
`20261023100000_cotizacion_tablas.sql` y `20261023100100_cotizacion_cargar_estado.sql`.

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
- Tras cargar, un aviso indica que la cotización queda pendiente de confirmar (la confirmación es F-PRE-03).
- Si cambia la organización de trabajo (superadmin) el estado se descarta y se vuelve a leer.

## Pruebas

- pgTAP `supabase/tests/database/cotizacion_carga.test.sql` (SC-001): dos organizaciones, permisos por rol,
  validación, reemplazo, vencimiento, historial sin escritura directa y `anon`.
- Vitest (SC-002): `lib/cotizacion.test.ts`, `hooks/useCotizacion.test.tsx`,
  `components/cotizacion/DialogoCargarDolar.test.tsx` y `pages/cotizacion/index.test.tsx`.

## Reversión

Migración posterior (exportar antes los datos): quitar las dos RPC, el disparador
`cotizacion_pendiente_vencimiento` y la función `private.fijar_vencimiento_cotizacion`, y las tablas
`dominio.cotizaciones` y `dominio.cotizacion_pendiente`. Quitar también la ruta, el ítem de menú y el
recurso `cotizacion` de `SECCION_POR_RECURSO`.
