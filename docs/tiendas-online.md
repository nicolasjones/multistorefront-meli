# Tiendas online: dominio e identidad

Spec: `specs/20261022-084830-tienda-dominio-e-identidad/` (épica MSF-147).
Historias: F-TDA-01 (`MSF-241`), F-TDA-02 (identidad visual, `MSF-266`), F-TDA-03 (`MSF-294`, contenido y textos comerciales), F-TDA-04 (`MSF-312`, catálogo visible).
Migraciones: `supabase/migrations/20261023100000_tiendas_dominio.sql` (F-TDA-01), `20261023100100_tienda_identidad.sql` (F-TDA-02),
`20261023100200_tienda_contenido.sql` (F-TDA-03), `20261023100300_tienda_catalogo_visible.sql` (F-TDA-04) y las que agregue cada historia.
Pruebas: `supabase/tests/database/tienda_dominio.test.sql`, `tienda_identidad.test.sql`, `tienda_contenido.test.sql`, `tienda_catalogo.test.sql`,
`apps/web/src/pages/tienda-publica/` y `apps/web/src/pages/empresas/tienda/`.

Una **tienda** es la vidriera online de una **empresa** (una por empresa, FR-001). El visitante entra
por el **dominio** de la tienda y, sin sesión, ve lo que esa tienda publica; si el dominio no está
configurado o la empresa está desactivada, ve siempre la misma página «Volvemos pronto» (FR-003). El
administrador con **edición en Empresas** configura la tienda desde Empresas (Principio VIII: opera
sobre la **empresa activa** de la barra superior).

## Esquema y RLS (Constitución, Principio VII)

| Objeto | Esquema | Justificación | RLS |
|---|---|---|---|
| `dominio.tiendas` | **`dominio`** | Entidad de negocio: la tienda de una empresa y su dominio. | Sí, por organización. |
| `publico.tienda_por_dominio(host)` | **`publico`** | Contrato de lectura anónima mínima. Esquema **solo de funciones**, sin tablas. | No aplica (función `security definer` con lista blanca). |
| `dominio.tienda_identidad` | **`dominio`** | Dato de negocio: colores, tipografías, logo y banners de la tienda de una empresa (F-TDA-02). | Sí, por organización; escritura solo por RPC. |
| `publico.identidad_por_dominio(host)` | **`publico`** | Lectura anónima de la identidad de la tienda de ese dominio (F-TDA-02). | No aplica (función con lista blanca de columnas). |
| Bucket `tienda-identidad` | `storage` | Infraestructura de plataforma: logo y banners (lectura pública). | Políticas sobre `storage.objects`. |

Columnas de `dominio.tiendas`: `id`, `organizacion_id` (FK a `public.organizaciones`), `empresa_id`
(**único**: una tienda por empresa), `dominio` (**único** a nivel plataforma, normalizado),
`created_at`, `updated_at`. FK compuesta `(empresa_id, organizacion_id)` a `dominio.empresas` para
que una tienda no cruce organizaciones.

- `anon` no tiene privilegios sobre `dominio` ni `public`; solo ejecuta las funciones de `publico`
  (y las RPC de acceso ya vigentes de `public`).
- RLS de `dominio.tiendas`: `select` para `authenticated` de la propia organización con nivel
  `lectura`/`edicion` en la sección `empresas`. **Sin política de escritura**: el dominio lo
  configura el equipo técnico (FR-004), no la app.
- El pgTAP `rls_en_toda_tabla` recorre `public` + `dominio`; `tienda_dominio.test.sql` comprueba
  además que `publico` no tiene tablas.

## Dominio, verificación DNS y certificado (F-TDA-05, MSF-198)

Desde la pestaña **Empresas › _empresa_ › Tienda › Dominio y publicación** (clave `publicacion`,
`/empresas/:id/tienda/publicacion`, solo con edición en Empresas) el administrador conecta y verifica el
dominio por su cuenta. El alta por SQL de MSF-147 sigue siendo válida (primera carga del equipo técnico).

**Qué hace la pantalla**

- «Dominio principal» y «Redirigir también» (opcional) se guardan con `public.configurar_dominio_tienda`:
  normaliza (minúsculas, sin puerto ni punto final), exige unicidad a nivel plataforma entre dominios
  principales, pendientes y de redirección de **todas** las tiendas, y crea la tienda si la empresa no tenía
  (estado vacío «Esta empresa todavía no tiene dominio»). Errores por campo: `dominio_invalido`,
  `dominio_en_uso`, `redireccion_invalida`, `redireccion_en_uso`; si falla no se guarda nada.
- **Dominio nuevo sin cortar el actual (D5)**: un principal distinto del vigente queda en
  `dominio.tiendas.dominio_pendiente` y reinicia la verificación; la tienda sigue respondiendo en el vigente.
  Cuando el pendiente queda **verificado con certificado activo**, `private.promover_dominio_pendiente` lo
  intercambia por `dominio` (el trigger deja `tienda.dominio_configurado`).
- **Tabla de registros** (Tipo, Nombre, Valor, Estado) calculada en el servidor por
  `public.obtener_dominio_tienda`: **A** `@` → IP pública, **CNAME** del «Redirigir también» → destino y
  **TXT** `_verif` → `<prefijo>=<token>` (token propio de la tienda, `dominio.tiendas.token_verificacion`).
  Estados: Correcto / Incorrecto (con el valor encontrado) / Pendiente.
- **Verificar ahora** invoca la Edge Function `verificar-dominio-tienda` (contrato en
  `openapi/verificar-dominio-tienda.json`). Una verificación cada 10 s por tienda (`demasiado_pronto`).
- **Dominio verificado** = A y TXT correctos (y CNAME si hay redirección). **Certificado**: solo con el dominio
  verificado, la función intenta una conexión TLS al dominio y valida el certificado: válido → `activo`; sin
  emitir → `pendiente`; inválido o vencido → `error`. Es una función aislada y reemplazable por el estado que
  informe el proveedor del SSL (D1: quién emite el SSL sigue **a confirmar**; el equipo técnico agrega cada
  dominio en el proveedor, esta épica no llama a su API).
- **Redirección pública**: `publico.redireccion_por_dominio(host)` (`anon`) devuelve el dominio principal si el
  host es el «Redirigir también» de una tienda activa; desconocido y desactivada responden igual (vacío). El
  front público (`TiendaPublicaApp`) la consulta cuando `tienda_por_dominio` no devuelve fila y hace
  `location.replace` al principal conservando ruta, query y hash.

**DNS de la plataforma por entorno (D2)** — `public.tienda_dns_plataforma` (fila única, solo lectura para
`authenticated`, sin secretos). La migración siembra **valores de documentación** (`203.0.113.24`,
`tiendas.plataforma.example.com`, `gc-verify`); el equipo técnico carga los reales de cada entorno por SQL:

```sql
update public.tienda_dns_plataforma
   set ip_publica = '<IP pública de la plataforma>',
       cname_destino = '<host de destino del CNAME>',
       prefijo_txt = 'gc-verify',
       updated_at = now();
```

**Edge Function `verificar-dominio-tienda`**: autentica con el JWT de la persona; `preparar_verificacion_tienda`
valida edición en Empresas, pertenencia de la empresa a su organización y el límite de 10 s, y devuelve los
hostnames **guardados** (nunca los del request); consulta DNS solo de esos hostnames y escribe con
`public.registrar_verificacion_dns`, ejecutable **solo por `service_role`** (la key vive solo en la función). La
conexión TLS solo se intenta con el dominio verificado y va a la IP de la plataforma guardada en la base
(no a una IP resuelta del DNS del usuario), validando el certificado contra el dominio. `registrar_verificacion_dns`
recibe el dominio y la redirección comprobados y rechaza (`verificacion_obsoleta`) el resultado si ya no coinciden
con los guardados. Un fallo de
red/DNS responde 502 sin tocar ningún estado guardado. Requiere `Deno.resolveDns`, `Deno.connect` y `Deno.startTls` en el
runtime de Edge Functions self-hosted: validarlo al desplegar; si no estuvieran, mover la verificación a un
worker en `workers/` con el mismo contrato.

**Auditoría** (sin valores de registros): `tienda.dominio_configurado` (también al guardar el pendiente) y
`tienda.dominio_verificado` (actor = quien pidió la verificación).

**Reversión** (solo mientras no haya datos productivos): `drop function` de `configurar_dominio_tienda`,
`obtener_dominio_tienda`, `preparar_verificacion_tienda`, `registrar_verificacion_dns`,
`private.promover_dominio_pendiente` y `publico.redireccion_por_dominio`; `drop table
dominio.tienda_registros_dns, public.tienda_dns_plataforma`; `alter table dominio.tiendas drop column …` de las
columnas nuevas (detalle en el encabezado de `20270205110000_tienda_dominio_verificacion.sql`); retirar la función
`verificar-dominio-tienda`.

### Alta técnica por SQL (primera carga)

El equipo técnico puede seguir cargando la tienda por SQL; el dominio se guarda normalizado y es único a nivel
plataforma:

```sql
insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
values ('<organizacion_id>', '<empresa_id>', 'tienda.ejemplo.com');
```

## Exposición de `publico` en la API

`publico` es un esquema nuevo con **solo funciones** de lectura anónima. Para que PostgREST lo
exponga:

- **Local**: `supabase/config.toml` → `[api] schemas` ya incluye `publico`.
- **Self-hosted (staging/producción)**: la variable del servicio PostgREST `PGRST_DB_SCHEMAS` debe
  incluir `publico` (`public,graphql_public,dominio,publico`, ver `SUPABASE_API_SCHEMAS` en
  `.env.example`). Es un cambio de configuración del VPS, sin secretos. **Reiniciar PostgREST** para
  que tome el cambio; si falta `publico`, la tienda pública responde 404 al resolver el dominio.

## Resolución por dominio (`publico.tienda_por_dominio(host)`)

Ejecutable por `anon` y `authenticated`. Normaliza el `host` (minúsculas, sin puerto ni punto final)
y devuelve **solo** `tienda_id`, `empresa_nombre` y `estado`. Un dominio desconocido, un `host`
inválido y una empresa con `activa = false` devuelven lo mismo (cero filas): no se revela si el
dominio existe (anti-enumeración). Nunca devuelve `organizacion_id` ni datos de otra tienda.

## Gestión dentro de Empresas

- Ruta canónica `/empresas/:id/tienda/:pestana`, con `:pestana` ∈ `identidad`, `contenido`,
  `catalogo`. Solo con **edición en Empresas**; sin acceso se ve el patrón de acceso restringido.
- Encabezado «Empresas › <empresa>» con el dominio y el estado («Publicada» si la empresa está
  activa), «Cambiar a <otra empresa> ↔» y «Ver tienda».
- La **empresa activa** de la barra superior (F-ROL-06) es la única fuente de verdad: «Cambiar a …»
  cambia esa misma empresa activa. Al cambiar se recargan todas las consultas, se descartan los
  cambios sin guardar con aviso y nunca se muestran datos de la empresa anterior (Principio VIII).
- Las pestañas se registran por archivo en `apps/web/src/pages/empresas/tienda/pestanas/` (cada
  historia de la épica aporta la suya) y el front público por sección en
  `apps/web/src/pages/tienda-publica/secciones/`.

## Front público

`apps/web` decide por el `Host` de la petición: si no es un host del panel (`VITE_PANEL_HOSTS`)
renderiza la tienda pública sin sesión. Un error de red no se disfraza de «Volvemos pronto»: se
ofrece reintentar.

- **Vencimiento por inactividad (MSF-673, MSF-700)**: a las 12 h sin actividad (`lib/vencimientoSesion.ts`,
  enganchado en `main.tsx`) en un host de tienda se cierra solo la sesión local (`salirCliente`) y se vuelve a `/`;
  nunca se redirige a `/login` (la tienda no lo tiene; su ingreso es `/ingresar`) ni se revoca la sesión en otros
  dispositivos. Prueba: E2E `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts`.
- **Desarrollo**: sin la variable, el panel vive en `localhost,127.0.0.1`; un subdominio de
  `localhost` (p. ej. `mundojc.localhost:4300`) es una tienda de prueba.
- **Producción**: `VITE_PANEL_HOSTS` se pasa como build arg (`apps/web/Dockerfile`) con el dominio
  del panel del entorno. **Si no se configura, no se enruta ninguna tienda y todo host sirve el
  panel** (falla seguro): la tienda pública exige configurarla explícitamente. Los dominios de
  tienda son los que **no** figuran en esa lista.
- **Listá todos los hosts del panel de cada entorno** (dominio del panel, previews, IP o nombre
  interno del VPS, `localhost`): cualquier host que no figure en `VITE_PANEL_HOSTS` se sirve como
  tienda (o «Volvemos pronto» si no hay tienda) y el panel queda inaccesible desde ahí.

## Identidad visual (F-TDA-02, `MSF-266`)

Pestaña **Identidad visual** de `/empresas/:id/tienda/identidad` (solo con edición en Empresas).

- **Tabla** `dominio.tienda_identidad` (`empresa_id` PK): cuatro colores `#RRGGBB` (Primario, Primario
  oscuro, Acento, Fondo, con `check` de formato), tipografías de Títulos y Texto contra una **lista
  cerrada** (`system-ui`, Barlow, Barlow Condensed, Playfair Display, Lato, Sora, Instrument Sans y, desde
  MSF-841, Bricolage Grotesque y DM Sans) y
  las rutas de logo, banner principal y banner móvil. Sin fila → tema base (`#222222` / blanco /
  tipografía del sistema). Las rutas deben estar en `<organización>/<empresa>/` (check en la base).
- **Supuesto sobre DS-04**: la épica remite la lista de tipografías a DS-04, pero el repo no la trae
  versionada; se usó el tema base más las fuentes de los dos temas de ejemplo
  (`apps/web/src/tema/temaTienda.ts`) y del prototipo. Se ajusta en una sola constante
  (`TIPOGRAFIAS` en `apps/web/src/lib/tiendaIdentidad.ts` y los `check`/RPC de la migración).
- **MSF-841 (tramo A del rediseño de las tiendas al prototipo)**: se sumaron las tipografías
  `Bricolage Grotesque` y `DM Sans` (migración `20270303100000_tienda_tipografias_prototipo.sql`: reemplaza
  los `check` y `private.validar_tienda_identidad`; el front ya arma la URL de Google Fonts desde la lista) y el
  quinto color **«Barra superior y pie»** (`color_barra`, `#RRGGBB`, por defecto `#222222`, migración
  `20270303200000_tienda_color_barra.sql`). `color_barra` viaja en el borrador, en las versiones (un borrador o
  una versión anterior sin la clave vale `#222222`), en `publico.identidad_por_dominio` y en la pestaña, con su
  propio chequeo de contraste AA (mismo criterio que el primario, no bloquea). Un cambio de la barra cuenta
  como «colores» en el resumen «N cambios sin publicar». `public.guardar_tienda_identidad` cambió de firma
  (parámetro final `p_color_barra`, con default; se eliminó la de 10 argumentos) y `publicar_tienda`, su único
  llamador, se recreó; sigue sin ser ejecutable por `authenticated` (F-TDA-06).
- **Escritura**: solo `public.guardar_tienda_identidad(...)` (`security definer`, exige edición en
  Empresas, estado completo, **idempotente**: si no cambia nada no escribe ni registra evento; emite
  `tienda.identidad_actualizada`). `revoke … from public, anon`, `grant execute … to authenticated`.
  La tabla no concede `INSERT`/`UPDATE`/`DELETE`, así el evento no se puede omitir.
- **Archivos**: bucket `tienda-identidad` (lectura pública; escritura `authenticated` con edición en
  Empresas bajo `<organización>/<empresa>/<archivo>`; PNG/SVG/JPG/WebP, tope 3 MB). Límites (D5): logo
  ≤ 1 MB (PNG/SVG), banners ≤ 3 MB (PNG/JPG/WebP); el tope de 1 MB del logo lo valida la app antes de
  subir. Un **SVG con etiquetas activas (`<script>`, `<foreignObject>`…), manejadores `on*` (separados por espacio o `/`), `javascript:`/`data:` (aunque lleven tab o salto de línea en el esquema), entidades, referencias externas o CSS que carga recursos externos (`@import`, `url(http…)`) se rechaza** en el navegador.
  **Límites conocidos (aceptados):** ese filtro es solo del cliente; quien suba directo por la API de Storage lo esquiva (Storage no inspecciona contenido), y el tope de 1 MB del logo tampoco se aplica en servidor (el bucket admite 3 MB). Si se exige defensa en servidor, el siguiente paso es sacar `image/svg+xml` del bucket (PNG solo). Google Fonts se carga de un tercero (se filtra la IP del visitante; sin SRI/CSP) — decisión aceptada, alternativa: autoalojar. Si el guardado falla tras subir, la app relee la identidad y borra solo las subidas que la base no referencia (si no puede releer, las conserva: la respuesta de la RPC pudo perderse tras guardar); pueden quedar huérfanos (tolerado; `borrarImagenes` limpia en el mejor esfuerzo). El
  archivo elegido queda pendiente y **se sube recién al «Guardar»**; si la subida o la RPC fallan, no
  se guarda nada, se borra lo recién subido y la imagen anterior se conserva. Al guardar se borran los
  archivos reemplazados (best-effort).
- **Contraste**: se muestra «Contraste de texto blanco sobre el primario: N,N:1 (AA)»; por debajo de
  4,5:1 es una **advertencia que no bloquea** guardar.
- **Vista previa** en vivo con los valores sin guardar («Se actualiza con tus cambios sin guardar.»):
  no escribe nada hasta «Guardar». «Descartar» vuelve al último valor guardado. La pestaña se
  recarga al cambiar la empresa activa (Principio VIII) y avisa si hay cambios sin guardar.
- **Tienda pública**: `publico.identidad_por_dominio(host)` devuelve la identidad (o el tema base si no
  hay fila; vacío si el dominio no existe o la empresa está desactivada). La sección
  `secciones/TemaTienda.tsx` aplica colores y tipografías como variables CSS `--tienda-*` y muestra
  logo y banners; devuelve **rutas** del bucket y el front arma la URL pública.
- **Reversión**: ver el encabezado de la migración (función, políticas, bucket vacío, tabla).
- **Prototipo**: `design/pantallas/StoreIdentidad.dc.html`; se omiten las miniaturas «Productos que
  aparecen en el banner de la home» (sin requisito en la spec) y el diálogo «Publicar cambios» (la
  épica adapta «Guardar y publicar» a «Guardar», que aplica de inmediato).

## Límites y valores por defecto

- Dominio: hasta 253 caracteres, con al menos un punto y TLD de 2+ letras.
- Sin fila en las tablas de identidad/contenido/catálogo, la tienda usa el tema base y no muestra
  textos opcionales (ver F-TDA-02/03/04).

## Contenido y textos comerciales (F-TDA-03, MSF-294)

Pestaña **Contenido** de la gestión (`/empresas/:id/tienda/contenido`) y textos que muestra la tienda
pública. Solo con edición en Empresas; opera sobre la empresa activa (al cambiarla se vuelve a leer y
no queda nada de la anterior).

### Esquema y RLS (Principio VII, re-verificado)

| Objeto | Esquema | Justificación | Acceso |
|---|---|---|---|
| `dominio.tienda_contenido` | **`dominio`** | Textos comerciales de quien vende (entidad de negocio). | RLS por organización; `select` con acceso a Empresas; **sin política de escritura**. |
| `public.guardar_tienda_contenido(...)` | `public` (RPC de la app) | `security definer`: exige edición en Empresas y que la empresa sea de la organización de la sesión. | `revoke … from public, anon`; `grant … to authenticated`. |
| `publico.contenido_por_dominio(host)` | `publico` | Lectura anónima con lista blanca de columnas. | `grant … to anon, authenticated`. |

Campos (`empresa_id` es la clave): `titulo`, `subtitulo`, `texto_boton`, `boton_destino`,
`bienvenida` (barra superior), `pie`, `aviso_ficha`, `texto_boton_contacto` y, desde MSF-841, `eslogan`
(frase corta, hasta **80** caracteres, vacío por defecto; migración `20270303300000_tienda_eslogan.sql`:
columna con check, validación en el borrador con `hint = 'eslogan'`, rótulo «eslogan» en el resumen de cambios
sin publicar, `publico.contenido_por_dominio` lo devuelve y la pestaña lo muestra en «Textos comerciales» con
contador). `public.guardar_tienda_contenido` cambió de firma (parámetro final `p_eslogan`, con default). Migración aditiva;
la reversión está en el encabezado de `20261023100200_tienda_contenido.sql`.

### Reglas

- **Texto plano**: se recorta (espacios de los extremos) y nunca se interpreta como HTML; el front lo
  renderiza siempre escapado.
- **Límites (D5, constantes en la migración y espejadas en `lib/tiendaContenido.ts`)**: título, texto
  del botón y texto del botón de contacto ≤ 120 caracteres; subtítulo, bienvenida, pie y aviso de
  ficha ≤ 300. La base los valida (check y RPC); la pestaña avisa por campo y no guarda nada si falla.
- **«El botón lleva a»**: lista cerrada validada en la base. Hoy solo `catalogo` («Catálogo completo», D4);
  el botón lleva a `/catalogo` («Todos los productos»); en la vista previa del panel no navega. Antes apuntaba a un ancla `#catalogo` que no existe y el click no hacía nada.
- **Vacío oculta**: un texto vacío no se muestra (barra, subtítulo, botón, pie). Sin fila, la tienda
  no muestra ningún texto opcional.
- **Guardar** aplica de inmediato; **Descartar** vuelve al último guardado. La vista previa del banner
  usa el mismo componente que la tienda pública (`BannerContenido`) con los valores sin guardar y no
  escribe. Los productos de ejemplo de la vista previa del prototipo quedan para F-TDA-04.
- **Idempotencia y auditoría**: guardar lo mismo dos veces no cambia nada ni duplica el evento;
  un cambio real registra `tienda.contenido_actualizado` (actor, empresa, fecha; el detalle nombra la
  empresa, nunca los textos).
- **Tienda pública**: `BarraBienvenida` (orden 10), `BannerHome` (20) y `PieTienda` (900), en
  `apps/web/src/pages/tienda-publica/secciones/`, comparten una sola petición por host
  (`publico.contenido_por_dominio`). `aviso_ficha` y `texto_boton_contacto` quedan guardados y
  expuestos para la ficha de producto de MSF-167.

## Catálogo visible y destacados (F-TDA-04, MSF-312)

Migración `supabase/migrations/20261023100300_tienda_catalogo_visible.sql`. Pruebas:
`supabase/tests/database/tienda_catalogo.test.sql`, `apps/web/src/pages/empresas/tienda/catalogo.test.tsx`
y la pestaña `apps/web/src/pages/empresas/tienda/pestanas/catalogo.tsx`. La sección pública mínima
`ProductosTienda` (que leía `precio_lista`) la reemplazó `DestacadosInicio` (F-TDA-10, ver «Página de inicio»).

| Objeto | Esquema | Justificación | RLS |
|---|---|---|---|
| `dominio.categorias_tienda` (`empresa_id`, `categoria_id`, `visible`) | **`dominio`** | Qué categorías muestra la tienda: regla de negocio del producto. | Sí, por organización (`select` con `lectura`/`edicion` en Empresas); sin política ni privilegio de escritura. |
| `dominio.productos_tienda` (`empresa_id`, `producto_id`, `visible`, `destacado`) | **`dominio`** | Qué productos muestra y destaca la tienda. | Ídem. |
| `public.listar_catalogo_tienda(empresa)` / `public.guardar_catalogo_tienda(empresa, categorias, productos)` | `public` (RPC) | Contrato de la app; `revoke … from public, anon`, `grant execute … to authenticated`. | Chequeo explícito en la función (`security definer`). |
| `publico.catalogo_visible_por_dominio(host)` | `publico` | Lectura anónima con lista blanca. | No aplica (función). |

- **Una fila no cruza organizaciones ni empresas**: FK compuestas `(…, organizacion_id)` a
  `dominio.empresas`, `dominio.categorias` y `dominio.productos`. **Ausencia de fila = visible y no
  destacado**; guardar un valor igual al predeterminado borra la fila.
- **Productos de la tienda**: los de `dominio.producto_empresa` (empresas que venden el producto,
  F-CAT-07). Dos tiendas con los mismos productos tienen visibilidad y destacados independientes.
- **Visibilidad efectiva** (una sola definición, `private.catalogo_tienda_efectivo`): producto
  activo **y** su fila `visible` **y** su categoría (y la categoría padre) visible; sin categoría
  depende solo de su estado y su `visible`. El motivo («No se muestra: producto inactivo» /
  «No se muestra: categoría oculta») y el resumen «N visibles, M destacados» se calculan en el
  servidor sobre los productos efectivamente visibles. Un producto que la gestión dejó con
  `visible = false` no lleva motivo (el interruptor ya lo dice).
- **Escritura**: `guardar_catalogo_tienda` recibe solo los cambios (`[{id, visible}]` y
  `[{id, visible, destacado}]`), valida pertenencia (22023 ante id ajeno, repetido, vacío o con
  formato inválido; 42501 sin edición en Empresas; P0002 empresa ajena), toma un candado por tienda
  y es transaccional e idempotente. Emite `tienda.catalogo_actualizado` (empresa, actor, fecha; sin
  ids) solo ante cambios reales.
- **Función pública**: devuelve categorías visibles y productos efectivamente visibles (destacados
  primero) con `id`, `nombre`, `moneda`, `precio`, `tiene_imagen` (booleano), `categoria_id` y `destacado`.
  **Nunca** costos, stock, SKU, proveedor ni ids de organización. Las categorías visibles son las de la
  organización (el árbol es compartido entre sus tiendas; es intencional). Dominio desconocido o empresa
  desactivada devuelven `null`. Precio y stock de la gestión son de lectura (D2).
- **Imágenes**: la función devuelve solo `tiene_imagen`: la ruta del bucket privado `productos-imagenes`
  lleva el id de la organización y no se expone a `anon`. Servirla al público (URL firmada o bucket público) es parte de la
  tienda navegable (MSF-167).

Reversión: ver el encabezado de la migración (tablas y funciones nuevas; `drop` en orden inverso,
solo mientras no haya datos productivos).

## Cierre de la épica (MSF-147): seguridad y verificación

**Revisión de seguridad (SC-005)** — hecha sobre las migraciones `20261023100000…100300`, el front
público y la gestión:

- `anon` ejecuta **solo** funciones del esquema `publico` (`tienda_por_dominio`, `identidad_por_dominio`,
  `contenido_por_dominio`, `catalogo_visible_por_dominio`); las tablas `dominio.tiendas`,
  `tienda_identidad`, `tienda_contenido`, `categorias_tienda` y `productos_tienda` nacen con
  `revoke all … from public, anon, authenticated` y `select` solo para `authenticated` (con RLS por
  organización). Lo confirman los pgTAP `tienda_dominio`, `tienda_identidad`, `tienda_contenido` y
  `tienda_catalogo` (T020/T027) y la prueba global de `anon` (solo RPC de acceso en `public`).
- Cada RPC de `public` (`guardar_tienda_identidad`, `guardar_tienda_contenido`, `listar_catalogo_tienda`,
  `guardar_catalogo_tienda`) lleva `revoke … from public, anon` y `grant execute … to authenticated`
  explícitos en su migración, más el chequeo de «edición en Empresas» dentro de la función.
- **Enumeración de dominios**: dominio desconocido, host inválido y tienda desactivada devuelven lo mismo
  (sin filas / `null`); nunca se devuelve `organizacion_id`.
- **SVG**: se rechaza en el navegador un SVG con `<script>`, manejadores, `javascript:`/`data:` o
  recursos externos (`apps/web/src/lib/tiendaIdentidad.ts`, con tests). Límite aceptado ya
  documentado arriba: el filtro es solo del cliente; el logo se muestra con `<img>`, donde el SVG no
  ejecuta scripts.
- **Textos escapados**: bienvenida, pie y títulos se renderizan como texto de React (sin
  `dangerouslySetInnerHTML` en `pages/tienda-publica` ni `pages/empresas/tienda`).
- **Secretos**: ninguna clave de servicio llega al navegador; el E2E siembra desde Node y aborta si
  `SUPABASE_URL` no es local.

**Verificación integrada (SC-003)**: `apps/web/e2e/tienda-dos-dominios.e2e.ts` abre
`mundojc.localhost` y `sanjavucho.localhost` (dominios del seed) y comprueba que identidad (color
primario), textos (bienvenida y pie) y catálogo visible (un producto oculto no aparece) de cada
tienda no se mezclan con los de la otra. Se corre con `pnpm dev:supabase` y
`pnpm --filter @platform/web test:e2e tienda-dos-dominios` (ver `docs/e2e-app.md`).

**Contradicciones prototipo ↔ épica (para la descripción del PR)**: (1) el prototipo dibuja
borrador/publicación («Guardar y publicar», «Publicar cambios», versiones); la épica no tiene
borrador, así que se entrega un único «Guardar» que aplica de inmediato y los diálogos de
publicación quedan fuera de alcance (F-TDA-06/07). (2) La vista previa «sin publicar» se adapta a una
muestra en vivo con los valores sin guardar.

## Disponibilidad visible (F-TDA-18, MSF-332, épica MSF-167)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/` (FR-020…FR-023, SC-009).
Migración: `supabase/migrations/20261023150100_tienda_disponibilidad_publica.sql` (aditiva; reversión: `drop function private.disponible_publico(uuid)`).
Pruebas: `supabase/tests/database/tienda_disponibilidad_publica.test.sql`, `apps/web/src/pages/tienda-publica/disponibilidad/EtiquetaDisponibilidad.test.tsx` y `apps/web/e2e/tienda-disponibilidad.e2e.ts`.

| Objeto | Esquema | Justificación |
|---|---|---|
| `private.disponible_publico(p_producto uuid) → boolean` | **`private`** | Lógica interna de la tienda; sin tablas nuevas y sin `execute` para `anon`/`authenticated` (la usan las funciones `publico.*` de F-TDA-12/13). |

- **Criterio único**: `true` si `dominio.existencias.cantidad > 0`, igual que `private.productos_con_stock()`. El reservado queda fuera de la cuenta; cuando Stock lo cierre se cambia solo esta función (FR-021).
- **Solo el booleano**: la función, la etiqueta y las respuestas públicas nunca exponen cantidades, mínimos ni «Últimas unidades» (FR-023). La elección manual `a_pedido` / `stock_entrante` se ignora.
- **`EtiquetaDisponibilidad`** (`pages/tienda-publica/disponibilidad/`): texto «Disponible» / «Sin stock», comunicado con texto y no solo color; la reutilizan la tarjeta (F-TDA-12) y la ficha (F-TDA-13).
- El E2E verifica «Disponible»/«Sin stock» en tarjeta y ficha apenas esas rutas existan en la épica; hasta entonces solo comprueba que la página de inicio no publica cantidades.

## Navegación por categorías (F-TDA-11, MSF-386, épica MSF-167)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/` (FR-001…FR-008, FR-060).

- **Base**: `publico.categorias_por_dominio(host)` (migración `20261023150000_tienda_categorias_publicas.sql`,
  esquema `publico`, **sin tablas nuevas**). `SECURITY DEFINER`, `stable`, ejecutable por `anon`. Devuelve
  `{ categorias: [{ id, nombre, padre_id, productos }] }` con las categorías visibles de la tienda del host
  (la categoría y su padre, misma regla que `catalogo_visible_por_dominio`), en el orden de Catálogo, y
  `productos` = solo los efectivamente visibles de esa categoría. Host desconocido, inválido y empresa
  desactivada devuelven el mismo `null`. Nunca `organizacion_id` ni columnas internas.
  Reversión: `drop function publico.categorias_por_dominio(text);`.
- **Foto de categoría (MSF-841, `20270303400000_tienda_categorias_imagen.sql`)**: cada categoría trae además
  `imagen`: la ruta de storage (bucket `productos-imagenes`) de la imagen principal (menor `posicion`) de UN
  producto efectivamente visible de la categoría o de sus subcategorías (el primero por nombre y, en empate,
  por id); `null` si ninguno tiene imagen. No hay campo de configuración. Se calcula **en una sola pasada**
  (CTE materializados `efectivos` → `img_producto` → `imagen` con `distinct on`, sobre el árbol recursivo ya
  calculado), sin subconsultas por fila ni funciones por producto, porque la función corre bajo `anon` con
  `statement_timeout` de 3 s (ver el bug de MSF-825 abajo). La ruta cuelga de `<organización>/<producto>/`,
  igual que la `imagen` de los destacados. Desde MSF-846 (`20270305100100_tienda_vista_previa_categorias_imagen.sql`) la vista previa de la gestión (`public.vista_previa_tienda`) también la devuelve, con la misma regla sobre los productos efectivos del borrador, y el panel muestra la foto de categoría.
- **Front** (`apps/web/src/pages/tienda-publica/`): `EnrutadorTienda` registra por archivo las rutas de
  `rutas/*.tsx` (excluye `*.test.tsx`; carga diferida; contrato en `rutas/LEEME.md`: `inicio.tsx` → `/`, `<nombre>.tsx` →
  `/<nombre>` y `/<nombre>/:<nombre>Id`) más `*` → `PaginaNoEncontrada`. `layout/LayoutTienda` pone la marca
  (h1 solo en la home), el menú de categorías y la columna «Categorías» del pie; comparte tienda, host y
  categorías por el outlet (`useContextoTienda`). `rutas/categoria.tsx` resuelve `/categoria/:categoriaId`
  contra las categorías visibles (migas «Inicio / <Categoría>», título y el listado de
  `secciones-catalogo/*.tsx`, que aporta F-TDA-12); inexistente, oculta, ajena o id inválido → la misma 404.
- **Cargas**: una sola llamada de categorías por tienda (hook `useCategoriasTienda`); si falla, el menú queda
  en «Inicio» con «Reintentar».
- **Pruebas**: pgTAP `tienda_categorias_publicas`, Vitest + axe (`EnrutadorTienda.test.tsx`, 320/768/1440 px) y
  E2E `e2e/tienda-categorias.e2e.ts` con las dos tiendas del seed.

## Corrección de la demo frente al prototipo (MSF-825, bugs MSF-826…MSF-832)

Registro del bug: `.specify/bugs/tienda-demo-categorias-y-catalogo-timeout/`.

- **Causa raíz de «sin catálogo, sin categorías»**: las dos funciones públicas más usadas respondían HTTP 500
  («canceling statement due to statement timeout», tope de 3 s de `anon`) con el volumen real de la demo
  (2.204 productos publicados por tienda). Medido en dev: `categorias_por_dominio` tardaba 2,5–4 s (el conteo
  se reevaluaba una vez por categoría, ~170 veces) y `catalogo_pagina_por_dominio` ~54 s (calculaba el precio de
  TODOS los productos con `precio_vigente_empresa`, ≈ 20 ms cada uno, antes de paginar). Sin esas dos, el menú
  quedaba sin categorías, la home sin tarjetas y `/catalogo` sin listado, contador ni «Ordenar por».
- **Migración** `20270228300400_tienda_publica_rendimiento_y_categorias.sql` (misma firma y campos, sin tablas):
  `categorias_por_dominio` materializa el conteo (una pasada: 4 s → 30 ms en la base de prueba), **solo devuelve
  categorías con productos visibles** y `productos` **incluye las subcategorías** (la raíz «Consolas» suma sus
  hijas); `catalogo_pagina_por_dominio` calcula el precio con las mismas funciones y la misma regla que
  `precio_vigente_empresa` pero sin la función envoltorio y solo para los 24 de la página cuando el orden y los filtros no necesitan el precio (15 s → ~0,3 s; con orden o tope de precio ~1 s) y filtrar por una categoría **incluye su
  subárbol**, de modo que el número de la tarjeta coincide con el listado al entrar. El subárbol se limita a la
  organización de la tienda (aislamiento). Reversión: reaplicar las definiciones de
  `20261023150000_tienda_categorias_publicas.sql` y `20270221100004_tienda_precio_anterior.sql`. Las tres
  migraciones de esta historia (`20270228300400`, `20270228300500` y `20270228300600`) están **renumeradas**
  sobre `20270228100000`…`20270228100101` para quedar por encima de la máxima de `origin/dokploy` y no
  compartir versión con las migraciones de otras historias (`verificar-migraciones` falla con «versión REUSADA»
  si la versión queda por debajo de la base).
- **Categorías principales** (`lib/tiendaCategorias.ts`, `categoriasPrincipales`): menú de escritorio y móvil,
  tarjetas de la home y pie muestran las raíces con productos de mayor a menor cantidad, hasta **6** (el
  prototipo), sin nombres repetidos, más «Más categorías» / «Ver todas las categorías» hacia `/catalogo`. La
  tienda controla qué entra ocultando categorías en su configuración (`categorias_tienda.visible`); una tienda
  nueva sin configuración usa las de mayor cantidad. El panel del catálogo (`filasPanelCategorias`) muestra las
  raíces y despliega, con sangría, solo la rama de la categoría elegida, en orden de árbol.
- **Mundo JC y San Javucho (MSF-832)**: la base ya filtraba por tienda. En dev ambas publican **los mismos 2.204
  productos** (con precios propios), por eso las categorías y los conteos coinciden: es el dato de la demo, no una
  fuga. El aislamiento se prueba en pgTAP (`tienda_categorias_publicas`: la tienda de otra organización solo ve
  sus categorías).
- **Nombres sin prefijo de importación (MSF-828)**: la base (`private.normalizar_producto`, migración
  `20270228300500_productos_nombre_sin_prefijo_de_importacion.sql`) quita «&ua», «&u+», «&+», «&uu»… del nombre y
  de la descripción en todo alta y edición, y limpió lo ya cargado; el front público además limpia al mostrar
  (`lib/tiendaTextos.ts`: prefijo, entidades HTML comunes y espacios). Una descripción igual al nombre se omite
  en la ficha (el nombre aparecía tres veces). La helper `private.quitar_prefijo_importacion` necesita
  privilegio de ejecución para el rol de la app (el disparador corre como el rol que escribe y
  `public.crear_producto` es `security invoker`): lo concede
  `20270228300600_prefijo_importacion_permiso_de_ejecucion.sql` (sin él, el alta y la edición de productos
  fallaban con «permission denied for function quitar_prefijo_importacion»).
- **Contacto (MSF-831)**: «Respondemos dentro de las 24 h» y «Retiro y envíos»; ver `docs/tienda-contacto.md`.
- **Ficha (MSF-829)**: ya tenía WhatsApp, galería, «Sin imagen», «Sin stock» y relacionados; lo que fallaba era
  el nombre repetido y las categorías de la barra. Pendiente de verificar en dev tras el despliegue.

## Catálogo con filtros y orden (F-TDA-12, MSF-355, épica MSF-167)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/` (FR-030…FR-041, SC-004, SC-005, SC-006).
Migración: `supabase/migrations/20261023150200_tienda_catalogo_publico.sql` (aditiva, **sin tablas**).
Reversión (migración posterior): `drop function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer); drop policy productos_imagenes_select_anon on storage.objects; drop function publico.imagen_publica(text); drop function private.imagen_publica(text); drop function private.precio_final_publico(uuid, uuid);`.
Pruebas: pgTAP `tienda_catalogo_publico`, Vitest + axe (`ListadoProductos.test.tsx`, `RutaCatalogo.test.tsx`, `lib/tiendaListado.test.ts`) y E2E `e2e/tienda-catalogo.e2e.ts` con las dos tiendas del seed.

| Objeto | Esquema | Justificación |
|---|---|---|
| `private.precio_final_publico(producto, empresa) → numeric` | **`private`** | Lógica interna de Precios; sin `execute` para `anon`/`authenticated`. |
| `private.imagen_publica(ruta) → boolean` | **`private`** | Respalda la lectura anónima de imágenes; sin `execute` para ningún rol de API. |
| `publico.imagen_publica(ruta) → boolean` | **`publico`** | Envoltorio `SECURITY DEFINER` para la política de `anon`: así `anon` no necesita `USAGE` sobre `private`. |
| `publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina) → jsonb` | **`publico`** | Lectura anónima con lista blanca de campos; `publico` sigue sin tablas. |
| política `productos_imagenes_select_anon` sobre `storage.objects` | plataforma (storage) | Lectura de `anon` acotada a imágenes de productos visibles de tiendas activas. |

- **Página del catálogo**: `{ total, pagina, tamano: 24, categorias[], productos[] }`; cada producto trae solo `id`, `nombre`, `precio`, `disponible`, `imagen`, `categoria_id` y `destacado`. El tamaño 24 es una constante de la función (D3). Host desconocido y empresa desactivada devuelven el mismo `null`.
- **Filtros**: categoría (los productos de una categoría oculta o ajena no son «efectivos»: lista vacía, sin error), «Solo con stock» (por `private.disponible_publico`) y precio máximo sobre el precio final. **Orden**: relevancia (destacados, nombre, id), menor y mayor precio (desempate por nombre e id; los sin precio van al final).
- **Normalización** (sin error): orden desconocido → relevancia; página < 1 o nula → 1; `precio_max` ≤ 0 o nulo → sin límite; página fuera de rango → lista vacía con el `total` real.
- **Precio público**: regla de la empresa (`a_pesos` → `aplicar_regla_precio`) y, **según el interruptor «Precios que ve el cliente»** de la empresa, `aplicar_iva` (con IVA = `precio_para(...).final`; sin IVA = `precio_para(...).neto`). Resuelve la alícuota inline (la propia del producto o la de su categoría) porque `private.alicuota_producto` se acota a la sesión y bajo `anon` no devolvería nada; el pgTAP de paridad con `private.precio_para` evita la deriva. Sin precio calculable (USD sin cotización) el precio es `null`: la tarjeta no muestra precio, queda al final de los órdenes por precio y no pasa el filtro de precio máximo (D9).
- **Costo y techo esperado**: la RPC es pública y calcula `precio_final_publico` y `disponible_publico` para todo el catálogo efectivo de la tienda antes de filtrar y paginar, y lee las categorías en cada página. El diseño asume **hasta unos pocos cientos de productos visibles por tienda** (cifra de diseño, no medida); por encima conviene calcular el precio solo al filtrar u ordenar por precio y medir con un benchmark. Seguimiento de rendimiento fuera de esta historia: no hay catálogo real que lo justifique todavía.
- **`publico.imagen_publica` es invocable directo** por `anon` y `authenticated`: permite confirmar si una ruta de storage es imagen pública, algo que esas rutas ya permiten leer; riesgo bajo aceptado (anotado en el comentario de la función).
- **`?pagina=` en la UI (MSF-845)**: el listado ya no pagina; los enlaces viejos con `?pagina=N` (también `0`, negativos o `999`) se ignoran sin redirigir y arrancan de la primera tanda. La RPC sigue devolviendo lista vacía con el `total` real para una página fuera de rango, y la UI ya no la pide.
- **Imágenes (D1, supuesto)**: el bucket `productos-imagenes` sigue privado. `anon` lee solo las imágenes que `private.imagen_publica` acepta (producto activo, no oculto, categoría visible, en una tienda activa). Como un `<img>` no manda cabeceras, `lib/imagenProducto.ts` pide **URLs firmadas** de una hora con la clave pública, en una sola llamada por página; se piden al cargar, así que en una pestaña abierta más de una hora vencen y la tarjeta cae a «Sin imagen» (`onError`) hasta recargar. Si D1 se resuelve distinto (URL pública o firmada por el servidor), cambia solo ese archivo y la política. La ruta (`<organización>/<producto>/<archivo>`) viaja en `imagen`: el id de organización no es un secreto (es un UUID sin valor de acceso) y el contrato de la épica la define así.
- **Front** (`apps/web/src/pages/tienda-publica/`): `rutas/catalogo.tsx` (`/catalogo`: título «Todos los productos», migas y el listado), `secciones-catalogo/ListadoProductos.tsx` (también montado por `/categoria/:categoriaId` con la categoría fija del path), componentes en `catalogo/` (panel de filtros, «Ordenar por», tarjeta, estado vacío; el pie del listado es `CargaInfinita`, ver «Carga infinita en los listados»), `lib/tiendaListado.ts` (cliente de la RPC y parser/serializador de la URL) y el hook `hooks/useCatalogoPublico.ts`.
- **URL compartible**: `categoria`, `stock=1`, `max=<pesos>`, y `orden=<relevancia|precio_asc|precio_desc>` (sin número de página desde MSF-845); abrir la URL restaura el estado; cambiar un filtro u orden reinicia la lista desde la primera tanda; los valores inválidos se ignoran. Filtrar no recarga la página (navegación del lado del cliente).
- **Diferencias con el prototipo** (anotadas para el PR): el prototipo no dibuja paginación ni carga infinita (desde MSF-845 el listado usa carga infinita); «Últimas unidades · quedan N» queda fuera (expone stock exacto); el buscador del encabezado es de MSF-191.

## Carga infinita en los listados (MSF-845)

Regla del repo («Listados: carga infinita con lazy loading, sin paginación») aplicada a la tienda pública a pedido de Nicolás: «en todas las tiendas quiero lazy loading infinito».

- **Alcance**: el único listado público paginado era el de productos (`secciones-catalogo/ListadoProductos.tsx`), que montan `/catalogo`, `/categoria/:categoriaId` y los resultados de búsqueda (`/catalogo?q=`). Se eliminó `catalogo/Paginacion.tsx` y no queda ningún `Pagination` en la tienda pública.
- **Cómo carga**: `hooks/useCatalogoPublico.ts` pide la primera tanda al cambiar host, filtros, orden o `q` y expone `cargarMas`, `hayMas`, `cargandoMas` y `errorMas`; cada tanda es una llamada a la misma RPC (`catalogo_pagina_por_dominio` o `busqueda_pagina_por_dominio`, de a 24) con `pagina` creciente, más un firmado en lote de las imágenes de esa tanda. Se suman a lo ya mostrado sin repetir productos. Una tanda vacía con total mayor corta la carga (no se pide sin fin). **Sin cambios de base ni migraciones.**
- **Pie de lista**: el componente compartido del panel `components/pagina/CargaInfinita` (`IntersectionObserver` con margen de 400 px, «Cargar más» operable con teclado y única vía sin `IntersectionObserver`, estado «Cargando más resultados», error «No pudimos cargar más resultados.» con «Reintentar» que conserva lo ya cargado, y «No hay más resultados.» al terminar). El contador total («N productos») sigue arriba.
- **Reinicio**: buscar, filtrar, ordenar o cambiar de categoría vuelve a la primera tanda y descarta lo acumulado; `q` y los filtros siguen en la URL, que no cambia al cargar más.
- **Accesibilidad y reinicio**: el botón «Cargar más» sigue montado (`aria-busy`) mientras carga para no perder el foco, una región viva (`aria-live`) anuncia «Cargando más resultados», «N productos más cargados» y «No hay más resultados», y al cambiar filtro, orden o búsqueda el scroll vuelve al inicio del listado. Si una tanda siguiente de búsqueda choca con el límite de pedidos se avisa «Hiciste muchas búsquedas seguidas, esperá unos segundos y reintentá» y «Reintentar» queda deshabilitado hasta que pase la espera. Limitación: al volver desde la ficha no se conservan las tandas ya cargadas; sin virtualización (diseño pensado para pocos cientos de productos; seguimiento si un catálogo supera ~500).
- **Enlaces viejos `?pagina=N`**: se ignoran (no rompen, no redirigen) y se arranca de la primera tanda; no se reconstruye la página N porque la carga infinita no tiene un «punto de entrada» equivalente y sería traer N tandas de golpe. Al cambiar un filtro el parámetro desaparece de la URL.
- **SEO**: sin cambios. Canónica (`/catalogo`, `/categoria/<id>`) y `noindex` de búsqueda y errores como estaban; las URLs de listado nunca llevaron `pagina` en la canónica.
- **Elementos nuevos visibles**: solo los de la regla del repo («Cargar más», estados de carga/error/fin); ni el prototipo ni sus inventarios (`MJC_Catalogo`, `SJ_*`) dibujan paginación ni carga infinita. Detalle en `specs/20270304-100000-tiendas-carga-infinita/spec.md`.
- **No verificado en navegador**: los E2E `tienda-catalogo.e2e.ts` se actualizaron pero no se corrieron al implementar (requieren el stack local).

## Seguimiento del front: menú y carga infinita (MSF-846, parte B)

- **Menú de categorías**: la barra del encabezado (`layout/MenuCategorias.tsx`) mide el ancho real de cada entrada (copia invisible, con el texto en un pseudo-elemento) y la lista visible con `ResizeObserver`, y muestra solo las categorías principales que entran (`cuantasEntran` en `lib/tiendaCategorias.ts`), reservando el lugar de «Más categorías» (`/catalogo`) para el resto. Así, con una tipografía ancha (San Javucho a 1440 px, Bricolage Grotesque) no desborda ni corta la última entrada; vuelve a medir al cambiar el ancho o cargar la fuente. Mismo estilo del prototipo (mayúsculas, subrayado de la activa). La copia de medida va en un contenedor recortado (`overflow:hidden`) para no agregar scroll horizontal a la página. Sin `ResizeObserver` se muestran todas y la barra desplaza en horizontal.
- **Carga infinita** (`components/pagina/CargaInfinita`, compartida con el panel): el foco pasa de «Reintentar» a «Cargar más» (y de vuelta si falla otra vez, o al aviso si «Reintentar» espera) en vez de caer al body (solo si el foco se perdió: no se le roba a quien pasó a otro campo); el aviso de espera por límite de búsquedas se anuncia una sola vez (`role=alert`, con la región viva vacía en error); «Cargar más» se ve apagado (`aria-disabled`) mientras carga; y `useCatalogoPublico` descarta lo acumulado en el mismo render en que cambia la clave, así A→B→A no muestra la lista vieja.
- **E2E**: `tienda-*.e2e.ts` ajustados al DOM actual (navegación «Categorías» exacta frente a «Categorías del pie»; headings de la home dentro de `<main>`; bloque de consultas; no desborde de la barra). No se corrieron (requieren el stack local). Spec: `specs/20270305-100000-tiendas-seguimiento-front/`.

## Hallazgos de la pasada de pruebas en dev (MSF-846, parte C)

- **Encabezados del listado (axe `heading-order`)**: las tarjetas de producto usan `h3`; el listado del catálogo, la categoría y los resultados de búsqueda (`secciones-catalogo/ListadoProductos.tsx`) antepone un `h2` solo para lectores de pantalla («Productos», o «Resultados» con `?q=`), así en celular (donde el panel de filtros está cerrado) ya no se salta de `h1` a `h3`. No cambia lo visible.
- **Barra superior (axe `region`)**: `layout/BarraSuperior` va ahora dentro del `<header>` (landmark banner) de `LayoutTienda`, con lo que el eslogan y el contacto dejan de quedar fuera de todo landmark. Mismo aspecto.
- **`useEmpresa` sin id**: mientras la empresa activa no resolvió (`id` indefinido) el hook no consulta (antes pedía `empresas?id=eq.` y daba 400 en cada pestaña de `/empresas/:id/tienda/*`), queda `cargando` (sin parpadeo de «no encontrada») y `actualizar`/`cambiarEstado` rechazan sin llamar a la base.
- **Vista previa fiel a la tienda**: la migración `20270306100000_tienda_vista_previa_categorias_paridad.sql` hace que `public.vista_previa_tienda` cuente las categorías como `publico.categorias_por_dominio` (total del árbol, con descendientes, sobre los productos efectivos del borrador) y omita las que quedan sin productos. El front de la vista previa ya usaba la regla de «categorías principales» de `lib/tiendaCategorias.ts` (por cantidad de productos), que ahora recibe los mismos datos que la tienda. Mismos grants y guardia (solo `authenticated`, `search_path` vacío); sin tablas nuevas (Principio VII). Reversión: una migración posterior que restituya el cuerpo de `20270305100100_tienda_vista_previa_categorias_imagen.sql`. Prueba pgTAP: `supabase/tests/database/tienda_vista_previa_categorias_paridad.test.sql` (paridad con la pública y borrador). Spec: `specs/20270313-100000-tiendas-hallazgos-qa/`.

## Fidelidad con el prototipo (MSF-847)

La tienda pública se llevó a las medidas del prototipo (`design/pantallas/MJC_*`, `SJ_*`; spec `specs/20270314-100000-tiendas-fidelidad-prototipo`). Se midió con Playwright y `getComputedStyle`
a 1440 px y 390 px, en MundoJC y San Javucho, contra el prototipo local y contra dev; los cambios se verificaron sobre una build local servida desde la URL de dev. Resumen (escritorio, MundoJC):

| Elemento | Prototipo | Antes (dev) | Después |
|---|---|---|---|
| Contenido | 1200 px | 1168 px | 1200 px (`layout/medidas.ts`, máximo 1232) |
| Tarjeta: borde / radio / relleno | 1 px `.08` / 8 / 14 | 1 px `.12` / 4 / 12 | igual al prototipo |
| Tarjeta: imagen | cuadrada, `contain` al 86 % sobre superficie | cuadrada, `cover` (recorta) | `contain` al 86 %, sin recorte; «Sin stock» como insignia de 10 px |
| Tarjeta: nombre | 16 px/500, interlínea 1,3, alto 42 px (2 líneas) | 16 px/600, interlínea 28 px, hasta 4 líneas | 16 px/500, 20,8 px, alto 42 px con recorte a 2 líneas |
| Tarjeta: precio | 22 px/700, títulos, primario | 20 px/500, color de texto | 22 px/700, títulos, primario |
| Tarjeta: disponibilidad | 13 px/500 con punto de 8 px | 14 px/600 sin punto | 13 px/500 con punto de 8 px (#2E7D32 / #6B6B6B) |
| Tarjeta: alto total | 410 px | 369–412 px | 410 px |
| Grilla | 4 × 282 px (24 px) portada y relacionados; 304 px en catálogo; 2 × 173 px (12 px) en celular | 5 × 168–181 px (16 px) | 4 / 3 / 2 columnas fluidas (`GrillaProductos`) |
| Barra de categorías | Barlow 15 px/600 mayúsculas | Barlow Condensed | Barlow |
| Migas / título del catálogo | 14 px, 18 px de aire / 44 px/700 | 16 px / 34 px/400, espaciado −1,87 px | igual al prototipo |
| Panel de filtros | 260 px; títulos 18 px títulos; filas 15 px; casilla; campo de 40 px | 240 px; 16 px; MUI `List`, botón con mayúsculas, campo flotante | igual al prototipo |
| Portada: héroe | 440 px a todo el ancho, título 72 px/700 mayúsculas, botón 16 px/700 de 47 px | texto de 34 px/400 y botón de 14 px | igual (sin las tarjetas del héroe: no hay datos) |
| Portada: categorías | 186 px (16 px de separación) | 181 px con borde | 186 px; en celular, píldoras |
| Ficha | galería 600 px, miniaturas 84 px, título y precio 44 px, botones 16 px/700 radio 8 | 568 px, 72 px, 34 px / 24 px, botones 14 px/700 mayúsculas radio 4 | igual al prototipo |
| Contacto | columna 460 px con círculos de 44 px; tarjeta con rótulos arriba; campos de 44 px | 560 px sin íconos; campos con rótulo flotante | igual al prototipo |
| Celular | encabezado 60 px (menú, logo centrado), menú de 300 px, h1 30 px, tarjetas de 173 px | logo a la izquierda y menú a la derecha, menú de 320 px, h1 34 px | igual (tarjetas de 175 px fluidas) |

- **Tema** (`tema/temaTienda.ts`): títulos en negrita, `lineHeight`/`letterSpacing` `normal`, botones sin mayúsculas, 700 y radio 8. El color de texto y el fondo de la tienda se aplican al layout (antes los elementos sin
  `Typography` salían con el color del panel).
- **Grillas** (`catalogo/GrillaProductos.tsx`): `columnas={4}` en la portada y los relacionados, `columnas={3}` en el catálogo y la categoría; 2 columnas y 12 px de separación en celular, 24 px desde `md`.
- **Diferencias conocidas** (no son del layout): colores de texto del tenant (#1A1A1A en la demo, no #1F1F1F) y gris secundario derivado con contraste AA (#6A6A6A, no #5F5F5F); «Ingresar» (F-CLI-06) y «Compartir» (F-TDA-25) no están en el prototipo; la barra de «Información» y el bloque legal del pie;
  las tarjetas del héroe y las categorías sin productos; en celular, las migas, el bloque de consultas, los puntos de la galería (la tienda mantiene miniaturas) y el orden de «Filtrar» respecto del título; «Últimas unidades» no existe (FR-023);
  el diálogo de WhatsApp no se midió en este tramo.
- **Desvíos accesibles respecto del prototipo**: «Sin imagen» y los placeholders usan el gris secundario del tema (≥ 4,5:1; el prototipo usa negro al 35 %/45 %, ≈ 2,4:1); los campos de contacto y filtros y la casilla «Solo con stock» dibujan un foco visible (borde y contorno primarios de 2 px).
- **Sin scroll horizontal**: la franja del héroe es una capa de 100vw con las franjas inclinadas recortadas y el layout lleva `overflow-x: clip`; se midió `scrollWidth == clientWidth` a 320, 390, 768, 900, 1024, 1100, 1200, 1280, 1366 y 1440 px en las dos tiendas y el E2E `tienda-inicio.e2e.ts` lo vigila en la portada a 900/1024/1280.
- **Pruebas**: Vitest de la tarjeta, las grillas (la parte por ancho se lee en el texto de la hoja: jsdom no evalúa `@media`) y las piezas compartidas, más axe real de Chromium sobre una build local; los E2E de `apps/web/e2e/tienda-*.e2e.ts` siguen válidos por sus locators y no se corrieron localmente (los valida el CI).

## Ficha de producto (F-TDA-13, MSF-372, épica MSF-167)

Migración **aditiva** `20261023150300_tienda_ficha_publica.sql`. Reversión (migración posterior): `drop function publico.producto_por_dominio(text, uuid);`.

### Esquema (Principio VII, re-verificado)

| Objeto | Esquema | Justificación |
|---|---|---|
| `publico.producto_por_dominio(host, producto) → jsonb` | **`publico`** | Lectura anónima con lista blanca de campos; `publico` sigue sin tablas. `execute` para `anon` y `authenticated`. |

No se crean ni alteran tablas. Reutiliza `private.catalogo_tienda_efectivo` (visibilidad efectiva), `private.precio_final_publico` (F-TDA-12) y `private.disponible_publico` (F-TDA-18).

### Reglas

- **Qué devuelve**: `id`, `nombre`, `descripcion`, `sku`, `categoria {id, nombre}`, `precio` (final de la empresa, con el mismo interruptor de IVA que el catálogo), `disponible` (solo el booleano), `compatibilidad` (texto con los valores de `compatible_con` unidos por coma, `null` si no hay) e `imagenes [{posicion, ruta}]` ordenadas por posición. Nunca costos, existencias, proveedor, códigos internos ni `organizacion_id`.
- **El mismo `null`** para producto inexistente, inactivo, oculto, con categoría oculta, de otra empresa u organización, host desconocido o empresa desactivada: el front no puede distinguir los casos y no revela si el producto existe. El front también corta los ids que no son UUID antes de consultar.
- **SKU público (D7)**: se muestra el SKU del producto en el bloque de datos; un SKU en blanco no aparece.
- **Front** (`apps/web/src/pages/tienda-publica/`): `rutas/producto.tsx` (`/producto/:productoId`) arma la ficha con `ficha/Galeria.tsx` (principal = menor posición, hasta 4 miniaturas con la elegida marcada con `aria-pressed`, «Sin imagen» si no hay o si ninguna URL firmada carga), `ficha/Ampliacion.tsx` (diálogo de MUI: foco atrapado, cierre por botón y Esc, texto alternativo), `ficha/DatosProducto.tsx` (migas, nombre, categoría, precio, `EtiquetaDisponibilidad`, descripción, bloque «SKU» / «Categoría» / «Disponibilidad», la fila de acciones —«Consultar por WhatsApp» (F-TDA-14) y «Ver más productos» → `/catalogo`— y nota) y `ficha/Compatibilidad.tsx` (no se renderiza sin datos). Lectura: `lib/tiendaFicha.ts` y `hooks/useFichaProducto.ts` (una llamada a la base más un firmado en lote de las imágenes con `lib/imagenProducto.ts`).
- **Texto escapado**: nombre, descripción y compatibilidad van como nodos de React; HTML o `<script>` se ve literal. Las miniaturas cargan con `loading="lazy"`.
- **Fuera de alcance** (el prototipo los muestra, la spec de esta épica no los pide): «Productos relacionados». El botón «Consultar por WhatsApp» lo agrega MSF-212 (F-TDA-14, MSF-433): ver [`tienda-contacto.md`](./tienda-contacto.md).

### Verificación

pgTAP `supabase/tests/database/tienda_ficha_publica.test.sql` (SC-007), Vitest + axe `pages/tienda-publica/FichaProducto.test.tsx` y E2E `apps/web/e2e/tienda-ficha.e2e.ts` (SC-008, requiere el stack local).

## Cierre de la épica MSF-167: tienda · catálogo y ficha (MSF-549)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/` (T070–T073; SC-010…SC-013). Resumen de lo que entregan las cuatro historias (F-TDA-11, F-TDA-12, F-TDA-13 y F-TDA-18); el detalle de cada una está en sus secciones de arriba.

### Rutas públicas

| Ruta | Qué muestra | Historia |
|---|---|---|
| `/` | Inicio de la tienda | épica anterior |
| `/catalogo` | «Todos los productos» con filtros, orden y carga infinita | F-TDA-12 |
| `/categoria/:categoriaId` | Listado de una categoría visible (migas «Inicio / Categoría») | F-TDA-11 + F-TDA-12 |
| `/producto/:productoId` | Ficha con galería, precio, disponibilidad y compatibilidad | F-TDA-13 |
| cualquier otra | La misma 404 (inexistente, oculta, ajena o id inválido) | F-TDA-11 |

### Funciones públicas (`publico.*`, ejecutables por `anon`)

| Función | Devuelve | Historia |
|---|---|---|
| `categorias_por_dominio(host)` | categorías visibles con conteo de productos visibles | F-TDA-11 |
| `catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina)` | página de 24 productos con lista blanca de campos | F-TDA-12 |
| `producto_por_dominio(host, producto)` | ficha con lista blanca de campos | F-TDA-13 |
| `imagen_publica(ruta)` | booleano; respalda la política de lectura de `anon` sobre imágenes | F-TDA-12 |

Helpers `private.*` sin `execute` para la API: `disponible_publico` (F-TDA-18) y `precio_final_publico`, `imagen_publica` (F-TDA-12). Host desconocido, producto no visible y empresa desactivada devuelven el mismo `null`. Las migraciones de la épica son aditivas (`20261023120000` … `20261023120300`) y ninguna crea tablas.

### Filtros y URL

`categoria`, `stock=1`, `max=<pesos>`, y `orden=<relevancia|precio_asc|precio_desc>`; la URL es compartible, los valores inválidos se ignoran y cambiar un filtro reinicia la lista desde la primera tanda (un `pagina=<n>` viejo se ignora).

### Disponibilidad

Solo el booleano «Disponible» / «Sin stock» (`cantidad > 0`), nunca cantidades. Contrato de cambio futuro (depósitos y reservas) en [`stock.md`](./stock.md).

### Decisiones y su supuesto

| Decisión | Supuesto adoptado | Si cambia |
|---|---|---|
| **D1** imágenes | Bucket privado + política de `anon` acotada + URLs firmadas de una hora | Cambia `lib/imagenProducto.ts` y una migración |
| **D3** tamaño de página | 24, constante de la función | Un solo valor; ver rendimiento abajo |
| **D7** SKU público | Se muestra el SKU del producto | Quitar una fila de `DatosProducto.tsx` |
| **D9** sin precio calculable | Precio `null`: sin precio en la tarjeta, al final de los órdenes por precio, fuera del filtro de máximo | Ajustar la función |

### Contradicciones con el prototipo (para el PR)

La carga infinita («Cargar más») no está dibujada en el prototipo (se usa el componente compartido del panel); «Últimas unidades · quedan N» queda fuera (expondría stock exacto); «Productos relacionados» de la ficha queda fuera de alcance (el botón «Consultar por WhatsApp» llega con MSF-212, F-TDA-14); el buscador del encabezado es de MSF-191. Precios que ven los clientes: [`precios.md`](./precios.md).

### Rendimiento en celular (T071, SC-010)

**No medido todavía.** El entorno donde se cerró la épica no tenía acceso a Docker, así que no hubo stack local con el seed y no hay cifras que registrar (no se inventan). La medición queda trazada en **MSF-552** (seguimiento). Protocolo a seguir:

1. `pnpm dev:supabase`, build del front y preview con las dos tiendas del seed.
2. Lighthouse en perfil móvil (`.lighthouserc.json`) sobre `/catalogo` y `/producto/:id` de ambas tiendas.
3. Medir `publico.catalogo_pagina_por_dominio` con un catálogo de cientos de productos (techo de diseño, ver «Costo y techo esperado» arriba).
4. Si el tamaño 24 (D3) o la consulta por precio no cumplen, anotar acá el ajuste.

Lo que ya mitiga: rutas con carga diferida, imágenes con `loading="lazy"`, una llamada RPC por página y un firmado en lote de imágenes.

## Cuenta del cliente en la tienda (épica MSF-237)

Spec: `specs/20261024-051500-cuenta-web-del-cliente/`. La tienda suma el acceso de clientes con cuenta web (alta en [`clientes.md`](./clientes.md), contraseña y redirecciones en [`acceso-ingreso.md`](./acceso-ingreso.md)).

| Ruta | Qué hace | Historia |
|---|---|---|
| `/ingresar` | Ingreso con correo y contraseña; solo entra una cuenta `activa` | F-CLI-06 |
| `/definir-contrasena` | Primera contraseña o recuperación; solo con un enlace de Auth vigente | F-CLI-06 |
| `/recuperar-contrasena` | Pide el correo; respuesta idéntica exista o no la cuenta | F-CLI-06 |

| Función `publico.*` | Quién la ejecuta | Devuelve | Historia |
|---|---|---|---|
| `acceso_cliente_por_dominio(host)` | `authenticated` | estado (`activa` · `suspendida` · `sin_cuenta` · `no_habilitado`) y tipo si es activa; `null` si el host no resuelve o la empresa está desactivada | F-CLI-05 |
| `precios_cliente_por_dominio(host, productos[])` | `authenticated` | escalas del tipo de cliente (x1; o x1–x50 con rango) por producto; `null` sin cuenta activa habilitada | F-CLI-07 |

`anon` no ejecuta ninguna de las dos: el visitante ve exactamente el precio público de siempre. Ninguna devuelve `organizacion_id`, costos, margen ni existencias. Detalle del precio: [`precios-escalas.md`](./precios-escalas.md).

## Página de inicio (F-TDA-10, MSF-399, épica MSF-191)

Spec: `specs/20261024-120000-tienda-inicio-busqueda-movil/` (FR-001…FR-008, FR-060, SC-001…SC-003).
Migración aditiva `supabase/migrations/20261203100000_tienda_destacados_publicos.sql`
(reversión: `drop function publico.destacados_por_dominio(text)`). No crea ni altera tablas
(`publico` sigue sin tablas). Pruebas: `supabase/tests/database/tienda_destacados_publicos.test.sql`,
`apps/web/src/pages/tienda-publica/rutas/inicio/*.test.tsx` y `apps/web/e2e/tienda-inicio.e2e.ts`.

- `publico.destacados_por_dominio(host)` (ejecutable por `anon`): hasta 8 destacados efectivamente
  visibles (por nombre), con `id`, `nombre`, `precio` final de la empresa
  (`private.precio_final_publico`, `null` si no es calculable), `disponible` (solo booleano), `imagen` y
  `categoria_id`, más `hay_productos`. Host desconocido y empresa desactivada devuelven el mismo `null`.
- La home compone, por `orden`: banner (20, `BannerHome` de MSF-147) → `EstadoPreparacion` (30) →
  `CategoriasInicio` (40) → `DestacadosInicio` (50). Los tres bloques nuevos comparten una sola
  llamada por host (`lib/tiendaInicio.ts`).
- «Catálogo en preparación» aparece solo si la tienda activa no tiene ningún producto visible y reemplaza
  a «Categorías» y «Destacados»; con productos pero sin destacados solo se oculta «Destacados». Un bloque
  que falla muestra su error con «Reintentar» sin romper el resto.

## Búsqueda y versión móvil (F-TDA-15 y F-TDA-17, épica MSF-191)

Guías de detalle: [`docs/tienda-busqueda.md`](./tienda-busqueda.md) (F-TDA-15, MSF-413: sugerencias, `/catalogo?q=…`,
tolerancia a tildes y tipeo, límite por visitante) y [`docs/tienda-movil.md`](./tienda-movil.md) (F-TDA-17: menú y panel de
filtros móviles, error con «Reintentar», 360/390/412/430 px y tableta 768/1024 px). Esta página solo consolida el cierre.

### Cierre de la épica MSF-191 (MSF-558)

- **Migraciones** (todas aditivas): `20261203100000` (destacados de la home), `20261203110000` a `20261203110300`
  (búsqueda: base, sugerencias, resultados y saltos de proxy). Reversión: la de cada guía; la tabla nueva
  `public.limite_pedidos_publicos` se revierte con `drop table`, sin otras dependencias.
- **Esquema (Principio VII, re-verificado)**: `public.limite_pedidos_publicos` va en **`public`** (control de abuso
  transversal, no es dominio del producto); `publico` sigue sin tablas.
- **Seguridad revisada**: la tabla tiene RLS activada, sin políticas y con `revoke all` a `public`, `anon` y
  `authenticated`; solo la toca `private.registrar_pedido_publico` (`security definer`, sin ejecución para `anon`).
  `anon` ejecuta únicamente `publico.destacados_por_dominio`, `publico.sugerencias_busqueda_por_dominio` y
  `publico.busqueda_pagina_por_dominio` (con `revoke … from public, anon` previo y `grant` explícito). El visitante es el
  hash `sha256` de la IP + host; la IP nunca se guarda y las ventanas se purgan a los 10 minutos.
- **Pendiente real**: confirmar en DEV la cadena de `x-forwarded-for` (`private.saltos_proxy_confiables()`, hoy 0) y medir
  Lighthouse en celular (trazado en MSF-552); no hay cifras inventadas.

### Contradicciones prototipo ↔ épica (para el PR)

1. **Resultados de búsqueda sin artboard**: la página de resultados es el catálogo con el término (`/catalogo?q=…`).
2. **Panel de filtros móvil sin «Precio máximo»**: manda el comportamiento; el panel móvil lo incluye (D5).
3. **Sin artboards de tableta**: se reutiliza el layout responsivo de escritorio/celular.
4. **Estados no dibujados** (sugerencias, aviso de espera, «Catálogo en preparación», error con reintento): kit de componentes y textos de los requisitos (D8).
5. **«Últimas unidades · quedan N»**: fuera de alcance, solo «Disponible» y «Sin stock».

### Verificación pendiente

«Contacto» en el menú móvil (FR-046, D10): agregado por MSF-437 (F-TDA-16); falta verificarlo a 360 px en un navegador real.

## Contacto y WhatsApp (F-TDA-16 y F-TDA-14, épica MSF-212)

Spec: `specs/20261202-100000-tienda-whatsapp-y-contacto/` (FR-001…FR-015, FR-020…FR-026, FR-060, FR-061).
Historias: F-TDA-16 (`MSF-437`, contacto con formulario) y F-TDA-14 (`MSF-433`, consulta por WhatsApp desde la ficha).
Guía de detalle: [`docs/tienda-contacto.md`](./tienda-contacto.md) (contratos, firmas, seguridad y pruebas de cada historia).
Migraciones: `20261212120700_tienda_contacto.sql` y `20261212120800_crear_consulta_publica_solo_interna.sql` (F-TDA-16),
`20261212121000_tienda_whatsapp.sql` (F-TDA-14).
Pruebas: pgTAP `supabase/tests/database/tienda_contacto.test.sql` y `tienda_whatsapp.test.sql`; Vitest + axe en
`apps/web/src/pages/tienda-publica/contacto/` y `.../whatsapp/`, en `apps/web/src/lib/` (`tiendaContacto`, `whatsapp`,
`registroWhatsapp`) y en `apps/web/src/pages/empresas/edit.test.tsx`; E2E `apps/web/e2e/tienda-contacto.e2e.ts` y
`apps/web/e2e/tienda-whatsapp.e2e.ts`.

El visitante anónimo de la tienda de una empresa (resuelta por dominio desde MSF-147) puede **enviar una consulta** desde
`/contacto` o **abrir WhatsApp** desde la ficha de un producto. Las dos consultas llegan a la bandeja de Consultas y ventas
(MSF-122) de esa misma empresa, con origen `formulario` o `whatsapp`.

### Rutas públicas

| Ruta | Historia | Qué muestra |
|---|---|---|
| `/contacto` | F-TDA-16 | Migas «Inicio / Contacto», título «Contacto» con la bajada de la tienda, bloques «WhatsApp» (número y horarios) y «Correo» —el bloque o la línea sin dato no se muestra— y el formulario «Escribinos». `/contacto/<algo>` devuelve la 404 amable. |
| `/producto/:productoId` | F-TDA-14 | La ficha de MSF-167 suma el botón «Consultar por WhatsApp» (solo si la empresa tiene un número válido) que abre el diálogo con el mensaje armado. |

Además: «Contacto» en el menú (escritorio y celular) y «Escribinos» en el pie (F-TDA-16), y el campo «Horarios de atención»
en la edición de Empresas (FR-014, D2), que opera sobre la empresa activa.

### Funciones públicas (`publico`, ejecutables por `anon`)

| Función | Devuelve |
|---|---|
| `publico.contacto_por_dominio(host text)` | `{ nombre, whatsapp, correo, horarios }` de la empresa del host, o `null` (idéntico para host desconocido y empresa desactivada). |
| `publico.enviar_consulta_contacto(host text, nombre text, contacto text, mensaje text, clave_envio uuid)` | `{ estado: 'ok' \| 'invalido' \| 'limite' \| 'error', campos?, espera_segundos? }`. |
| `publico.registrar_consulta_whatsapp(host text, producto uuid, clave_envio uuid)` | `{ estado: 'ok' \| 'limite' \| 'error' }`. |

Las tres son `SECURITY DEFINER` con `set search_path = ''`, filtran por `dominio.empresas.activa` y devuelven una lista
blanca: nunca `organizacion_id`, IP, hash del visitante ni columnas internas. Host desconocido, empresa desactivada y
producto ajeno u oculto responden **lo mismo**.

Las funciones internas (`private.visitante_hash`, `private.limite_envios_tienda`, `private.registrar_envio_tienda`,
`private.validar_contacto_tienda`, `private.entregar_a_bandeja`) no tienen `grant` para `anon` ni `authenticated`.
`private.entregar_a_bandeja` es el **único** punto que conoce la interfaz de entrada de MSF-122
(`publico.crear_consulta_publica`): si esa firma cambia, solo cambia el adaptador.

### Tabla `dominio.tienda_envios` (esquema `dominio`)

| Objeto | Esquema | Justificación | RLS |
|---|---|---|---|
| `dominio.tienda_envios` (tabla nueva) | **`dominio`** | Dato del producto Tiendas online atado a una empresa: registro mínimo de envíos de visitantes (límite e idempotencia). No es plataforma genérica. | Sí, por organización: `select` para `authenticated` con `organizacion_id = private.organizacion_id()`. `revoke all … from public, anon, authenticated` + `grant select … to authenticated`: **`anon` no tiene ningún privilegio** y escribe solo `private.registrar_envio_tienda` (`security definer`). |
| `dominio.empresas.horarios` (columna nullable, ≤ 200) | **`dominio`** | La tabla ya es de dominio y tiene RLS; se suma la columna con `grant update (horarios)` a `authenticated`. Aditiva. | Hereda la de `dominio.empresas`. |

Columnas: `id`, `organizacion_id`, `empresa_id`, `visitante` (hash, nunca la IP), `clave_envio`, `origen`
(`formulario|whatsapp`), `creado_en`; `unique (empresa_id, clave_envio)` e índice `(empresa_id, visitante, creado_en)`.
Nada nuevo en `public`: `publico` sigue siendo un esquema de **solo funciones**.

### Límite e idempotencia

- **Límite**: `private.limite_envios_tienda()` → **5 envíos por hora por visitante y empresa** (constante única). Es atómico:
  `private.registrar_envio_tienda` toma `pg_advisory_xact_lock` por (empresa, visitante), así que dos envíos simultáneos no
  superan el cupo. Las filas de más de 24 h se podan en la misma función (sin worker ni cron). Formulario y WhatsApp
  **comparten** el mismo cupo (D3).
- **Idempotencia**: `unique (empresa_id, clave_envio)`; una clave repetida responde `ok` sin entregar de nuevo ni gastar
  cupo. El cliente genera una clave por intento: «Reintentar» la reutiliza y «Enviar otra» pide una nueva.
- **Falla de entrega**: el registro y la entrega van en una sub-transacción; si la bandeja falla se revierte el registro (no se
  gasta cupo) y el visitante ve el error genérico con «Reintentar».

### Identidad del visitante (D6)

El visitante es anónimo: se identifica por el hash `sha256` de la **IP** del cliente (tomada según
`private.saltos_proxy_confiables()`, de F-TDA-15) **más la empresa**. **La IP nunca se guarda**: en la tabla queda solo el
hash. Si la cadena `x-forwarded-for` no llega a PostgREST, todos los visitantes caen en un único cupo «sin-ip»: falla
cerrada, no abierta. **Pendiente de confirmar en DEV**: que la cabecera llega (si no, el límite es global).

### Decisiones de la épica y el supuesto con el que se implementaron

| Decisión | Supuesto |
|---|---|
| D1 · Registro de la consulta por WhatsApp | Al abrir WhatsApp se registra la consulta con `origen = whatsapp` por la misma interfaz de entrada del formulario (F-CON-01), sin esperar al seguimiento de MSF-130. |
| D2 · Fuente de los horarios | `dominio.empresas` no tenía la columna: F-TDA-16 agrega `horarios text` (aditiva, nullable, ≤ 200) y el campo «Horarios de atención» en Empresas. |
| D3 · Alcance del límite | Formulario y WhatsApp cuentan juntos (5 por hora por visitante y empresa). Superado el cupo, el formulario muestra la espera y el botón de WhatsApp **igual abre WhatsApp**: solo se omite el registro. |
| D4 · Interfaz de entrada de MSF-122 | `private.entregar_a_bandeja` es el único adaptador; su firma real se confirmó en T003 (`publico.crear_consulta_publica(host, origen, nombre, contacto, mensaje, producto_id)`). |
| D5 · Antispam adicional | Sin captcha: la defensa es el límite por visitante y empresa, la validación por campo con topes de longitud y el texto siempre literal. |
| D6 · Identidad del visitante | Hash de la IP + empresa (ver arriba); sin IP disponible, un único cupo «sin-ip». |
| D7 · Reglas de validación | Nombre obligatorio (≤ 100), «Correo o WhatsApp» obligatorio (≤ 120) con formato de correo o teléfono, mensaje obligatorio (≤ 2000); todo recortado, con los mismos topes en cliente y servidor. |
| D8 · Horas | No cambia el alcance: el recorte de horas del roadmap queda pendiente de decisión. |

### Seguridad (revisión del diff de la épica)

- **RLS de `dominio.tienda_envios`**: habilitada, con la única política de `select` para `authenticated` por organización
  (`private.organizacion_id()`). `anon` no llega a la tabla: escribe solo `private.registrar_envio_tienda`
  (`security definer`, sin `grant` para roles de API).
- **`grant`s de `anon`**: las tres funciones de `publico` hacen `revoke execute … from public, anon` y después
  `grant execute … to anon, authenticated`. El `revoke` a `PUBLIC` importa: por defecto Postgres da `EXECUTE` a `PUBLIC` en
  toda función. Además, desde `20261212100100` la RPC de la bandeja `publico.crear_consulta_publica` **no** es ejecutable por
  `anon` ni `authenticated` (solo `service_role` y el propietario): el único camino público es
  `publico.enviar_consulta_contacto`, con su límite.
- **Texto literal**: lo que escribe el visitante se guarda y se muestra literal (nodos de React; en
  `apps/web/src/pages/tienda-publica/` no hay `dangerouslySetInnerHTML`). Un `<script>` escrito en el formulario no se
  interpreta.
- **IP no persistida**: la tabla guarda el hash (`visitante`), nunca la IP.
- **Sin datos internos en las respuestas**: `ok | invalido | limite | error` en el formulario y `ok | limite | error` en
  WhatsApp, sin ids de organización, costos, existencias, IP ni hash. Las fallas internas se registran en el log del
  servidor solo con `sqlstate`; al anónimo le llega el error genérico.
- **Aislamiento**: la empresa sale siempre del `Host`; el producto de WhatsApp tiene que ser **efectivamente visible** en la
  tienda del host (misma visibilidad que la ficha).

### Contradicciones prototipo ↔ épica (para el PR)

1. «Se abrió WhatsApp con el mensaje listo (simulado en el prototipo)»: el «simulado» es un artefacto del prototipo; en
   producción abre WhatsApp de verdad y el aviso dice «Se abrió WhatsApp con el mensaje listo.» (FR-023).
2. «Respondemos dentro de las 24 h» y el bloque «Retiro y envíos / No hay compra online en esta versión»: la épica no los pide
   (prometen un plazo y un estado de la compra que cambia con MSF-176) y quedan fuera de alcance.
3. El prototipo de **Empresas** no dibuja «Horarios de atención»: el campo se agrega por FR-014 (D2).
4. La bajada de «Contacto» sale del texto del pie que la tienda ya configura (F-TDA-03); sin texto, no se muestra.
5. El menú de escritorio suma «Contacto» al final de la lista de categorías (el prototipo lo muestra en otra barra).

### Migraciones y reversión

| Migración | Contenido | Reversión (en una migración posterior) |
|---|---|---|
| `20261212120700_tienda_contacto.sql` (F-TDA-16) | columna `dominio.empresas.horarios` (+ check ≤ 200 y `grant update`); tabla `dominio.tienda_envios` + RLS + índices + `unique`; `private.visitante_hash`, `private.limite_envios_tienda`, `private.registrar_envio_tienda`, `private.validar_contacto_tienda`, `private.entregar_a_bandeja`; `publico.contacto_por_dominio` y `publico.enviar_consulta_contacto` con sus `grant`s | `drop function` de las funciones públicas y privadas, `drop table dominio.tienda_envios` y `alter table dominio.empresas drop column horarios` — nada se destruye en el mismo PR que lo crea. |
| `20261212120800_crear_consulta_publica_solo_interna.sql` (F-TDA-16) | solo privilegios: `publico.crear_consulta_publica` deja de ser ejecutable por `anon` y `authenticated` | `grant execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) to anon, authenticated` |
| `20261212121000_tienda_whatsapp.sql` (F-TDA-14) | `publico.registrar_consulta_whatsapp` + `grant`s; no crea ni altera tablas | `drop function publico.registrar_consulta_whatsapp(text, uuid, uuid)` |

**Orden de despliegue**: F-TDA-16 antes que F-TDA-14 (la segunda reusa `private.registrar_envio_tienda`,
`private.entregar_a_bandeja` y `publico.contacto_por_dominio`).

**Pendiente para el despliegue de la épica (no de este cierre)**: las versiones de las dos migraciones de F-TDA-16
(`20261212100000` y `20261212100100`) están por debajo de la máxima de `dokploy` (`20261212120600`) y la segunda pisa la de
`solicitar_documento_presupuesto`: hay que devolverlas a números libres y mayores **antes** de aplicar la épica. Está
detallado en [`docs/tienda-contacto.md`](./tienda-contacto.md) y lo resuelve el PR de release de la épica, no este cierre.

### Verificación

- **pgTAP**: `supabase/tests/database/tienda_contacto.test.sql` (FR-001…FR-006, FR-014, FR-060, FR-061) y
  `supabase/tests/database/tienda_whatsapp.test.sql` (FR-025, FR-060, FR-061): lista blanca, `null` idéntico, aislamiento entre
  dos tiendas, RLS y privilegios de la tabla, límite y ventana de una hora, idempotencia, simultaneidad, reversión ante una
  falla de entrega, HTML literal, producto visible/oculto/ajeno, origen `whatsapp` y respuestas sin datos internos. Se corren
  con `pnpm test:db` (requiere `pnpm dev:supabase`).
- **Vitest + axe**: `apps/web/src/pages/tienda-publica/contacto/` (validación por campo, confirmación, «Enviar otra», espera,
  error con «Reintentar», bloques sin dato ocultos, 404 de subruta, enlaces del menú y del pie, foco y 320 / 768 / 1440 px),
  `.../whatsapp/` (botón solo con número válido, diálogo, foco atrapado y devuelto, `noopener`, URL de `wa.me` codificada),
  `apps/web/src/lib/` (`tiendaContacto`, `whatsapp`, `registroWhatsapp`) y `apps/web/src/pages/empresas/edit.test.tsx`
  (campo «Horarios de atención» y cambio de empresa). Comando: `pnpm --filter @platform/web test`.
- **E2E**: `apps/web/e2e/tienda-contacto.e2e.ts` y `apps/web/e2e/tienda-whatsapp.e2e.ts`, con las dos tiendas del seed: la
  consulta llega a la bandeja de **su** empresa, la ráfaga de 6 envíos muestra la espera y la bandeja recibe 5, y el HTML
  se ve literal. Se omiten sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (ver `docs/e2e-app.md`).
- **Gates del cierre** (T072): `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`, `pnpm prototipo:check`,
  `pnpm matriz:check` y `pnpm docs:check`.

## Productos relacionados de la ficha (F-TDA-20, MSF-263)

Épica MSF-149 (spec `20270125-100000-tienda-seo-legal-y-estados`). Debajo de los datos de la ficha
(`/producto/:productoId`) aparece «Productos relacionados»: hasta **4** productos efectivamente visibles de la
**misma categoría**, sin el actual, destacados primero y luego por nombre (D2 de la spec).

**Relacionados manuales (MSF-846, `20270305100200_tienda_relacionados_manuales.sql`)**: si el producto tiene
«Productos relacionados» cargados en el panel (`dominio.producto_relacionados`, F-CAT-18), la ficha muestra
**esos primero, en su orden (con empate de `orden`, por id)**, hasta 4 y solo los efectivamente visibles en esa tienda
(`private.catalogo_tienda_efectivo`: ocultos, inactivos o no asignados a la empresa se omiten); si faltan para
llegar a 4 se completa con la regla por categoría de arriba, sin repetirlos. Un producto sin categoría con
manuales visibles los devuelve. Mismo contrato de salida y mismos grants; los vínculos se filtran por la
organización de la tienda. Reversión: restaurar el cuerpo de `20270212100003_tienda_relacionados.sql`.

| Capa | Dónde |
|---|---|
| Base | `supabase/migrations/20270212100003_tienda_relacionados.sql`: `publico.relacionados_por_dominio(host, producto)` (`jsonb { productos: [{ id, nombre, precio, disponible, imagen, categoria_id }] }`; sin tablas nuevas). `null` idéntico para host desconocido, empresa desactivada y producto inexistente, oculto, inactivo o de otra tienda; producto sin categoría o sin compañeros → `{ productos: [] }`. Nunca costos, existencias ni `organizacion_id`. Reversión: `drop function publico.relacionados_por_dominio(text, uuid);` |
| Front | `apps/web/src/lib/tiendaRelacionados.ts` (cliente + `useRelacionados`), `apps/web/src/pages/tienda-publica/ficha/Relacionados.tsx` (carga diferida, 4 columnas en escritorio y 2 en celular), integrada en `rutas/producto.tsx` |
| Pruebas | pgTAP `tienda_relacionados.test.sql`; Vitest `tiendaRelacionados.test.ts` y `ficha/Relacionados.test.tsx` (con axe); E2E `apps/web/e2e/tienda-relacionados.e2e.ts` |

Sin relacionados, o si el pedido falla, la sección no se renderiza (ni título, ni hueco, ni mensaje de error).

## Información legal y aviso de cookies (F-TDA-22, MSF-289, épica MSF-149)

Spec: `specs/20270125-100000-tienda-seo-legal-y-estados/` (FR-030…FR-034, SC-009, SC-010). Migración `20270212100001_tienda_legal.sql` (aditiva).

- **Tabla `dominio.tienda_legal_enlaces`** (esquema `dominio`: dato del producto atado a una empresa): `titulo` ≤ 80, `url` solo `https://` ≤ 500 (check), `orden`, FK compuesta a `dominio.empresas`. RLS por organización con solo `select` a `authenticated` (acceso a Empresas); `anon` sin privilegios.
- **Carga (D5)**: sin pantalla ni RPC de escritura; el equipo técnico inserta los enlaces por SQL, como el dominio de la tienda. Razón social, CUIT y dirección ya se editan en Empresas. Qué legal lleva cada marca (D6) se confirma con el cliente; el código no espera esa respuesta.
- **`publico.legal_por_dominio(host)`**: `{ razon_social, cuit, direccion, enlaces: [{ titulo, url }] }` por `orden`; lista blanca; `null` idéntico para host desconocido o empresa desactivada. Ejecutable por `anon`.
- **Front**: `layout/PieLegal.tsx` (montado desde `PieCategorias`): «<Razón social> · CUIT XX-XXXXXXXX-X», dirección y enlaces en pestaña nueva con `rel="noopener noreferrer"`; datos ausentes se omiten y sin datos el bloque no aparece. `layout/AvisoCookies.tsx` (carga diferida): «Aceptar» / «Rechazar», sin bloquear ni robar el foco.
- **Contrato de consentimiento para F-TDA-24** (`lib/consentimientoCookies.ts`): `leerConsentimiento()` (`'aceptadas' | 'rechazadas' | null`; `null` equivale a rechazadas), `guardarConsentimiento(valor)`, `useConsentimientoCookies()` y el evento de ventana `tienda:consentimiento-cookies` (`detail` = decisión). Persiste en `localStorage`; si está bloqueado el aviso reaparece en la próxima visita y nada se rompe.
- **Capa del aviso**: `AvisoCookies` es una barra fija abajo con `z-index` `drawer - 1` (1199), estrictamente por debajo de los paneles laterales del celular (menú y filtros son `Drawer` temporales de MUI, `zIndex.drawer` = 1200; el diálogo de WhatsApp es un `Dialog`, `zIndex.modal` = 1300). Con el nivel anterior (`snackbar`, 1400) tapaba el botón «Ver N productos» del panel de filtros y no se podía tocar mientras no hubiera decisión.
- **Reversión** (migración posterior, no en el PR que la crea): `drop function publico.legal_por_dominio(text); drop table dominio.tienda_legal_enlaces;`.

## Borrador, vista previa y publicación (F-TDA-06, MSF-216)

Migración `supabase/migrations/20270205110100_tienda_borrador_publicacion.sql`. Pruebas:
`supabase/tests/database/tienda_borrador.test.sql`, `apps/web/src/pages/empresas/tienda/Publicacion.test.tsx`.

| Objeto | Esquema | Justificación | RLS |
|---|---|---|---|
| `dominio.tienda_borrador` | `dominio` | Cambios sin publicar de una tienda: dato del producto | Por organización y nivel de sección; sin escritura directa |
| `dominio.tienda_versiones` | `dominio` | Instantánea de cada publicación (versión 1 «Configuración inicial» por backfill) | Por organización; sin escritura directa |

- **Guardar ya no publica.** Las pestañas Identidad, Contenido y Catálogo llaman a `guardar_borrador_tienda(empresa, area, datos)`;
  lo público (`publico.*`) no cambia hasta `publicar_tienda(empresa)`. **BREAKING**: `guardar_tienda_identidad`,
  `guardar_tienda_contenido` y `guardar_catalogo_tienda` dejan de ser ejecutables por `authenticated`; solo las invoca
  `publicar_tienda`. Reversión: reponer el `grant execute` de las tres a `authenticated`.
- `obtener_borrador_tienda` devuelve el borrador con el resumen de cambios calculado en servidor; `descartar_borrador_tienda`
  lo borra. Precios, stock y activo de producto quedan fuera del borrador.
- `publicar_tienda` es transaccional, con bloqueo por empresa, idempotente sin borrador; crea la versión y borra el borrador.
- `vista_previa_tienda` superpone el borrador sobre lo vivo con lista blanca (sin costos, stock exacto ni proveedor). La ruta
  `/empresas/:id/tienda/vista-previa` es perezosa, autenticada y lleva `noindex,nofollow`.
- UI: sección `pestanas/publicacion/Publicacion.tsx` («Estado», versión vigente, «Ver cambios», diálogos «Publicar cambios» /
  «Descartar cambios») y `VistaPrevia.tsx`; las secciones públicas leen de una fuente inyectable (`lib/fuenteTienda.tsx`).
  Con otra empresa activa un diálogo abierto se cierra con aviso y no aplica nada (Principio VIII).

## Versiones y restauración (F-TDA-07, MSF-235)

Migración `supabase/migrations/20270205110200_tienda_versiones.sql` (solo funciones; **sin tablas nuevas**: usa
`dominio.tienda_versiones` y `dominio.tienda_borrador`, ambas en `dominio`, de F-TDA-06). Pruebas:
`supabase/tests/database/tienda_versiones.test.sql`, `apps/web/src/pages/empresas/tienda/Versiones.test.tsx`.

- `listar_versiones_tienda(empresa)`: últimas 100 versiones, la más nueva primero, con nombre de quien publicó y marca
  `vigente` (la de número mayor). Lectura con nivel `lectura` o `edicion` en Empresas.
- `restaurar_version_tienda(empresa, numero)`: requiere `edicion`; **no publica**. Reemplaza el borrador entero con la
  instantánea de la versión. Como la instantánea solo guarda el catálogo distinto del predeterminado, lo vivo que la versión
  no menciona vuelve a visible/no destacado en el borrador. Productos y categorías que ya no existen se omiten. Si el
  resultado coincide con lo publicado, el borrador queda vacío. La versión vigente no se restaura (`22023`). Deja el evento
  `tienda.version_restaurada` en el registro de actividad.
- No reescribe el historial: publicar después crea la versión siguiente (`publicar_tienda`).
- `anon` no ejecuta ninguna de las dos (`revoke … from public, anon`; `grant … to authenticated`).
- UI: sección `pestanas/publicacion/Versiones.tsx` (`orden` 25, entre Publicación y Vista previa): tabla Versión / Fecha / Por /
  Cambios, «Restaurar» en todas menos la vigente, diálogo «Restaurar versión» (con línea extra si hay borrador) y mensaje
  «Versión restaurada como borrador». Avisa por `EVENTO_PUBLICACION` (`origen: 'versiones'`) para que Publicación relea el
  aviso de cambios y la vista previa se actualice. Con otra empresa activa, un diálogo abierto se cierra con aviso (Principio VIII).
- Reversión: `drop function public.restaurar_version_tienda(uuid, integer); drop function public.listar_versiones_tienda(uuid);`

## Cierre de la épica MSF-133: tienda · dominio y publicación (MSF-779)

Spec: `specs/20270125-100000-tienda-dominio-y-publicacion/`. Historias: F-TDA-05 (dominio y certificado, MSF-198),
F-TDA-06 (borrador y publicación, MSF-216) y F-TDA-07 (versiones, MSF-235). Las secciones anteriores de esta guía describen
cada una; esta resume el cierre.

### Verificación de punta a punta (SC-003)

`apps/web/e2e/tienda-publicacion.e2e.ts` (`[MSF-779:T024]`): dos organizaciones con una empresa cada una; alta del dominio,
verificación con DNS simulado (`registrar_verificacion_dns` se llama con la service-role key **desde Node**; el navegador
nunca la ve), cambio en borrador, publicar, restaurar la versión 1 y publicar de nuevo (versión 3). Comprueba que `anon`
solo ve lo publicado, que no accede al borrador y que la otra empresa no cambia. Se omite sin el stack local
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`) y aborta si `SUPABASE_URL` no es local.

### Revisión de seguridad (SC-002)

Sin hallazgos P0/P1. `anon` solo ejecuta `publico.redireccion_por_dominio`; `registrar_verificacion_dns` es solo
`service_role`; toda RPC nueva tiene `revoke … from public, anon`; las cuatro tablas nuevas tienen RLS sin política de
escritura; la comprobación TLS conecta solo a la IP de la plataforma, con el A correcto y hostnames guardados (sin SSRF).
Deuda real trazada como seguimiento:

| Sev. | Hallazgo | Tratamiento |
|---|---|---|
| P2 | La política de borrado del bucket `tienda-identidad` deja a un editor borrar objetos que una versión restaurable aún referencia; `rutas_tienda_sin_referencia` es solo consejo del cliente. | Seguimiento MSF-796: exigir en la política que la ruta no esté referenciada, o mover la limpieza al servidor. |
| P3 | `tienda_dns_plataforma.ip_publica` solo valida el formato (admite loopback/privadas/octetos > 255). La carga el equipo técnico por SQL. | Seguimiento MSF-797: `check` contra rangos no públicos. |
| P3 | El timeout de 5 s de la comprobación TLS no cierra el socket colgado (acotado por 1 verificación cada 10 s). | Seguimiento MSF-797: cerrar el `Deno.Conn` al vencer. |
| P3 | El bucket es público: logos y banners de un borrador o versión vieja son legibles por quien conozca la ruta (lleva UUID, no adivinable). | Aceptado y documentado: no son confidenciales a nivel de almacenamiento. |

### Operación y reversión

Las tres migraciones (`…130000`, `…130100`, `…130200`) son aditivas y cada una trae su reversión en el encabezado. Orden de
reversión: versiones → borrador y publicación → dominio. **Ojo (BREAKING de F-TDA-06)**: `guardar_tienda_identidad`,
`guardar_tienda_contenido` y `guardar_catalogo_tienda` ya no son ejecutables por `authenticated`; revertir la épica entera
(`git revert -m 1 <merge>`) los devuelve. DNS por entorno: ver «DNS de la plataforma por entorno» arriba.

## Contenido y analítica · Páginas de contenido (F-TDA-23, MSF-306, épica MSF-164)

Spec: `specs/20270210-100000-tienda-contenido-y-analitica/`. Cada empresa crea páginas de texto propias (p. ej. «Cómo comprar», «Envíos») que el visitante lee desde el pie de **su** tienda. (La sección completa «Contenido y analítica» la cierra la tarea T071 de la épica; acá queda lo de esta historia.)

- **Datos** (`supabase/migrations/20270212200001_tienda_paginas.sql`, esquema **`dominio`**): `dominio.tienda_paginas` (`titulo` ≤ 80, `slug` único por empresa, `contenido` ≤ 10 000, `visible` apagado por defecto). RLS por organización, solo `select` a `authenticated`, sin privilegios para `anon`. Escritura solo por `public.guardar_pagina_tienda` / `public.eliminar_pagina_tienda` (edición en Empresas; `revoke … from public, anon` + `grant … to authenticated`). El `slug` sale del título (sin tildes, minúsculas, guiones, sufijo numérico si choca) **solo al crear** y no cambia al editar. Lectura anónima: `publico.paginas_por_dominio(host)` y `publico.pagina_por_dominio(host, slug)` (lista blanca; `null` idéntico para host desconocido, empresa desactivada y página inexistente, oculta o ajena). Migración aditiva; reversión en el encabezado de la migración.
- **Panel**: pestaña «Páginas» en `/empresas/:id/tienda/paginas` (`pestanas/paginas.tsx`): lista con carga infinita, contador, vacío, error con «Reintentar»; diálogo crear/editar con interruptor «Visible en la tienda» y confirmación de borrado con el título. Se reencuadra al cambiar de empresa (la pestaña se remonta por empresa y cierra sus diálogos). Las páginas se aplican **al guardar**, no pasan por el borrador de MSF-133 (decisión D3 de la spec).
- **Tienda pública**: ruta `/pagina/:slug` (`rutas/pagina.tsx`, carga diferida) con migas, título y texto plano en párrafos (nunca HTML); la 404 de la tienda cubre todo caso no visible. Columna «Información» en el pie (`layout/PieInformacion.tsx`), sin hueco si no hay páginas visibles y sin error propio si el pedido falla.
- **Cabecera SEO**: la ruta usa la `CabeceraSeo` compartida de MSF-149 (título «<página> | <empresa>», descripción de la tienda, canónica `/pagina/<slug>` y Open Graph), como producto y categoría. Antes de integrar MSF-149 fijaba `document.title` a mano; esa diferencia con la spec quedó cerrada.
- **Verificación**: pgTAP `supabase/tests/database/tienda_paginas.test.sql`; Vitest + axe `empresas/tienda/paginas.test.tsx`, `tienda-publica/rutas/pagina.test.tsx`, `tienda-publica/layout/PieInformacion.test.tsx`; E2E `apps/web/e2e/tienda-paginas.e2e.ts` con las dos tiendas del seed.

## Compartir producto (F-TDA-25, épica MSF-164)

Historia `MSF-325`, sin migración ni cambios de base (spec `specs/20270210-100000-tienda-contenido-y-analitica/`).

- **Botón «Compartir»** en la fila de acciones de la ficha (`ficha/BotonCompartir.tsx`, montado en `ficha/DatosProducto.tsx`), con el estilo de botón secundario (borde) de «Ver más productos».
- **Comportamiento**: con `navigator.share` abre el selector del sistema con el nombre del producto y el enlace; si la persona lo cierra (`AbortError`) no hay error ni aviso. Sin selector —o ante cualquier otro fallo del selector— copia el enlace con el aviso «Enlace copiado» (región `role="status"` / `aria-live="polite"`); si el portapapeles rechaza, muestra el enlace en un campo de solo lectura seleccionado («Copiá este enlace»).
- **Enlace** (`lib/enlaceProducto.ts`): `origen del Host actual` + `/producto/<id>`; sin parámetros de seguimiento, filtro ni búsqueda y sin datos de la persona. Cada tienda comparte su propio dominio.
- **Pruebas**: Vitest `lib/enlaceProducto.test.ts` y `ficha/BotonCompartir.test.tsx` (con axe); E2E `apps/web/e2e/tienda-compartir.e2e.ts` en las dos tiendas del seed a 320 / 768 / 1440 px.
- **Reversión**: solo front; `git revert -m 1` del merge de la spec.

## Analítica de visitas (F-TDA-24, MSF-315, épica MSF-164)

Spec: `specs/20270210-100000-tienda-contenido-y-analitica/` (US2, FR-010…FR-017). Cada empresa conecta **Google Analytics 4** y/o **Meta Pixel** desde la pestaña «Analítica» de la gestión de su tienda; la tienda pública carga sus scripts **solo** si la persona aceptó las cookies.

- **Datos** (`supabase/migrations/20270212200002_tienda_analitica.sql`, esquema **`dominio`**): `dominio.tienda_analitica` (`empresa_id` PK con FK compuesta a la organización, `ga4_id` con check `^G-[A-Z0-9]{4,20}$`, `meta_pixel_id` con check `^[0-9]{8,20}$`). RLS por organización con acceso a Empresas; **sin privilegios para `anon`**; sin escritura directa. Son identificadores públicos de medición, no secretos.
- **Panel**: RPC `public.guardar_analitica_tienda(empresa, ga4, pixel)`: exige edición en Empresas y empresa de la organización, recorta espacios, pasa el ID de GA4 a mayúsculas, trata el vacío como «quitar la herramienta» y rechaza un formato inválido con un `hint` que nombra el campo (`ga4_id` / `meta_pixel_id`). Pestaña «Analítica» (`pestanas/analitica.tsx`): dos campos con ayuda y validación de formato bajo el campo, aviso fijo «Solo se cargan en la tienda publicada y si la persona acepta las cookies.», aviso de privacidad («No se envían datos del visitante…» y «desactivá la Medición mejorada de tu propiedad de GA4»), «Guardar» / «Descartar», aviso de cambios sin guardar y reencuadre al cambiar de empresa.
- **Tienda pública**: `publico.analitica_por_dominio(host)` (ejecutable por `anon`) devuelve **solo** `{ ga4_id, meta_pixel_id }` (lista blanca, nunca `organizacion_id`); `null` idéntico para host desconocido, inválido o empresa desactivada. `layout/MedicionTienda.tsx` (carga diferida desde `LayoutTienda`) consulta **una vez por visita** y carga los scripts oficiales (`googletagmanager.com`, `connect.facebook.net`) solo si **todas** estas condiciones se cumplen: tienda publicada, al menos un ID, consentimiento `aceptadas` (`lib/consentimientoCookies.ts`, MSF-149) y no es la vista previa del panel (la vista previa no pasa por `LayoutTienda`). Si la persona acepta con la página abierta se cargan en ese momento; sin decisión o con cookies rechazadas no se descarga nada. Los IDs se pasan **como datos** (`gtag('config', id)` y parámetro codificado de la URL), nunca se arma código con ellos. Una falla de carga no afecta a la tienda ni se muestra.
- **Visitas y eventos** (`lib/analiticaTienda.ts`): cada cambio de ruta registra una visita (`page_view` en GA4, `PageView` en Meta; el `page_view` automático de GA4 está apagado para no duplicar). `registrarEventoTienda('clic_whatsapp')` al pulsar «Abrir WhatsApp» (`DialogoWhatsApp`) y `registrarEventoTienda('envio_contacto')` al confirmarse el envío (`FormularioContacto`, solo en estado `exito`): una vez, sin bloquear la acción, sin datos del visitante ni del mensaje (solo el nombre) y como no-op si no hay medición cargada.
- **Aislamiento**: cada tienda carga solo los IDs de su empresa, resueltos por el `Host`; nada mezcla empresas.
- **Eventos y consentimiento vigente (corrección de la revisión de MSF-315)**: los cuatro eventos de RF-TDA-24-2 son `vista_producto` (al abrir la ficha, `rutas/producto.tsx`, una vez por ficha), `busqueda` (al buscar: Enter o «Ver todos los resultados», `BuscadorTienda`; **no** se envía el texto buscado, que puede ser un dato personal), `clic_whatsapp` y `envio_contacto`. Cada emisión (`registrarEventoTienda`, `registrarVisita`) vuelve a consultar el consentimiento ACTUAL: si se revocó, no envía y apaga la medición (`retirarMedicion`, ver «Revocar el consentimiento» abajo). Si la persona vuelve a aceptar, la medición se carga de nuevo desde cero. Meta recibe los eventos con `trackSingle`/`trackSingleCustom` y el ID vigente. Un evento que llega antes de que cargue la medición espera (máx. 5) y se emite al cargarla.
- **IDs**: `MedicionTienda` descarta los IDs al cambiar de `host` y `cargarMedicion` reemplaza los anteriores (el ID viejo de GA4 queda con `ga-disable`; ver «Cambio de ID de GA4» abajo). `leerAnaliticaPublica` revalida en el cliente los mismos formatos que los CHECK de la base (`^G-[A-Z0-9]{4,20}$`, `^[0-9]{8,20}$`); un ID inválido se descarta antes de llegar a una URL, `gtag` o `fbq`.
- **Vista previa del panel**: no monta `MedicionTienda` (solo `LayoutTienda` lo hace); lo fija el test `empresas/tienda/vistaPreviaSinMedicion.test.ts` y el E2E (paso 7).
- **Diferencias con el spec**: el spec (D6/FR-016) solo pedía `clic_whatsapp` y `envio_contacto`; la historia (RF-TDA-24-2) pide además vista de producto y búsqueda, y prevalece: se agregaron `vista_producto` y `busqueda`. La visita de página (`page_view`) se mantiene.
- **Pruebas**: pgTAP `supabase/tests/database/tienda_analitica.test.sql`; Vitest `lib/analiticaTienda.test.ts`, `layout/MedicionTienda.test.tsx`, `empresas/tienda/analitica.test.tsx` (con axe a 320 / 768 / 1440 px) `empresas/tienda/vistaPreviaSinMedicion.test.ts`, los casos de evento en `FichaProducto.test.tsx`, `BuscadorTienda.test.tsx`, `DialogoWhatsApp.test.tsx` y `FormularioContacto.test.tsx`; E2E `apps/web/e2e/tienda-analitica.e2e.ts` con las dos tiendas del seed (sin consentimiento no hay pedidos a los dominios de medición; con consentimiento cada tienda carga sus IDs; aceptación tardía; revocación; visitas; `vista_producto`, `busqueda`, `clic_whatsapp` y `envio_contacto`; vista previa del panel y tienda desactivada sin pedidos).
- **Revocar el consentimiento (revisión independiente de MSF-164, hallazgo 1)**: no hay botón de «revocar» en el aviso (fuera de alcance, MSF-149 D7); la revocación llega por `localStorage` / el evento de cambio del contrato de consentimiento y `MedicionTienda` / cada emisión la detectan. `retirarMedicion()` no solo apaga el envío: borra las cookies de medición (`_ga`, `_ga_<ID>`, `_gid`, `_gat*`, `_gcl_*`, `_fbp`, `_fbc`) con `path=/` en el dominio actual y en cada dominio padre, quita los `<script>` de `googletagmanager.com` y `connect.facebook.net`, borra las globales `dataLayer`, `gtag`, `fbq`, `_fbq`, `google_tag_manager` y `google_tag_data`, y deja puesto `ga-disable-<ID>`. Los scripts ya evaluados no se pueden descargar de memoria, así que se recarga la página **solo si no se pierde nada**. No se recarga (y se difiere) si la pestaña está en segundo plano (`document.hidden`), hay un campo de texto con contenido, un `select` distinto del valor inicial (variante, filtro), un `contenteditable`, el foco dentro de un campo, o un diálogo abierto; también cuentan un checkbox o radio cambiado. El reintento ocurre al soltar un campo hacia algo que no es otro campo (`focusout` con `relatedTarget` fuera de campos, formularios y diálogos), al volver a la pestaña (`visibilitychange`), al cambiar de ruta de la SPA y, como red de seguridad, cada 5 s mientras la pestaña esté visible (se cancela al recargar). Un script que estaba **en vuelo** al revocar se evalúa igual aunque se quite su nodo: cuenta como «en memoria» y, si llega tarde, queda inerte y se limpian sus huellas. Un script de un ID de GA4 anterior que llega tarde queda inerte (`ga-disable` y sus cookies fuera) sin tocar el vigente, y quitar y volver a agregar el ID de Meta no inyecta otro `fbevents` (espera a poder recargar). Si la persona vuelve a aceptar mientras quedan scripts viejos sin poder recargar, **no se carga nada encima** (evita doble envío ni reactivar el `ga-disable` viejo): la medición queda apagada y se retoma al recargar. También se borran las claves de Google y Meta de `localStorage` / `sessionStorage` (claves exactas por proveedor: Google `_ga`, `_ga_*`, `_gid`, `_gat*`, `_gcl_*`, `__gads`; Meta `_fbp`, `_fbc`, `_fbq`, `fbevents`; nunca la decisión de cookies ni claves de la app), y el borrado de cookies omite sufijos públicos como `com.ar` o `co.uk` (el navegador los rechaza).
- **Meta Pixel sin datos del visitante (hallazgo 2)**: antes de `init` se ejecuta `fbq('set','autoConfig',false,<ID>)` y `init` se llama con objeto vacío (`fbq('init', <ID>, {})`). Con eso Meta no hace «Automatic Advanced Matching» (no lee ni envía hasheados el email, teléfono o nombre de `FormularioContacto` / `DialogoWhatsApp`), ni registra clics de botón ni metadatos automáticos. Solo viajan los eventos propios (`PageView` y los cuatro de la tienda) con su nombre. El aviso de cookies y la pestaña «Analítica» lo dicen.
- **GA4 y «Medición mejorada» (hallazgo 3)**: desde el código se configura `gtag('config', id, { send_page_view: false })` y la visita se registra a mano. Pero con la «Medición mejorada» activa en la propiedad (valor por defecto), Google envía por su cuenta `page_view` en cambios del historial y eventos de formularios/clics: **eso solo se apaga en la propiedad de GA4** (Administrar > Flujos de datos > flujo web > Medición mejorada: desactivar «Cambios de página basados en eventos del historial del navegador» y la interacción con formularios). La pestaña «Analítica» y la doc de producto lo indican a quien la configura.
- **Cambio de ID de GA4 en la misma visita (hallazgo 4)**: el `gtag/js?id=` ya cargado es el del ID anterior, así que `cargarGa4` descarga ese script, limpia `dataLayer` / `gtag`, deja `ga-disable-<ID anterior>` y carga el del ID nuevo desde cero. Pixel: el ID nuevo se inicia con la misma pila y los eventos usan `trackSingle` con el ID vigente.
- **Scripts bloqueados (hallazgo 12)**: si `gtag/js` o `fbevents.js` fallan (bloqueador de anuncios, red), `onerror` apaga esa herramienta (borra su `dataLayer` / pila), no se reintenta en esa visita y no se acumula nada; los eventos que esperan carga son como máximo 5.
- **Cuándo se mide: la tienda pausada (hallazgo 10)**: «pausada» es `empresa.activa = false` (no un estado aparte): `resolverTienda` devuelve `null` y se muestra «Volvemos pronto» (`pages/tienda-publica/index.tsx`), que no pasa por `LayoutTienda`; por eso `MedicionTienda` no se monta ni se consultan los IDs. Lo fijan el Vitest `pages/tienda-publica/index.test.tsx` («la medición solo se monta en la tienda publicada») y el E2E `tienda-analitica.e2e.ts` (paso 6, tienda desactivada).
- **`busqueda` (hallazgo 11)**: se emite al ir a la página de resultados con Enter o «Ver todos los resultados» (coherente con la sección de búsqueda de esta guía); **no** al elegir una sugerencia ni al entrar directo por URL a `/buscar`.
- **Roles en el panel (hallazgo 9)**: la gestión de la tienda ya exige edición en Empresas. Además, las pestañas «Páginas» y «Analítica» deshabilitan sus controles (Nueva página, Editar, Eliminar, campos, Guardar, Descartar) con un aviso de solo lectura si el nivel de «empresas» no es edición, y un rechazo de la base por rol (`42501`) muestra «Tu rol no puede editar…» en lugar del error genérico.
- **Tope de páginas (hallazgo 6)**: migración `20270218400000_tienda_paginas_tope.sql` (`create or replace` de `public.guardar_pagina_tienda`, misma firma, `security definer`, `search_path = ''`): como mucho **50 páginas por empresa**; la 51 se rechaza con `22023` y «La empresa ya tiene el máximo de 50 páginas. Eliminá alguna para crear otra» (sin `hint` de campo: la pestaña lo muestra tal cual). Editar una página existente no se bloquea. El pie también acota a 50 enlaces y los reparte en columnas cuando son muchas. pgTAP `tienda_paginas_tope.test.sql` (tope, edición con 50, otra empresa, liberar un lugar, contenido de 10000 / 10001 caracteres y de emoji). Reversión: volver a aplicar la definición de `20270212200001` en una migración posterior.
- **Seguridad: lecturas públicas y CSP (hallazgos 5 y 7)**: `publico.paginas_por_dominio`, `publico.pagina_por_dominio` y `publico.analitica_por_dominio` las llama el navegador directo a Supabase (PostgREST), **no pasan por el nginx de la tienda**: su límite de frecuencia y su caché dependen de PostgREST / el proxy delante de Supabase, no de este repo. Lo que acota el daño en la base es la lista blanca de campos, que `paginas_por_dominio` devuelve a lo sumo 50 filas (tope) y que `pagina_por_dominio` devuelve una sola. El `nginx.conf` de `apps/web` suma `Content-Security-Policy-Report-Only` en `location /` (el `index.html`, que es el mismo del panel): permite `self`, `googletagmanager.com`, `google-analytics.com`, `connect.facebook.net`, `facebook.com`, el origen de Supabase (marcador `__SUPABASE_URL__`, sustituido al construir la imagen) e imágenes `https:`. Está en modo reporte a propósito. `index.html` no tiene scripts inline (solo el módulo externo `/src/main.tsx`), por lo que `script-src` sin `'unsafe-inline'` no genera ruido; los estilos inline de MUI/emotion están permitidos por `style-src 'unsafe-inline'`.
  - **Sin `report-uri` (decisión)**: GlitchTip (`infra/glitchtip/`, `docs/monitoreo.md`) acepta reportes de seguridad por proyecto, pero su endpoint lleva la clave del proyecto (`glitchtip_key`, distinta por entorno) y habría que inyectarla al construir la imagen con un `ARG` nuevo en `apps/web/Dockerfile` y un marcador en `nginx.conf`; eso toca los mismos archivos que MSF-149 y se separa a un seguimiento. Mientras tanto los reportes quedan en la consola de cada navegador.
  - **Procedimiento manual**: en un navegador real, abrir la tienda (con cookies aceptadas y un ID de GA4/Meta de prueba) y el panel (con un reporte de Superset embebido), con DevTools en Consola y Red, y anotar cada línea «[Report Only] Refused to …». Repetir en ficha, búsqueda, contacto, WhatsApp y páginas.
  - **Criterio para pasar a bloqueo**: un ciclo completo de uso de tienda y panel sin violaciones de orígenes legítimos (lo legítimo faltante, p. ej. el origen de Superset en `frame-src`, se suma al allowlist). Entonces se cambia el encabezado a `Content-Security-Policy` con el mismo valor y se mantiene unos días con el reporte activo por si algo se escapó.
- **Reversión** (migración posterior, solo mientras no haya datos productivos): `drop function publico.analitica_por_dominio(text); drop function public.guardar_analitica_tienda(uuid, text, text); drop trigger tienda_analitica_normalizar on dominio.tienda_analitica; drop function private.normalizar_tienda_analitica(); drop table dominio.tienda_analitica;`

## Estados, relacionados, SEO y legal (épica MSF-149)

Visión de conjunto de la épica; el detalle de cada historia está en las secciones que siguen. Spec:
`specs/20270125-100000-tienda-seo-legal-y-estados/` (contrato en `contracts/tienda-seo-legal-estados.md`). Alcance de entrega: `refine` y `supabase`.

### Funciones públicas y tabla nueva

| Historia | Pieza | Esquema | Quién la ejecuta |
|---|---|---|---|
| F-TDA-19 (MSF-247) | `publico.estado_tienda_por_dominio(host)`: marca de la tienda **desactivada** | `publico` (función) | `anon`, `authenticated` |
| F-TDA-20 (MSF-263) | `publico.relacionados_por_dominio(host, producto)`: hasta 4; primero los relacionados manuales del panel (MSF-846) y luego la regla por categoría | `publico` (función) | `anon`, `authenticated` |
| F-TDA-21 (MSF-279) | `publico.seo_tienda_por_dominio(host)` y `publico.sitemap_por_dominio(host)` | `publico` (funciones) | `anon`, `authenticated` |
| F-TDA-22 (MSF-289) | `publico.legal_por_dominio(host)` y la tabla `dominio.tienda_legal_enlaces` | tabla en **`dominio`** (dato del producto atado a una empresa, Principio VII), función en `publico` | tabla: solo `select` a `authenticated` con RLS por organización, sin privilegios para `anon`; función: `anon` |

Todas son `security definer` con lista blanca de campos y devuelven `null` idéntico para host desconocido o inválido; las únicas
que distinguen una empresa desactivada son `estado_tienda_por_dominio` (D1) y, con la misma respuesta de «cerrada», la Edge Function
`tienda-seo`. `publico` sigue sin tablas.

### Edge Function `tienda-seo` y nginx

`robots.txt` y `sitemap.xml` los sirve la Edge Function `supabase/functions/tienda-seo` (`verify_jwt = false`, contrato en
`openapi/tienda-seo.json`) detrás de `location ~ ^/(robots\.txt|sitemap\.xml)$` de `apps/web/nginx.conf`, que manda el host original en
`X-Tienda-Host`. La configuración de despliegue (sin variables nuevas en runtime) está en «SEO y posicionamiento básico» y en
`docs/deployment.md` (sección Producción › `apps/web`).

### Enlaces legales y consentimiento de cookies

- **Límites defensivos (MSF-149, migración `20270218000000`)**: la URL no admite credenciales (`https://usuario@host`: sin `@` en la
  autoridad, antes del primer `/`, `?` o `#`) y cada empresa admite como máximo **10** enlaces legales. El tope es **defensivo** (evita
  inflar el pie y la respuesta anónima), no una regla de negocio: se cambia con una migración nueva. Pruebas: pgTAP
  `tienda_legal_limites.test.sql` (que además verifica la lectura denegada a un usuario sin permiso de la sección `empresas`).
- **Cómo se cargan (D5)**: los enlaces legales (título + URL `https://`) los inserta el equipo técnico por SQL en
  `dominio.tienda_legal_enlaces`, sin pantalla ni RPC de escritura; razón social, CUIT y dirección ya se editan en Empresas.
- **Contrato para F-TDA-24 (analítica)**: `apps/web/src/lib/consentimientoCookies.ts` expone `leerConsentimiento()`
  (`'aceptadas' | 'rechazadas' | null`; `null` cuenta como rechazadas), `guardarConsentimiento(valor)`,
  `useConsentimientoCookies()` y el evento de ventana `tienda:consentimiento-cookies`. Ninguna analítica puede cargarse sin `'aceptadas'`.

### Decisiones aceptadas por el dueño (2026-11-08)

- **D1 — `estado_tienda_por_dominio` distingue «desactivada» de «desconocida»**: permite enumerar dominios desactivados y ver su nombre,
  logo, colores y tipografías. Esto **matiza explícitamente FR-025 y SC-006** (desactivada = desconocida solo para las demás funciones,
  robots y sitemap). Decisión aceptada por el dueño (2026-11-08): se mantiene así y se cambia si el cliente lo pide.
- **`legal_por_dominio` publica razón social, CUIT y dirección** de toda empresa con tienda activa, sin opt-in por tienda. Decisión
  aceptada por el dueño (2026-11-08): se mantiene así y se cambia si el cliente lo pide.
- **Pausar la tienda**: el botón «Pausar tienda» actualiza `dominio.empresas.activa`; la política `empresas_update` exige
  `private.puede_escribir()`, que hoy es el rol **Administrador** de la organización (o un superadmin con organización activa). No depende
  del nivel de la sección Empresas de un rol personalizado.

### Decisiones y supuestos (D1…D8)

| # | Supuesto adoptado | Cómo cambiarlo |
|---|---|---|
| D1 | La marca de una tienda desactivada es pública; el dominio desconocido sigue sin revelar nada. | Dejar de llamar a la función desde `SinTienda` y vuelve la pantalla genérica. |
| D2 | Relacionados: hasta 4 visibles; primero los manuales del panel (MSF-846, en su orden) y luego, para completar, los de la misma categoría, sin el actual, destacados primero y luego por nombre. | Cambiar solo `publico.relacionados_por_dominio`. |
| D3 | SEO básico: título, descripción, canónica, Open Graph, JSON-LD (organización y producto), `robots.txt`, `sitemap.xml` y `noindex` en páginas de estado, cuenta y búsqueda. | Fuera de alcance: campos SEO por producto, hreflang, analítica. |
| D4 | La tienda es una SPA: los metadatos se escriben en el cliente, sin prerender. | Otra historia (prerender o HTML desde la Edge Function). |
| D5 | Los enlaces legales los carga el equipo técnico por SQL. | Otra historia, dentro de Empresas. |
| D6 | Qué legal lleva cada marca se confirma con el cliente; el código no espera esa respuesta. | Cargar los datos reales cuando se confirmen. |
| D7 | Aviso de cookies mínimo: «Aceptar» y «Rechazar», decisión en `localStorage`, sin categorías. | Extender `consentimientoCookies.ts`. |
| D8 | SEO sin fallas en Lighthouse (categoría SEO) sobre home, catálogo, categoría, ficha y contacto de ambas tiendas, sin puntaje inventado. | — |

### Contradicciones prototipo ↔ épica (para el PR)

1. «Volvemos pronto» figura P0 en F-TDA-01 y P1 en F-TDA-19: la versión mínima ya estaba; esta épica agrega la identidad.
2. El interruptor «Store activa» ya existe en el panel (F-EMP-04); acá solo se verifica su efecto en la tienda, sin rediseñar esa pantalla.
3. El prototipo de «Productos relacionados» muestra tarjetas elegidas a mano: desde MSF-846 van primero los relacionados manuales del panel y luego se completa con la regla D2 (misma categoría); se mantienen «Sin imagen» / «Sin stock».
4. Aviso de cookies, SEO y bloque legal no tienen pantalla en el prototipo: se construyen con los componentes del template y los tokens de la tienda.

### Migraciones y reversión

Todas son aditivas; la reversión va en una migración posterior (no en el PR que las crea). Orden inverso al de aplicación:

| Migración | Reversión |
|---|---|
| `20270212100001_tienda_legal.sql` | `drop function publico.legal_por_dominio(text); drop table dominio.tienda_legal_enlaces;` |
| `20270212100002_tienda_estado_pausada.sql` | `drop function publico.estado_tienda_por_dominio(text);` |
| `20270212100003_tienda_relacionados.sql` | `drop function publico.relacionados_por_dominio(text, uuid);` |
| `20270212100004_tienda_seo.sql` | `drop function publico.seo_tienda_por_dominio(text); drop function publico.sitemap_por_dominio(text);` |

Deshacer la épica completa: `git revert -m 1 <merge>`.

## Estados especiales de la tienda (F-TDA-19, MSF-247, épica MSF-149)

Qué ve el visitante según el estado del dominio (la visión de conjunto está en «Estados, relacionados, SEO y legal» más arriba):

| Situación | Pantalla |
|---|---|
| Falla al resolver la tienda o al consultar su estado | `PantallaError`: «No pudimos cargar esta página.» con «Reintentar» y «Volver al inicio» (`role="alert"`, sin detalle técnico). Nunca se disfraza de «Volvemos pronto». |
| Dominio desconocido o inválido | «Volvemos pronto» genérica (sin marca). |
| Empresa desactivada (interruptor «Store activa», F-EMP-04) | «Volvemos pronto» con la marca de la tienda (logo o nombre, nombre comercial, colores y tipografías). |
| Ruta inexistente, producto o categoría oculto / de otra empresa | 404 «No encontramos esta página» con `BuscadorTienda` y «Volver al inicio»; el mismo mensaje en todos los casos. |

- **Función pública**: `publico.estado_tienda_por_dominio(host)` (`jsonb`, `security definer`, `anon` ejecuta). Devuelve `{ estado: 'pausada', nombre, color_primario, color_primario_oscuro, color_acento, color_fondo, tipografia_titulos, tipografia_texto, logo_ruta }` solo si la empresa del host está desactivada; `null` para host desconocido, inválido o empresa activa. Lista blanca: nunca organización, contacto ni datos fiscales. Sin tablas nuevas (esquema `publico`, solo función).
- **D1 (supuesto)**: la marca de una tienda desactivada es pública; el dominio desconocido sigue sin revelar nada. Para volver a la pantalla genérica en todos los casos basta con dejar de llamar a la función desde `SinTienda` (`pages/tienda-publica/index.tsx`).
- **Migración** `20270212100002_tienda_estado_pausada.sql`, aditiva. Reversión: `drop function publico.estado_tienda_por_dominio(text);`.
- **Front**: `lib/tiendaEstado.ts` (`resolverEstadoTienda`, `useEstadoTienda`), `VolvemosPronto.tsx`, `PantallaError.tsx` (también en `ErrorDeRuta` de `EnrutadorTienda.tsx`, sin repetir el landmark `main` dentro de la tienda) y `PaginaNoEncontrada.tsx` (buscador diferido, solo con tienda).
- **Verificación**: pgTAP `tienda_estado_pausada.test.sql`; Vitest + axe (`VolvemosPronto`, `PaginaNoEncontrada`, `PantallaError`, `index`); E2E `apps/web/e2e/tienda-estados.e2e.ts` con las dos tiendas (la pausa se aplica con el mismo campo `dominio.empresas.activa` que el botón «Pausar tienda»).

## SEO y posicionamiento básico (F-TDA-21, MSF-279, épica MSF-149)

Spec: `specs/20270125-100000-tienda-seo-legal-y-estados/` (FR-020…FR-025, SC-006…SC-008). Migración
`20270212100004_tienda_seo.sql` (aditiva, sin tablas: `publico` sigue sin tablas — Principio VII).

- **Funciones públicas** (`security definer`, `anon` ejecuta, lista blanca): `publico.seo_tienda_por_dominio(host)` →
  `{ dominio (canónico), nombre, descripcion, logo_ruta, indexable }` (la descripción es el subtítulo publicado de
  `dominio.tienda_contenido` o «<nombre> · tienda online»; `indexable` es `true`: punto de extensión del «no indexar» de borrador de
  MSF-133) y `publico.sitemap_por_dominio(host)` → `{ dominio, urls: [{ ruta, modificado }], truncado }` con inicio, catálogo, contacto,
  **páginas de contenido visibles** (`/pagina/<slug>`: son públicas, están enlazadas desde el menú y el pie y su ruta monta `CabeceraSeo`
  indexable; decisión de MSF-149, migración `20270217400100`), categorías visibles y productos efectivamente visibles
  (`private.catalogo_tienda_efectivo`), hasta 50.000 URLs (constante única `c_tope`, límite del protocolo). **Más de 50.000 URLs se
  TRUNCA** (no hay sitemap index: ninguna tienda se acerca a ese tamaño): el recorte es por prioridad —fijas y páginas, luego categorías,
  luego productos—, así que lo que se pierde son productos, nunca categorías, y `truncado: true` hace que la Edge Function lo deje en el
  log. El tope es un parámetro de la función privada `private.sitemap_urls_tienda(empresa, organización, tope)` para probar el
  comportamiento real con una cota baja (pgTAP). Host desconocido, inválido o empresa desactivada → `null` idéntico; al reactivar la empresa vuelven
  a responder sin otra acción.
- **Reversión** (migración posterior): `drop function publico.seo_tienda_por_dominio(text); drop function publico.sitemap_por_dominio(text);`.
- **`robots.txt` y `sitemap.xml`**: Edge Function `supabase/functions/tienda-seo` (`verify_jwt = false` en `supabase/config.toml`,
  contrato en `openapi/tienda-seo.json`). Tienda activa: `Allow: /` + `Sitemap: https://<dominio canónico>/sitemap.xml` y el sitemap
  con las URLs de arriba (XML escapado, `<lastmod>` si existe). Desactivada, desconocida o sin cabecera: **la misma** respuesta
  (`Disallow: /` y un `urlset` sin URLs), nunca un 404 distinto. Error de la base: 500 genérico. Pruebas: `pnpm test:edge:tienda-seo`. Las respuestas llevan `Cache-Control: public, max-age=300` y `Vary: X-Tienda-Host`
  (la URL del proxy es la misma para todas las tiendas: sin `Vary` un gateway/CDN que cachee por URL mezclaría tiendas). Las rutas del
  sitemap se validan (una sola `/` inicial, sin caracteres de control ni espacios, ≤ 2048) y las que no cumplen se descartan.
- **nginx de `apps/web`** (`location ~ ^/(robots\.txt|sitemap\.xml)$`) proxea a `<SUPABASE_URL>/functions/v1/tienda-seo/<archivo>` y manda
  el host original en `X-Tienda-Host` (más `apikey` y `Authorization` con la clave pública). La URL de Supabase y la clave pública
  salen de los mismos `ARG VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` del build: el `Dockerfile` los reemplaza en la
  configuración de nginx (marcadores `__SUPABASE_URL__` y `__SUPABASE_ANON_KEY__`), así que **no hay variables de entorno nuevas en
  runtime**. El nombre del servidor se resuelve al pedir (resolver `127.0.0.11`, el DNS de Docker/Dokploy, y `8.8.8.8` de respaldo),
  de modo que un Supabase caído no impide arrancar nginx: el buscador recibe 502 y reintenta. Si el entorno no usa el DNS de Docker,
  hay que ajustar la línea `resolver`. **Caché y límite (MSF-149)**: como `sitemap_por_dominio` arma hasta 50.000 filas para cualquier
  anónimo, nginx cachea (`proxy_cache tienda_seo`: 5 min para respuestas 200, `proxy_cache_lock`; 20 MB máx., se vacía a los 10 min sin
  uso) con clave `$http_host$uri` (el host del visitante: nunca se mezclan tiendas) y limita pedidos con `limit_req` en **dos zonas**: por
  **IP de cliente + host** (20 pedidos/s, ráfaga 100: quien insiste sobre una tienda no agota el cubo de las demás) y por **solo IP**
  (100 pedidos/s, ráfaga 200: quien rota el `Host` para abrir un cubo nuevo por pedido, y de paso llenar la caché, choca igual con este tope);
  ambos responden 429. Los cubos son holgados a propósito porque `limit_req` corre antes de la caché y cuenta también los HIT, y un crawler
  legítimo puede pedir varias veces seguidas. nginx corre en Dokploy **detrás de Traefik**, así que `$remote_addr` es la del proxy:
  `set_real_ip_from` (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.1 y fc00::/7) con `real_ip_header X-Forwarded-For` y
  `real_ip_recursive on` toman la IP real del cliente solo cuando el pedido llega desde la red del proxy; un cliente de internet no puede
  falsearla. **Requisito:** el repo no define la configuración de Traefik (`trustedIPs`/`forwardedHeaders`) ni lo que haya delante; debe
  mandar `X-Forwarded-For` con la IP del cliente. Si hubiera Cloudflare u otro proxy delante, todas las IPs serían las suyas: habría que
  sumar sus rangos con `set_real_ip_from` y usar `real_ip_header CF-Connecting-IP`. **Contenido viejo:** NO se usa `proxy_cache_use_stale`.
  Se probó con nginx real (upstream que responde 200 y luego 502, con tráfico continuo) que, con `use_stale error …`, la entrada se seguía
  sirviendo vieja sin límite (a los 5, 12, 20 y 40 s con `max-age=3, stale-if-error=3`): el `stale-if-error` del upstream **no** la acota
  (tiene menor prioridad que `proxy_cache_use_stale`) y una entrada con tráfico no vence por `inactive`. Sin stale, una tienda
  desactivada o pausada deja de verse activa a lo sumo ~10 minutos después (5 de caché de nginx + `max-age=300` en el navegador o gateway:
  esa es la ventana de «desactivada = desconocida», FR-025, con Supabase caído o no); si Supabase cae el buscador recibe 502 y reintenta.
  `stale-if-error=300` queda en la cabecera de la función solo para gateways o CDN que lo respeten. **Qué se probó:** `nginx -t` valida solo
  la sintaxis; `sh scripts/probar-nginx-tienda-seo.sh` prueba el comportamiento con nginx real en docker (IP tomada de `X-Forwarded-For`,
  429 por IP + host, 429 al rotar el `Host`, otra IP o host sin afectarse, caché separada por host y sin contenido viejo con el upstream
  caído; no corre en CI para no saturar los runners) y `supabase/functions/tienda-seo/nginx.test.ts` fija en CI los valores exactos. El
  `Dockerfile` **falla el build** si `VITE_SUPABASE_URL` o `VITE_SUPABASE_PUBLISHABLE_KEY` quedan vacíos (sin ellos el `proxy_pass` queda
  roto y robots/sitemap darían 500 sin aviso). Con el servidor de desarrollo de Vite estas dos rutas no existen (son de la imagen de producción).
- **Front**: `lib/tiendaSeo.ts` (`useSeoTienda`, una lectura por host), `pages/tienda-publica/seo/CabeceraSeo.tsx` (título «<página> | <empresa>»
  ≤ 60, descripción ≤ 160, canónica `https://<dominio canónico><ruta sin filtros>`, Open Graph y `robots`; limpia al salir de la página) y
  `seo/datosEstructurados.ts` (JSON-LD `Organization` en el inicio y `Product` en la ficha: `priceCurrency` ARS, `price` solo si es
  calculable, `availability` booleana, `<` escapado; nunca costos ni existencias). Montado en inicio, catálogo, categoría, ficha y contacto.
- **`noindex`** (`<meta name="robots" content="noindex">`): 404, «Volvemos pronto» (con y sin marca), pantalla de error, ingresar,
  recuperar y definir contraseña, y resultados de búsqueda (`/catalogo?q=`). Los errores de carga **de la página** (`ErrorConReintento` en
  ficha, página de contenido, categoría, contacto y listado del catálogo) también montan `<CabeceraSeo noindex>`; cuando conviven con la `CabeceraSeo` indexable de la página (catálogo, categoría) la pila de `seo/pilaCabecera.ts` deja UNA sola meta `robots` (gana `noindex`) y restaura bien el título al desmontar. Los errores de un
  bloque dentro de una página que sí cargó (destacados y categorías del inicio, menús, formulario de contacto) no: la página sigue
  teniendo su contenido indexable.
- **Caché de la lectura SEO**: `seoDeTienda` guarda una lectura por host y pestaña con vencimiento de 5 minutos; `recortar()` cuenta
  puntos de código (un emoji no se parte).
- **Límite conocido (D4)**: la tienda es una SPA; los buscadores que ejecutan JavaScript leen los metadatos, pero los previews de redes
  (que no lo ejecutan) pueden no leer Open Graph. Prerender queda fuera de alcance. La imagen de Open Graph de la ficha es **siempre el logo
  público de la tienda**: el bucket `productos-imagenes` es privado y su única URL es firmada y vence, así que no sirve para previews ni
  Google (que la guardan por días); el JSON-LD de la ficha tampoco lleva `image`. Cuando haya un bucket público de imágenes de producto
  (decisión D1 de F-TDA-12), se cambia solo `rutas/producto.tsx`.
- **Verificación**: pgTAP `tienda_seo.test.sql` (incluye el tope con cota baja sobre la función privada y las páginas); Vitest
  `seo/CabeceraSeo.test.tsx` y `seo/datosEstructurados.test.ts`; `handler.test.ts` de la función; E2E `apps/web/e2e/tienda-seo.e2e.ts`
  (dos tiendas y una pausada; pide `robots.txt` y `sitemap.xml` directo a la función con `X-Tienda-Host`, requiere `supabase functions
  serve` y `SUPABASE_ANON_KEY`). **Los E2E de SEO y estados hacen `test.skip` si el CI no levanta el stack (sin `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`): la cobertura real de la épica es pgTAP + `handler.test.ts` + Vitest.**
- **Verificación manual pendiente (SC-007)**: Lighthouse (categoría SEO) no corre en el repo. Pendiente: `npx lighthouse <url>
  --only-categories=seo` sobre inicio, catálogo, categoría, ficha y contacto de las dos tiendas y validación del JSON-LD de la ficha con
  el Rich Results Test; criterio de aceptación: sin fallas (D8), resultado adjunto en el PR de cierre.

## Diseño del prototipo en el front público (MSF-841, tramo B)

Spec: `specs/20261112-200000-tiendas-diseno-del-prototipo/` (matriz pantalla↔criterios incluida). El front público reproduce el
diseño de `design/pantallas/MJC_*` y `SJ_*` **sin ningún valor fijo por tienda**: todo sale de la identidad, el contenido y el
contacto de la empresa del host.

- **Identidad aplicada a TODA la tienda (causa raíz de «los colores no se aplican»)**: antes solo la sección `TemaTienda` de la portada
  leía la identidad y seteaba variables; en `/catalogo`, `/categoria`, `/producto` y `/contacto` no se aplicaba nada y en la portada los
  botones y enlaces seguían con el azul de MUI. Ahora `layout/IdentidadTiendaContexto.tsx` (`ProveedorIdentidadTienda`, montado en
  `LayoutTienda`) la lee **una vez por host** (`resolverIdentidadPublica`) y la reparte por: el tema MUI (`ProveedorTemaTienda`:
  `primary`, `primary.dark`, `secondary` = acento, tipografías de títulos y texto, fondo), las variables CSS `--tienda-*` (primario,
  primario oscuro, acento, fondo, **barra**, fuente de títulos y de texto; para portales de MUI) y el contexto (`useIdentidadTienda()`:
  logo, banners). `theme.tienda` expone además los derivados que usa el diseño: `barra`, `textoBarra`, `superficie` (el fondo mezclado
  con negro 4,3 %, el `--sf` del prototipo) y `fuenteTitulos`. Sin identidad legible la tienda sigue con el tema base. En la vista previa
  del panel la identidad llega inyectada (`ProveedorFuenteTienda`) y no se tocan variables globales.
  Además el `body` toma la tipografía de texto (`--tienda-fuente-texto`) y los enlaces del menú de categorías la de títulos: sin esto, lo que
  no es tipografía de MUI (los enlaces del menú) salía en la serif por defecto del navegador.
- **Destello de tema (decisión)**: no se espera la petición de identidad para pintar; la tienda arranca con el tema base neutro y pasa a
  la identidad al llegar, así el contenido no espera un pedido más. Es un destello conocido y aceptado. Para no sumar saltos de diseño, la
  barra superior reserva su altura (36 px / 28 px en celular) mientras llega el contacto.
- **Sin pedidos de más**: el layout también lee **una sola vez** el contenido (`ProveedorContenidoTienda`), el contacto
  (`ContextoContactoTienda`) y las categorías (`ContextoCategoriasTienda`); `useContenidoPublico`, `useContactoTienda` y
  `useCategoriasTienda` usan el compartido si existe (barra, menú, pie, portada y `/contacto` comparten la misma lectura) y, sin layout
  (vista previa, tests), leen por su cuenta.
- **Tipografías**: los títulos usan la tipografía de títulos (variantes `h1…h6` del tema) y el cuerpo la de texto. No se espera la
  petición de identidad para pintar (la tienda arranca con el tema base neutro y pasa a la identidad al llegar); la hoja de Google Fonts
  se pide con `display=swap` y `preconnect` a `fonts.googleapis.com` / `fonts.gstatic.com` para acortar el cambio de fuente.
- **Barra superior** (`layout/BarraSuperior.tsx`): 36 px (28 px en celular), fondo `colorBarra`, texto blanco de 13 px (12 px en celular). Izquierda: el
  `eslogan`; sin eslogan, el mensaje de **bienvenida**. Derecha (solo desde `md`): WhatsApp (enlace `wa.me`) y correo (`mailto:` con el correo codificado) de
  `contacto_por_dominio`. Un dato ausente no se muestra y sin nada que mostrar no hay barra. `secciones/BarraBienvenida` ya no duplica el
  texto: dentro del layout solo se dibuja si hay eslogan **y** una bienvenida distinta (franja primaria en la portada); en la vista previa
  del panel (sin layout) se dibuja como antes.
- **Encabezado y categorías**: fila de marca (logo a la izquierda; sin logo, el nombre en texto), buscador (flexible: hasta 560 px desde `md`, se encoge si falta
  lugar para que «Inicio» / «Contacto» no pasen a otra fila; campo de 44 px con botón de lupa en el color primario) y «Inicio» / «Contacto» (`nav` «Principal»); debajo, la barra de categorías
  (`layout/MenuCategorias`) en mayúsculas, 15 px, 600, subrayado de 3 px en la activa (primario). Conserva el tope de 6 principales +
  «Más categorías» de MSF-825. Sin categorías no hay barra. El menú de celular (`MenuMovil`) no cambió.
- **Pie oscuro** (`layout/PieCategorias`): fondo `colorBarra`, logo en blanco (`filter: brightness(0) invert(1)`; **subí el logo en PNG/SVG con fondo transparente**: con fondo sólido se ve un recuadro blanco; la pestaña Identidad lo avisa) o el nombre, eslogan,
  el texto del pie configurado (`contenido.pie`, ahora en todas las páginas y no solo en la portada; `secciones/PieTienda` queda solo para la
  vista previa), columnas Categorías, Información (páginas de contenido), Contacto (WhatsApp, correo, «Escribinos»), el bloque legal y la
  línea «© año {empresa}. Todos los derechos reservados.» (el nombre sale de la tienda). El texto del pie no se atenúa con opacidad (contraste
  AA sobre `colorBarra`); el texto secundario del tema se calcula para llegar a 4,5:1 sobre el fondo y sobre la superficie de las tarjetas.
- **Tarjetas de categoría con foto** (`secciones/CategoriasInicio`): la ruta `imagen` de `categorias_por_dominio` se firma con
  `urlsImagenesProducto` (una sola llamada por bloque; el bucket es privado) y se muestra en un recuadro de 120 px; sin foto o si no se
  pudo firmar, el recuadro neutro. Desde MSF-846 (`20270305100100_tienda_vista_previa_categorias_imagen.sql`) la vista previa del panel
  (`vista_previa_tienda`) también trae `imagen`, calculada sobre los productos efectivos del borrador, y el panel muestra la foto; sin foto, el recuadro
  neutro.
- **Bloque «Consultas por WhatsApp / Escribinos»** (`secciones/ConsultasInicio`, final de la portada): ícono + WhatsApp de la tienda y
  «Escribinos» (a `/contacto`, con el correo si lo hay); sin WhatsApp, solo «Escribinos»; un WhatsApp que no se puede llevar a dígitos se muestra como texto, sin enlace. No se muestra en la vista previa (no lee `publico.*`).
- **Diferencias conocidas con el prototipo**: la franja oscura del héroe de la portada no es del layout sino de los banners configurados
  (`BannerHome`); la tarjeta de producto y la ficha no se tocaron en este tramo; el menú de celular no tiene el logo ni el buscador como ícono; las categorías sin productos no se muestran (el prototipo trae «Skins y calcos, 0 productos»); en celular el encabezado pone la marca a la izquierda y el menú a la derecha (el prototipo: menú a la izquierda, logo al centro, lupa a la derecha).
