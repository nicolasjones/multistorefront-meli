# Inicio y alertas

Spec: `specs/20261030-100000-inicio-y-alertas/` (épica MSF-156). Este documento se amplía con la
historia F-INI-03 (búsqueda global).

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

Migraciones `20270115100000`, `20270115100100`, `20270115100200`. El enlace sale de una lista cerrada
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

### Pruebas

pgTAP `supabase/tests/database/alertas_inicio.test.sql`; Vitest `alertas-lista`, `alertas-demora`,
`feature-ml`; `pnpm test:edge:recalcular-alertas-inicio`; `pnpm test:kestra:alertas-inicio`.
