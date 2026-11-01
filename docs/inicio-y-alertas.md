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

Migraciones `20270202100000`, `20270202100100`, `20270202100200`. El enlace sale de una lista cerrada
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
`navegacion-inicio`, `alertas-lista`, `alertas-demora`) y de la búsqueda (`busqueda-global`);
`pnpm test:edge:recalcular-alertas-inicio`; `pnpm test:kestra:alertas-inicio`.

E2E de cierre (MSF-578 · T024): `apps/web/e2e/inicio.e2e.ts` — Administrador, Consulta y Mostrador con sus
tarjetas, alertas y accesos según su permiso, y el cambio de empresa activa que recarga Inicio sin dejar
datos de la empresa anterior (SC-001, SC-002, SC-003). Requiere el stack local (`pnpm dev:supabase`) y la
web servida; se omite sin `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (ver [`docs/e2e-app.md`](./e2e-app.md)).
