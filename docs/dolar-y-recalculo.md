---
owner: producto
sources:
  - specs
---

# Dólar y recálculo (épica MSF-116 · spec `20261023-120000-dolar-y-recalculo`)

Guía de la épica: carga diaria de la cotización del dólar, vista previa de impacto, recálculo atómico de precios, historial inmutable y aviso de «no cargada hoy». Fuente de requisitos: `spec.md`; contrato de las RPC: `contracts/dolar-y-recalculo.md`. Los precios y sus fórmulas son los de [`precios.md`](./precios.md) (MSF-114).

## Modelo (Principio VII)

La cotización es de la **organización**, no de una empresa: la empresa activa de la barra superior no la cambia (Principio VIII: no aplica; las empresas solo cambian la regla que se aplica sobre el precio central).

| Objeto | Esquema | Naturaleza |
|---|---|---|
| `cotizacion_pendiente` (una por organización, vence a las 24 h) | `dominio` | dato de negocio |
| `cotizaciones` (historial de cargas confirmadas, append-only) | `dominio` | dato de negocio |
| `cotizacion_aplicada` (la cotización con la que se calculan los precios, una por organización) | `dominio` | dato de negocio |
| RPC `cargar_cotizacion`, `estado_cotizacion`, `previsualizar_cotizacion`, `confirmar_cotizacion`, `descartar_cotizacion`, `listar_cotizaciones`, `cotizacion_del_dia` | `public` | superficie de ejecución, sin datos propios |
| `private.a_pesos`, `cotizacion_vigente`, `precios_usd_por_empresa`, `precio_visible_desde_central`, `rechazar_cambio_cotizacion`, `fijar_vencimiento_cotizacion` | `private` | cálculo y triggers |

Las tres tablas tienen RLS por organización (`private.organizacion_id()`) y permisos por la sección `cotizacion_dolar`; `anon` no tiene privilegios.

## Flujo

1. **Cargar** (`cargar_cotizacion`, `edicion`): valida (> 0, hasta 4 decimales) y **reemplaza** la pendiente; no toca precios. Devuelve valor, anterior y variación.
2. **Vista previa** (`previsualizar_cotizacion`, `edicion`): solo lee. Por empresa, cantidad de precios en USD y una muestra «hoy / nuevo» (regla de la empresa; redondeo según la regla, $ 10 por defecto).
3. **Confirmar** (`confirmar_cotizacion`) o **descartar** (`descartar_cotizacion`, «Cancelar»).
4. La pendiente que pasa de 24 h se trata como inexistente al consultar (sin worker): confirmar una vencida da `P0002 sin_cotizacion_pendiente`.

## Umbral y recálculo

- El umbral es **1 %**, medido contra la cotización **vigente** (última confirmada o, sin ninguna, la inicial de MSF-114). Con variación ≥ 1 % (en valor absoluto) se recalcula; justo 1 % recalcula.
- Bajo el umbral la cotización **se registra** (queda en el historial) pero no se mueve `cotizacion_aplicada`: los precios no cambian.
- No se guarda ningún precio en pesos. «Recalcular todos los precios» es cambiar, en **una transacción**, la única fila `cotizacion_aplicada` de la organización; `private.a_pesos` lee `coalesce(aplicada, inicial)`. Por eso ninguna empresa puede quedar con un valor distinto de otra.
- «Precios recalculados» = productos activos en USD × empresas activas, el mismo número del mosaico de la vista previa.

## Atomicidad y concurrencia

`confirmar_cotizacion` toma `pg_advisory_xact_lock` por organización y `select … for update` de la pendiente; historial, cotización aplicada, borrado de la pendiente y eventos van en la misma transacción. Doble clic o dos operadores: una confirmación gana y la otra recibe `P0002` sin duplicar el historial. `descartar_cotizacion` es idempotente.

## Permisos

| Acción | Sección `cotizacion_dolar` |
|---|---|
| Ver la pantalla, `estado_cotizacion`, `listar_cotizaciones`, `cotizacion_del_dia` | `lectura` o `edicion` |
| Cargar, previsualizar, confirmar, descartar; ver la pendiente | `edicion` |

Error `42501` si el rol no alcanza. Todas las RPC hacen `revoke … from public, anon` y `grant execute … to authenticated`. `previsualizar_cotizacion`, `confirmar_cotizacion` y `descartar_cotizacion` son `security definer` (excepción acotada: leen la regla de cada empresa y escriben tablas/eventos sin escritura para `authenticated`) con `search_path = ''`, y verifican `edicion` y la organización de la **sesión** dentro de la función; nada llega por parámetro.

## Historial inmutable

Trigger de fila (`UPDATE`/`DELETE`) y de sentencia (`TRUNCATE`) en `dominio.cotizaciones`, `ENABLE ALWAYS` (corre incluso con `session_replication_role = replica` y para el dueño o `service_role`). Únicas salidas: las acciones referenciales que dispara la base (`cargada_por` pasa a null al borrar al usuario; borrado en cascada si la organización ya no existe). `listar_cotizaciones(p_limite, p_cursor)` pagina por cursor, más nueva primero, con la variación contra la fila anterior.

## Eventos (`private.insertar_actividad`, misma transacción)

`cotizacion.cargada` (al confirmar), `cotizacion.descartada`, `recalculo.aplicado` y `recalculo.omitido` (bajo el umbral).

## Aviso de «no cargada hoy»

`cotizacion_del_dia()` cuenta solo cargas **confirmadas** con fecha de hoy en `America/Argentina/Buenos_Aires`; la pendiente no cuenta. El componente `AvisoCotizacion` se monta en `/cotizacion` y en la portada; «Cargar ahora» solo se ofrece con `edicion`.

## Revisión de seguridad (FR-024)

Revisión del código de las migraciones `20261023140000…140500` y de los tests pgTAP:

- **RLS**: las tres tablas (`cotizacion_pendiente`, `cotizaciones`, `cotizacion_aplicada`) tienen RLS activo y política por organización + sección. `cotizaciones` y `cotizacion_aplicada` no tienen política ni grant de escritura para `authenticated`; `cotizacion_pendiente` solo permite insert/update de columnas concretas y delete con `edicion`. `supabase/tests/database/rls_en_toda_tabla.test.sql` recorre el catálogo y falla si alguna tabla de `public`/`dominio` queda sin RLS.
- **Esquema (Principio VII)**: las tres tablas son datos de negocio del producto → `dominio`; coincide con lo declarado en spec, migraciones y esta guía. Las RPC (sin datos propios) viven en `public`.
- **Grants de RPC y `anon`**: las siete RPC revocan a `public` y `anon` y otorgan a `authenticated`; las funciones `private.*` revocan a `public`, `anon` y `authenticated`. Los tests pgTAP de cotización cubren el caso `anon`.
- **`security definer`**: solo `previsualizar_cotizacion`, `confirmar_cotizacion` y `descartar_cotizacion`; las tres fijan `search_path = ''`, exigen `edicion` en `cotizacion_dolar` antes de leer o escribir y filtran por la organización de la sesión.
- **Inmutabilidad**: triggers `ENABLE ALWAYS` más ausencia de grants; probado para todos los roles en `cotizacion_historial.test.sql`.
- **Observación (sin cambio)**: `cotizacion_aplicada` se lee con la sección `productos`, igual que `cotizacion_inicial` (MSF-114): un rol sin acceso a `productos` que invoque `private.a_pesos` con su propia sesión cae a la cotización inicial. Es el comportamiento heredado de MSF-114.

## Pruebas

pgTAP: `cotizacion_carga`, `cotizacion_recalculo`, `cotizacion_historial`, `cotizacion_aviso`, `rls_en_toda_tabla`. Vitest: pantalla, diálogo, vista previa, historial y aviso. E2E: `apps/web/e2e/cotizacion-recalculo.e2e.ts` (1050 con vigente 1000 recalcula; 1005 solo se registra), ver [`e2e-app.md`](./e2e-app.md).

## Reversión

Las migraciones son aditivas; cada una documenta en su encabezado cómo deshacerse con una migración posterior (exportar antes los datos de `cotizaciones` y `cotizacion_aplicada`): borrar las RPC, los triggers de inmutabilidad (primero), las tablas y restaurar `private.a_pesos` al cuerpo de `20261022121001` (solo `cotizacion_inicial`). A nivel de código, el cierre de la spec es un merge commit: `git revert -m 1 <hash>` deshace la spec completa.
