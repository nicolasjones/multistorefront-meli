---
owner: producto
sources:
  - specs
---

# Búsqueda de productos de la tienda online (F-TDA-15)

Historia F-TDA-15 (MSF-413) de la épica MSF-191. Spec: `specs/20261024-120000-tienda-inicio-busqueda-movil/`
(FR-020…FR-029, SC-004…SC-006). Esta guía cubre solo la búsqueda; la home y la versión móvil tienen
las suyas y las consolida `docs/tiendas-online.md` en el cierre de la épica.

## Qué ve el visitante

- **Campo «Buscar productos»** en el encabezado de todas las pantallas públicas. Al escribir (a partir de
  2 caracteres, con una espera de 400 ms entre teclas) se abre un desplegable con **hasta 6 sugerencias**:
  imagen o «Sin imagen», nombre, precio final y «Disponible» / «Sin stock». Clic o Enter sobre una
  sugerencia abre su ficha.
- **«Ver todos los resultados →»** (o Enter sin elegir una sugerencia) lleva a `/catalogo?q=<texto>`:
  título «Resultados para “<texto>”», migas «Inicio / Resultados» y los filtros, el orden, la paginación y
  la tarjeta del catálogo de siempre. `q` se conserva al cambiar filtros, orden o página y viaja en la
  URL, así que se puede compartir. Un `q` vacío es el catálogo común; en `/categoria/:id` se ignora.
- **Tolera tildes, mayúsculas y errores de tipeo**: «cargdor», «CARGADOR» y «cárgador» encuentran los
  cargadores.
- **Sin coincidencias**: el desplegable dice «No encontramos productos con ese nombre.»; la página de
  resultados usa «No encontramos productos» con «Limpiar filtros» (que conserva la búsqueda). Un texto vacío
  o de menos de 2 caracteres no muestra ningún mensaje.
- **Muchas búsquedas seguidas**: aviso anunciado a lectores de pantalla (`role="status"`) con los segundos de
  espera; al pasar el tiempo la búsqueda se repite sola, sin recargar.
- **Error de red o del servidor**: mensaje en el desplegable con «Reintentar» (el resto de la pantalla
  sigue funcionando).
- Teclado: flechas para recorrer las opciones, Enter para elegir, Esc para cerrar; también cierra el
  clic afuera. El campo es un *combobox* accesible (`aria-expanded`, `aria-controls`, `aria-activedescendant`).

## Cómo funciona

| Pieza | Dónde | Notas |
|---|---|---|
| Extensiones `unaccent` y `pg_trgm` | `20261203110000_tienda_busqueda_base.sql` | `create extension if not exists … with schema extensions`, verificadas como `pg_trgm`. |
| `private.normalizar_busqueda(text)` | ídem | minúsculas + sin tildes + espacios colapsados; `immutable` (con el diccionario `extensions.unaccent` explícito) para poder indexarla. |
| Índice `productos_nombre_busqueda_trgm` | ídem | GIN trigrama sobre `private.normalizar_busqueda(nombre)` en `dominio.productos`. |
| `public.limite_pedidos_publicos` | ídem | Contador `(visitante, ventana)`; RLS activada, sin políticas y sin privilegios para `anon`/`authenticated`. |
| `private.registrar_pedido_publico(visitante, limite)` | ídem | `insert … on conflict do update` atómico; devuelve `{limitado, espera_segundos}`; purga ventanas de más de 10 minutos. |
| `publico.sugerencias_busqueda_por_dominio(host, q)` | `20261203110100_tienda_busqueda_sugerencias.sql` | Hasta 6 productos visibles; cuenta para el límite. |
| `publico.busqueda_pagina_por_dominio(host, q, categoria, solo_con_stock, precio_max, orden, pagina)` | `20261203110200_tienda_busqueda_resultados.sql` | Misma forma y filtros que `catalogo_pagina_por_dominio` (MSF-167, intacta); relevancia por similitud. |
| Front | `lib/tiendaBusqueda.ts`, `layout/BuscadorTienda.tsx`, `rutas/catalogo.tsx`, `secciones-catalogo/ListadoProductos.tsx` | En `apps/web/src/pages/tienda-publica/`. El buscador se carga de forma diferida desde `LayoutTienda`. |

**Coincidencia.** Un producto coincide si el nombre normalizado **contiene** el texto normalizado, o si su
`word_similarity` / `similarity` con el texto alcanza el umbral (`private.umbral_similitud_busqueda()`, 0,4).
El puntaje (mayor similitud, más un bonus si el nombre empieza o contiene el texto) ordena por relevancia, con
desempate por nombre e id. El texto del visitante nunca se arma como SQL: se pasa como parámetro y se trata
como literal (`strpos` y similitud; los comodines `%`/`_` y las comillas no tienen significado). Se recorta a
100 caracteres.

**Seguridad.** Las funciones públicas viven en `publico` (solo funciones, sin tablas), son
`SECURITY DEFINER` con `search_path = ''`, normalizan el `host`, filtran por empresa activa y por visibilidad
efectiva (`private.catalogo_tienda_efectivo`) y devuelven una lista blanca de campos (nunca costos,
existencias, proveedor ni `organizacion_id`). Host desconocido y empresa desactivada devuelven lo mismo
(`null`). `revoke … from public, anon` + `grant execute … to anon, authenticated` explícito, como pide la
regla de `anon`. Las funciones `private.*` no son ejecutables por `anon`; la única excepción es
`private.normalizar_busqueda`, que también se ejecuta al mantener el índice de expresión: `authenticated` y
`service_role` (los roles que escriben productos) necesitan `EXECUTE`, y es una función pura de texto a texto
que no lee datos. Sin ese permiso, el alta/edición de productos falla con «permission denied for function».

## Límite de pedidos por visitante y minuto (D1, D3)

- **Número (D1)**: supuesto de **30 pedidos por visitante por minuto**; cada sugerencia y cada página de
  resultados cuenta uno. Vive en **un solo lugar**: `private.limite_busquedas_por_minuto()`. Cambiarlo es
  reemplazar esa función en una migración nueva (Nicolás fija el valor definitivo).
- **Quién es el visitante (D3)**: hash `sha256` de la IP del cliente en `x-forwarded-for` más el host. **Nunca
  se guarda la IP**, solo el hash. Los valores a la izquierda del cliente los puede inventar el visitante; los
  proxies de confianza agregan su IP a la derecha. Por eso se toma el valor que está
  `private.saltos_proxy_confiables()` lugares antes del último (migración `20261203110300`; hoy **0** = el
  último valor). Si la cadena real es Traefik → Kong y Kong agrega la IP de Traefik, el valor pasa a **1**
  (penúltimo) en una migración nueva. Cubierto por pgTAP (sin cabecera, una IP, un salto de proxy).
  **Pendiente de evidencia en DEV**: no hay entorno DEV accesible desde esta corrida, así que la cadena real
  no está confirmada; al desplegar, correr `select current_setting('request.headers', true)` dentro de una RPC
  pública y anotar acá el resultado. Sin cabecera todos caen en el grupo «desconocido» (el límite pega a todos
  juntos). Como el hash de una IPv4 se puede deshacer por fuerza bruta, las ventanas se purgan a los 10 minutos
  (con índice por `ventana`, `limite_pedidos_publicos_ventana_idx`).
- **Qué no cuenta**: texto vacío o de menos de 2 caracteres, y dominios desconocidos.
- **Qué pasa al superarlo**: `{limitado: true, espera_segundos}`, sin ejecutar la búsqueda; el front muestra
  el aviso y reintenta solo.

## Constantes únicas

| Constante | Valor | Dónde |
|---|---|---|
| Pedidos por visitante y minuto | 30 | `private.limite_busquedas_por_minuto()` |
| Umbral de similitud | 0,4 | `private.umbral_similitud_busqueda()` |
| Mínimo de caracteres | 2 | SQL (`c_minimo`) y `MINIMO_CARACTERES_BUSQUEDA` en `lib/tiendaBusqueda.ts` |
| Tope de sugerencias | 6 | SQL (`c_tope`) y `TOPE_SUGERENCIAS` |
| Espera entre teclas | 400 ms | `ESPERA_ENTRE_TECLAS_MS` |
| Tamaño de página | 24 | MSF-167 (`c_tamano`) |

## Esquemas (Principio VII)

Tabla nueva `public.limite_pedidos_publicos` → **`public`** (control de abuso transversal, no es dominio del
producto; RLS activada, sin `organizacion_id` porque el visitante es anónimo). Índice sobre
`dominio.productos` → `dominio`. Funciones internas → `private`; funciones de lectura anónima → `publico`.

## Reversión

Todas las migraciones son aditivas. Para deshacer la historia, en una migración posterior:

```sql
drop function publico.busqueda_pagina_por_dominio(text, text, uuid, boolean, numeric, text, integer);
drop function publico.sugerencias_busqueda_por_dominio(text, text);
drop function private.registrar_pedido_publico(text, integer);
drop function private.visitante_publico(text);
drop function private.limite_busquedas_por_minuto();
drop function private.umbral_similitud_busqueda();
drop table public.limite_pedidos_publicos;
drop index dominio.productos_nombre_busqueda_trgm;
drop function private.normalizar_busqueda(text);
```

La extensión `unaccent` se conserva. Para revertir el código completo de la historia: `git revert -m 1` del
merge de su PR.

## Pruebas

- **pgTAP** `supabase/tests/database/tienda_busqueda_publica.test.sql` (SC-004; FR-020…FR-023, FR-029):
  `pnpm test` con `pnpm dev:supabase` corriendo.
- **Vitest + axe** (SC-005): `pnpm --filter @platform/web test -- BuscadorTienda ListadoProductos RutaCatalogo`.
- **E2E** `apps/web/e2e/tienda-busqueda.e2e.ts` (SC-006) con las dos tiendas del seed:
  `pnpm --filter @platform/web e2e -- tienda-busqueda.e2e.ts`.

## Rendimiento: pendiente de medir

El índice `productos_nombre_busqueda_trgm` está sobre `dominio.productos`, pero las RPC leen de
`private.catalogo_tienda_efectivo(empresa)`; si el planificador no lo usa, el costo por pedido es proporcional
al catálogo de la tienda (`precio_final_publico` y `disponible_publico` se calculan antes de paginar). No se
midió con `EXPLAIN` en esta corrida; queda como seguimiento a medir con un catálogo grande antes de abrir
la tienda a mucho tráfico.
