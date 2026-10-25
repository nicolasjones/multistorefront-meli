---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Dólar y recálculo: modelo, RPC y operación

**Épica:** MSF-116 · **Spec:** `specs/20261023-120000-dolar-y-recalculo/` (plan y contrato en la misma
carpeta) · **Rama:** `epic/MSF-116-precios-y-dolar-dolar-y-recalculo`, merge `872f09a` (PR #304),
**pendiente de merge a `main`** al escribir esta página.

Historias y commits de la rama: F-PRE-02 `7839dc0` (MSF-246), F-PRE-03 `eca1c8a` (MSF-267), F-PRE-04
`7dfdca6` (MSF-286), F-PRE-05 `085da04` (MSF-305) y el cierre `7064cbf` (MSF-547). La base de precios es
MSF-114 (`precios-e-iva`, migraciones `20261022*`, PR #281), también en rama.

## Decisión de arquitectura

El recálculo **no usa worker ni Kestra**: es una transacción de base de datos. Una cotización es una sola
fila por organización y los precios se calculan al leer, así que «recalcular todos los precios» es mover
esa fila de forma atómica. El vencimiento de la cotización pendiente (24 h) se resuelve **al consultar**
(`expira_en > now()`), sin barrido programado. El ciclo de ejecuciones y el outbox del template no se usan.

## Modelo de datos (Principio VII)

Todo es dato de negocio → esquema `dominio`; las RPC viven en `public` y no almacenan datos. Ver el
[DER en Datos y DER](datos.md#precios-y-dólar-msf-116).

| Objeto | Esquema | Naturaleza y acceso |
|---|---|---|
| `cotizacion_pendiente` | `dominio` | Una por organización (PK `organizacion_id`), `valor numeric(14,4) > 0`, vence a las 24 h. RLS por organización; select/insert/update/delete solo con `cotizacion_dolar` = `edicion`. Los tiempos los fija el trigger `fijar_vencimiento_cotizacion`; la API no los elige. |
| `cotizaciones` | `dominio` | Historial de cargas confirmadas: `valor`, `valor_anterior`, `variacion_pct`, `cargada_por` + `cargada_por_nombre`, `cargada_en`, `recalculo_aplicado`, `precios_recalculados`. **Append-only.** Select con `cotizacion_dolar` ≥ `lectura`; sin insert/update/delete para `authenticated`. |
| `cotizacion_aplicada` | `dominio` | La cotización con la que se calculan los precios (una fila por organización, `cotizacion_id`). Select para quien ve `productos` (igual que `cotizacion_inicial`); escritura solo por `confirmar_cotizacion`. |
| `cotizacion_inicial` | `dominio` | **Existente** (MSF-114). Sin cambios: es el respaldo cuando no hay fila aplicada. |

`anon` no tiene privilegios sobre ninguna. Las migraciones son aditivas y llevan su reversión en el
encabezado:

| Migración | Contenido |
|---|---|
| `20261023140000_cotizacion_tablas.sql` | Tablas `cotizacion_pendiente` y `cotizaciones`, RLS, trigger de vencimiento e índice `(organizacion_id, cargada_en desc, id)` |
| `20261023140100_cotizacion_cargar_estado.sql` | RPC `cargar_cotizacion` y `estado_cotizacion` |
| `20261023140200_cotizacion_previsualizar.sql` | Helpers privados y RPC `previsualizar_cotizacion` |
| `20261023140300_cotizacion_confirmar_recalculo.sql` | Tabla `cotizacion_aplicada`, `private.a_pesos` con `coalesce(aplicada, inicial)`, `confirmar_cotizacion` y `descartar_cotizacion` |
| `20261023140400_cotizacion_historial.sql` | Triggers de inmutabilidad y RPC `listar_cotizaciones` |
| `20261023140500_cotizacion_aviso.sql` | RPC `cotizacion_del_dia` |

## RPC (`public`)

Todas hacen `revoke … from public, anon` y `grant execute … to authenticated`. Errores: `42501` sin
permiso, `23514` valor inválido, `22003` fuera de rango, `P0002` `sin_cotizacion_pendiente` (no hay, venció
o ya se confirmó), `22023` cursor inválido.

| RPC | Devuelve | Seguridad y reglas |
|---|---|---|
| `cargar_cotizacion(p_valor numeric)` | `{ valor, anterior, variacion_pct, expira_en }` | `security invoker`. Exige `edicion`; valida `> 0`, finito, ≤ 4 decimales y < 10.000.000.000; **reemplaza** la pendiente (una por organización) y renueva las 24 h. No toca precios. `anterior` es la vigente. |
| `estado_cotizacion()` | `{ vigente: {valor, cargada_en, cargada_por} \| null, productos_usd, pendiente \| null }` | `stable`, `security invoker`. Exige `lectura`. `vigente` = última confirmada o la inicial; `productos_usd` cuenta productos activos en USD; la pendiente no vencida solo la ve `edicion`. |
| `previsualizar_cotizacion()` | `{ variacion_pct, recalcula, empresas: [{empresa_id, nombre, precios}], muestra: [{producto, sku, usd, por_empresa: [{empresa_id, hoy, nuevo}]}] }` | `stable`, `security definer` acotado (lee la regla de cada empresa sin exigir `empresas` a quien carga el dólar). Exige `edicion`; **solo lee**. Muestra hasta 6 productos activos en USD y usa la regla de cada empresa + IVA si lo muestra. |
| `confirmar_cotizacion()` | `{ id, recalculo_aplicado, precios_recalculados }` | `security definer` (único camino de escritura a `cotizaciones` y `cotizacion_aplicada`), `search_path = ''`. Una transacción: bloqueo por organización, historial, cotización aplicada si alcanza el umbral, borrado de la pendiente y eventos. |
| `descartar_cotizacion()` | vacío | `security definer`; exige `edicion`. Idempotente: sin pendiente no hace nada ni deja evento. |
| `listar_cotizaciones(p_limite integer default 10, p_cursor text default null)` | `{ filas: [...], siguiente_cursor }` | `stable`, `security invoker` (rige la RLS). Exige `cotizacion_dolar` ≥ `lectura`; más nueva primero; cursor opaco `<cargada_en>\|<id>`; límite acotado a 1–100; variación contra la fila anterior. |
| `cotizacion_del_dia()` | `{ cargada_hoy, cargada_en, cargada_por, valor }` | `stable`, `security invoker`. Exige `lectura`. Solo cuenta cargas **confirmadas** con fecha de hoy en `America/Argentina/Buenos_Aires`; la pendiente no cuenta. |

No confundir `listar_cotizaciones` (historial de esta épica) con
`listar_historial_cotizaciones` (cotizaciones importadas del panel anterior, MSF-275; migración
`20261022110201`).

## Umbral, recálculo y atomicidad

- **Umbral fijo de 1 %**, en valor absoluto, medido contra la **cotización vigente** (última confirmada o,
  sin ninguna, `cotizacion_inicial`). Con |variación| ≥ 1 % se recalcula; con menos, **solo se registra**
  en el historial y `cotizacion_aplicada` no se mueve. Sin cotización previa siempre se aplica. La línea
  está marcada «umbral» en `confirmar_cotizacion`.
- `private.a_pesos` mantiene su firma y ahora lee `coalesce(cotizacion_aplicada, cotizacion_inicial)`:
  es el único punto de lectura de la cotización. Sin fila ni inicial, un importe en USD sigue sin precio
  (no se inventa un valor).
- No se guarda ningún precio en pesos. Al confirmar con recálculo se actualiza la **única** fila de
  `cotizacion_aplicada` de la organización en la misma transacción, así que todas las empresas cambian
  juntas. «Precios recalculados» = productos activos en USD × empresas activas (el número del mosaico).
- **Concurrencia:** `pg_advisory_xact_lock` por organización más `select … for update` de la pendiente.
  Ante doble clic o dos administradores, una confirmación gana y la otra recibe `P0002`, sin duplicar el
  historial. Cualquier falla revierte historial, cotización aplicada, pendiente y eventos: todo o nada.

## Permisos

| Acción | Sección `cotizacion_dolar` |
|---|---|
| Ver pantalla, `estado_cotizacion`, `listar_cotizaciones`, `cotizacion_del_dia` | `lectura` o `edicion` |
| Cargar, previsualizar, confirmar, descartar; ver la pendiente | `edicion` |

La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un
parámetro. Las tres funciones `security definer` verifican `edicion` y la organización **dentro** de la
función. La matriz vigente da `edicion` a Administrador y Administración; el Jira dice solo Administrador
y se ajusta desde Roles.

## Eventos de actividad

Se escriben con `private.insertar_actividad` en la **misma transacción** que el cambio. Si el registro
falla, la operación se revierte.

| Tipo | Cuándo |
|---|---|
| `cotizacion.cargada` | Al confirmar una carga (con o sin recálculo). |
| `recalculo.aplicado` | Variación ≥ 1 %: indica cuántos precios se recalcularon. |
| `recalculo.omitido` | Variación < 1 %: se registró la cotización sin tocar precios. |
| `cotizacion.descartada` | Al cancelar una pendiente existente. |

## Historial inmutable y operación

`private.rechazar_cambio_cotizacion` corre en triggers de fila (`BEFORE UPDATE OR DELETE`) y de sentencia
(`BEFORE TRUNCATE`) sobre `dominio.cotizaciones`, con `ENABLE ALWAYS`. Rechaza esas operaciones para
cualquier rol, incluidos el dueño, `service_role` y `session_replication_role = replica`. No hay políticas
ni grants de escritura: el único `insert` lo hace `confirmar_cotizacion`.

Las únicas salidas son acciones referenciales de la base: `cargada_por → null` al borrar al usuario y el
borrado en cascada cuando se elimina la organización.

Efecto operativo (para [Operación](operacion.md)): un `pg_restore` de datos sobre una tabla ya poblada, o
un `TRUNCATE … CASCADE` que alcance `dominio.cotizaciones`, falla; hay que restaurar sobre una base vacía
(los `INSERT` no se bloquean). Borrar una organización sigue funcionando.

## Frontend

| Pieza | Archivo |
|---|---|
| Pantalla `/cotizacion` (ítem *Cotización del dólar* en Administración, sección `cotizacion_dolar`) | `apps/web/src/pages/cotizacion/index.tsx` |
| Tarjeta «Vigente» con «Al día» / «Sin cargar hoy» | `apps/web/src/components/cotizacion/TarjetaVigente.tsx` |
| Diálogo de dos pasos y bloque «Qué va a cambiar» | `apps/web/src/components/cotizacion/DialogoCargarDolar.tsx`, `BloqueQueVaACambiar.tsx` |
| Historial paginado | `apps/web/src/components/cotizacion/TablaHistorial.tsx` |
| Aviso montado en Cotización y en la portada (`Home` de `App.tsx`) | `apps/web/src/components/cotizacion/AvisoCotizacion.tsx` |
| Hooks de estado, previsualización, historial y «hoy» | `apps/web/src/hooks/useCotizacion.ts`, `usePrevisualizarCotizacion.ts`, `useHistorialCargasCotizacion.ts`, `useCotizacionDelDia.ts` |

La pantalla y el diálogo se cargan de forma diferida. **Empresa activa: no aplica** (la cotización es de
la organización); cambiar de empresa no altera el contenido y hay un test que lo cubre.

## Pruebas

| Tipo | Archivos |
|---|---|
| pgTAP | `supabase/tests/database/cotizacion_carga.test.sql`, `cotizacion_recalculo.test.sql`, `cotizacion_historial.test.sql`, `cotizacion_aviso.test.sql`, más `rls_en_toda_tabla.test.sql` |
| Vitest | `apps/web/src/lib/cotizacion.test.ts`, hooks `useCotizacion`, `usePrevisualizarCotizacion`, `useCotizacionDelDia`, `useHistorialCargasCotizacion`, componentes `DialogoCargarDolar`, `BloqueQueVaACambiar`, `TablaHistorial`, `AvisoCotizacion` y `pages/cotizacion` |
| E2E | `apps/web/e2e/cotizacion-recalculo.e2e.ts` (SC-009): vigente $ 1.000 y carga 1050 → vista previa por empresa, confirma y comprueba precios; carga 1005 (0,5 %) → solo registra. Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y aborta si el Supabase no es local ([detalle](../e2e-app.md)). |

Los pgTAP cubren dos organizaciones, permisos por rol, validación, reemplazo y vencimiento de la
pendiente, umbral (1005 no recalcula, 1050 sí, justo 1 % sí), atomicidad con falla simulada, doble
confirmación, historial inmutable para todos los roles, `a_pesos` con y sin fila aplicada y `anon`.

## Decisiones abiertas y deuda

| Tema | Estado |
|---|---|
| Umbral contra la vigente o contra la aplicada | Implementado contra la **vigente** (como la fuente); con cargas chicas la diferencia se acumula sin recalcular. Cambiarlo es una línea marcada «umbral». Necesita OK. |
| «Cancelar» descarta la cotización (RF-PRE-03-7) | Implementado así; el relevamiento lo marca «supuesto a confirmar». |
| Fines de semana y feriados | El aviso corre todos los días calendario; no hay calendario hábil. Necesita OK. |
| F-PRE-06 (Etapa 2) | Alcance por empresa, umbral, redondeo y aviso configurables: fuera de alcance. |
| Mercado Libre | Publicaciones en la vista previa y el historial: Etapa 2. |
| Registro de actividad | La épica que formaliza `cotizacion.*`/`recalculo.*` no está cargada en Jira; se usa el registro existente. |

## Reversión

Migración posterior (exportar antes `cotizaciones` y `cotizacion_aplicada`): quitar las siete RPC; quitar
los triggers de inmutabilidad (primero) y `private.rechazar_cambio_cotizacion`; quitar los helpers
`private.cotizacion_vigente`, `precios_usd_por_empresa`, `precio_visible_desde_central` y
`fijar_vencimiento_cotizacion`; restaurar `private.a_pesos` para que lea solo `dominio.cotizacion_inicial`
(cuerpo de `20261022121001`); eliminar las tablas `dominio.cotizacion_aplicada`,
`dominio.cotizaciones` y `dominio.cotizacion_pendiente`. En el frontend, quitar la ruta, el ítem de menú,
el recurso `cotizacion` y los componentes/hooks. A nivel de spec, el cierre es un merge commit:
`git revert -m 1 <hash>` deshace la épica completa.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
