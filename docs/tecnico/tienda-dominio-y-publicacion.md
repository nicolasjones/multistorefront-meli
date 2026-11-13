---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - supabase/functions
  - supabase/tests/database
  - apps/web/src
---

# Tienda online: dominio, publicación y versiones (MSF-133)

Spec: `specs/20270125-100000-tienda-dominio-y-publicacion/spec.md` · plan, tareas y contratos en la misma
carpeta (`contracts/tienda-dominio-publicacion.md`).
Épica **MSF-133** — Tiendas online · Tienda dominio y publicación. Historias: **F-TDA-05** (dominio,
verificación DNS y certificado, `MSF-198`), **F-TDA-06** (borrador, vista previa y publicación, `MSF-216`)
y **F-TDA-07** (versiones y restauración, `MSF-235`); cierre de la épica: `MSF-779`.
Rama de la épica: `epic/MSF-133-tiendas-online-tienda-dominio-y-publicac` (head `8fb3a8d8`).
Depende de **MSF-147** (dominio, identidad y catálogo visible: `dominio.tiendas`,
`dominio.tienda_identidad`, `dominio.tienda_contenido`, `dominio.categorias_tienda`,
`dominio.productos_tienda`). Relacionadas sin bloqueo: **MSF-167** (catálogo y ficha) y **MSF-191**
(inicio, búsqueda y móvil), cuyas pantallas públicas alimenta la vista previa.
Resumen de producto y límites: [Dominio, publicación y versiones de la tienda](../producto/tienda-dominio-y-publicacion.md).

## Alcance de entrega

- **`supabase`:** tres migraciones **aditivas** (una por historia), RPC de `public`, una función en
  `publico`, una Edge Function y pgTAP.
- **`refine`:** pestaña **«Dominio y publicación»** dentro de *Empresas › empresa › Tienda*, vista previa
  autenticada y fuente de datos inyectable en las secciones públicas.
- **Sin** `kestra`, `superset`, `workers` ni Compose nuevo.

| Historia | Issue | Migración | Contenido | Reversión |
|---|---|---|---|---|
| F-TDA-05 | MSF-198 | `supabase/migrations/20270203130000_tienda_dominio_verificacion.sql` | Columnas nuevas de `dominio.tiendas`, `dominio.tienda_registros_dns`, `public.tienda_dns_plataforma`, `configurar_dominio_tienda`, `obtener_dominio_tienda`, `preparar_verificacion_tienda`, `registrar_verificacion_dns`, `private.promover_dominio_pendiente`, `publico.redireccion_por_dominio` | `drop` de funciones y tablas nuevas; `alter table dominio.tiendas drop column …` de las nueve columnas nuevas |
| F-TDA-06 | MSF-216 | `supabase/migrations/20270203130100_tienda_borrador_publicacion.sql` | `dominio.tienda_borrador`, `dominio.tienda_versiones` (con backfill de la versión 1), `private.validar_tienda_*`, `guardar_borrador_tienda`, `obtener_borrador_tienda`, `descartar_borrador_tienda`, `publicar_tienda`, `vista_previa_tienda`, `rutas_tienda_sin_referencia` y `revoke` de las tres `guardar_*` | reponer el `grant execute` de las tres `guardar_*` a `authenticated`; `drop` de funciones y las dos tablas |
| F-TDA-07 | MSF-235 | `supabase/migrations/20270203130200_tienda_versiones.sql` | `listar_versiones_tienda` y `restaurar_version_tienda` (**sin tablas nuevas**) | `drop function public.restaurar_version_tienda(uuid, integer); drop function public.listar_versiones_tienda(uuid);` |

La reversión completa está en el encabezado de cada migración. **Orden de reversión:** versiones → borrador y
publicación → dominio.

## Modelo de datos

Cuatro tablas nuevas y una alterada. El DER completo (con leyenda y Mermaid) está en
[Datos y DER](datos.md#dominio-publicacion-y-versiones-de-la-tienda-msf-133).

| Tabla | Clave / reglas principales |
|---|---|
| `dominio.tiendas` (**alterada**) | Gana `dominio_redireccion`, `dominio_pendiente`, `token_verificacion` (uuid hex, no secreto), `dominio_verificado_at`, `ultima_verificacion_at`, `certificado_estado` (`pendiente`\|`activo`\|`error`), `certificado_verificado_at`, `verificacion_solicitada_at` y `verificacion_solicitada_por`. Unicidad a nivel plataforma de `dominio_pendiente` y `dominio_redireccion`; `check` de formato de dominio y de que la redirección sea distinta del principal. |
| `dominio.tienda_registros_dns` | PK `(empresa_id, tipo)`; `tipo` ∈ `A`\|`CNAME`\|`TXT`, `estado` ∈ `correcto`\|`incorrecto`\|`pendiente`; guarda `valor_encontrado` y `comprobado_at`. FK compuesta `(empresa_id, organizacion_id)` a `dominio.empresas`. |
| `public.tienda_dns_plataforma` | **Fila única** (`id boolean primary key default true check (id)`): `ip_publica`, `cname_destino`, `prefijo_txt`. Configuración **de plataforma**, por eso vive en `public` y no tiene `organizacion_id`. La siembra valores de documentación (`203.0.113.24`, `tiendas.plataforma.example.com`, `gc-verify`); los reales los carga el equipo técnico por SQL. |
| `dominio.tienda_borrador` | PK `empresa_id`; un `jsonb` por área (`identidad`, `contenido`, `catalogo`), `updated_by`, `updated_at`. Un área ausente = sin cambios; sin áreas = sin borrador. |
| `dominio.tienda_versiones` | PK `(empresa_id, numero)`; `publicada_at`, `publicada_por`, `resumen`, `cambios jsonb` e `instantanea jsonb` con el estado vivo de las tres áreas (en `catalogo`, solo las filas que difieren del predeterminado). |

- **El borrador y las versiones no se exponen a `anon`:** ninguna función de `publico` los lee y las tablas
  nacen con `revoke all … from public, anon, authenticated`.
- **Precios, stock y estado activo de los productos no pasan por el borrador** (FR-063): se leen siempre en
  vivo, en la tienda y en la vista previa.

## Contratos

### Dominio (F-TDA-05)

| RPC / función | Devuelve | Errores / reglas |
|---|---|---|
| `public.configurar_dominio_tienda(empresa uuid, dominio text, redireccion text)` | `{ dominio_vigente, dominio_pendiente, redireccion }` | `security definer`; exige edición en Empresas y que la empresa sea de la organización de la sesión (`42501 sin_permiso`). Normaliza (minúsculas, sin puerto ni punto final) y exige unicidad a nivel plataforma entre **principales, pendientes y redirecciones de todas las tiendas** (los tres campos se comparan entre sí, con candado de transacción `pg_advisory_xact_lock` por alta). Errores por campo: `dominio_invalido` y `redireccion_invalida` (`22023`), `dominio_en_uso` y `redireccion_en_uso` (`23505`). Si falla no guarda nada. Crea la fila de `dominio.tiendas` si la empresa no tenía tienda. |
| `public.obtener_dominio_tienda(empresa uuid)` | `{ dominio_vigente, dominio_pendiente, redireccion, dominio_verificado, certificado, ultima_verificacion, registros[] }` | `registros[]` con `{ tipo, nombre, valor, estado, encontrado }`, calculados en el servidor con `public.tienda_dns_plataforma` y el token propio de la tienda: **A** `@` → IP pública; **CNAME** del «Redirigir también» → destino de la plataforma (solo si hay redirección); **TXT** `_verif` → `<prefijo>=<token>`. |
| `public.preparar_verificacion_tienda(empresa uuid)` | `{ dominio, redireccion, token, ip_publica, cname_destino, prefijo_txt }` | Valida edición en Empresas y pertenencia a la organización. Aplica el **límite de frecuencia de 10 s** por tienda. Errores: `sin_permiso`, `sin_dominio`, `demasiado_pronto`. Devuelve los hostnames **guardados**, nunca los del request. |
| `public.registrar_verificacion_dns(empresa uuid, dominio text, redireccion text, resultados jsonb, certificado text)` | — | **Ejecutable solo por `service_role`** (la ejecuta la Edge Function). Rechaza con `verificacion_obsoleta` un resultado sin verificación pedida o cuyo dominio o redirección guardados cambiaron desde entonces (usa `verificacion_solicitada_at` / `verificacion_solicitada_por`). |
| `publico.redireccion_por_dominio(host text)` | `{ dominio_principal }` o `null` | `security definer`, `stable`, ejecutable por `anon` y `authenticated`. Lista blanca: solo el dominio principal. Host desconocido y empresa desactivada devuelven lo mismo (`null`): anti-enumeración. |

- **Dominio nuevo sin cortar el vigente (D5).** Un principal distinto del vigente queda en
  `dominio_pendiente` y reinicia la verificación; la tienda sigue resolviendo por `dominio`. Cuando el
  pendiente queda **verificado con certificado activo**, `private.promover_dominio_pendiente` lo intercambia
  (y el trigger deja `tienda.dominio_configurado`).
- **Verificado** = registro **A** y **TXT** correctos (y **CNAME** si hay redirección). Con dominio verificado,
  la función intenta la conexión TLS: válida → `activo`; sin emitir → `pendiente`; inválida o vencida →
  `error`.

### Borrador y publicación (F-TDA-06)

| RPC | Devuelve | Errores / reglas |
|---|---|---|
| `public.guardar_borrador_tienda(empresa uuid, area text, datos jsonb)` | — | `area` ∈ `identidad`\|`contenido`\|`catalogo`. Valida con **las mismas reglas** que las RPC vivas (colores `#RRGGBB`, tipografías de la lista cerrada, longitudes 120/300/80, destino del botón, visibilidad), extraídas a `private.validar_tienda_*`. Un valor inválido no se guarda. |
| `public.obtener_borrador_tienda(empresa uuid)` | `{ hay_borrador, identidad, contenido, catalogo, cambios: { total, resumen, detalle[] }, version_vigente, en_linea }` | El **resumen de cambios se calcula en el servidor** por áreas y campos tocados. `version_vigente` trae `{ numero, publicada_at, publicada_por }`. |
| `public.descartar_borrador_tienda(empresa uuid)` | — | Borra el borrador. Evento `tienda.borrador_descartado`. |
| `public.publicar_tienda(empresa uuid)` | `{ version }` (`null` si no había borrador) | **Transaccional**: bloquea la empresa, aplica cada área del borrador con las RPC vivas, crea la versión siguiente con su instantánea y resumen y borra el borrador. **Idempotente**: sin borrador no crea versión. Evento `tienda.publicada`. |
| `public.vista_previa_tienda(empresa uuid)` | `jsonb` | Borrador superpuesto a lo publicado. Identidad y contenido salen del borrador si existe; el precio final y la **disponibilidad** (solo el booleano de `private.disponible_publico`) son los de vivo, y el catálogo efectivo sale con `private.catalogo_tienda_efectivo_borrador`. Lista blanca: **nunca** costos, cantidades exactas de stock ni proveedor. |
| `public.rutas_tienda_sin_referencia(empresa uuid, rutas text[])` | Rutas que ya no referencia ni el borrador ni ninguna versión | Limpieza de archivos huérfanos; la RPC es el único filtro fiable (el del cliente es solo un consejo). |

- **BREAKING (FR-052).** `public.guardar_tienda_identidad`, `public.guardar_tienda_contenido` y
  `public.guardar_catalogo_tienda` **dejan de ser ejecutables por `authenticated`**; la firma no cambia y
  solo las invoca `public.publicar_tienda` (`security definer`). Así todo cambio visible pasa por una versión.
  **MSF-841** agrega `p_color_barra text default null` a `guardar_tienda_identidad` y `p_eslogan text default null`
  a `guardar_tienda_contenido`, al final y sin cambiar la regla de ejecución (ver
  [Diseño del prototipo](tienda-diseno-del-prototipo.md)).
- **El resumen de cambios lo arma la base** (`private.detalle_cambios_tienda` y `private.resumen_cambios_tienda`)
  con etiquetas legibles: `colores`, `tipografías`, `logo`, `banner`, `banner móvil`, `texto del banner`,
  `botón del banner`, `mensaje de bienvenida`, `eslogan`, `pie de página`, `aviso de la ficha`,
  `botón de contacto`, `N categorías`, `N productos visibles` y `N destacados`. El color de la barra
  (`color_barra`) cuenta dentro de `colores`. El número del aviso («N cambios sin publicar») cuenta
  esas etiquetas, no los campos individuales: el texto lo arma `textoAvisoCambios` en
  `apps/web/src/lib/tiendaBorrador.ts`.
- La versión 1 «Configuración inicial» de las tiendas ya existentes la crea la migración de F-TDA-06 (backfill
  aditivo, no hay script de arranque).
- Los archivos del bucket `tienda-identidad` referenciados por el borrador o por alguna versión **no se borran**.

### Versiones (F-TDA-07)

| RPC | Devuelve | Errores / reglas |
|---|---|---|
| `public.listar_versiones_tienda(empresa uuid)` | `{ numero, publicada_at, publicada_por, cambios, vigente }[]` | Últimas **100**, la más nueva primero; `publicada_por` es el **nombre**, no un identificador; `vigente` marca la de número mayor. Lectura con nivel `lectura` o `edicion` en Empresas. |
| `public.restaurar_version_tienda(empresa uuid, numero integer)` | `{ omitidos }` | Exige `edicion`. **No publica**: reemplaza el borrador entero con la instantánea de esa versión, omitiendo productos y categorías que ya no existen. Si el resultado coincide con lo publicado, el borrador queda vacío. La versión vigente no se restaura (`22023`). Evento `tienda.version_restaurada`. |

- Publicar el borrador restaurado crea una **versión nueva**: el historial nunca se reescribe ni se borra.

### Edge Function `verificar-dominio-tienda`

`supabase/functions/verificar-dominio-tienda/` (`index.ts`, `handler.ts`); contrato en
`openapi/verificar-dominio-tienda.json`.

```
POST /verificar-dominio-tienda   { "empresa_id": "<uuid>" }   Authorization: Bearer <JWT de la persona>
200 { dominio_verificado, certificado, registros[] }
400 { error: "solicitud_invalida" | "sin_dominio" }
401 { error: "no_autenticado" }   403 { error: "sin_permiso" }
429 { error: "demasiado_pronto" }  502 { error: "dns_no_disponible" }
```

- Autentica con el JWT de la persona y llama `public.preparar_verificacion_tienda` (permiso + límite de 10 s).
- Consulta DNS **solo de los hostnames guardados** de esa tienda: A, TXT `_verif` y el CNAME de la redirección.
- La comprobación TLS se intenta **solo con el dominio verificado** y conecta contra la **IP de la plataforma**
  guardada en la base, no contra una IP resuelta del DNS del usuario (evita SSRF).
- Escribe con `public.registrar_verificacion_dns` (service-role). **La service-role key vive solo en la
  función**: nunca llega al navegador.
- Un fallo de red o DNS responde `502` **sin tocar ningún estado guardado**.

### Auditoría (F-AUD-01)

Eventos en `public.registro_actividad`, con payload mínimo (empresa, actor y **nombres** de campos o áreas,
nunca valores): `tienda.dominio_configurado` (ya existía; también al guardar el pendiente),
`tienda.dominio_verificado`, `tienda.publicada`, `tienda.borrador_descartado`, `tienda.version_restaurada`.

## Frontend

| Ruta / pieza | Archivos |
|---|---|
| Pestaña «Dominio y publicación» (clave `publicacion`, `/empresas/:id/tienda/publicacion`) | `apps/web/src/pages/empresas/tienda/pestanas.ts`, `pestanas/publicacion.tsx` |
| Composición por `orden` (`import.meta.glob('./publicacion/*.tsx')`) | `Dominio.tsx` (`orden` 10), `Publicacion.tsx` (20), `Versiones.tsx` (25), `VistaPrevia.tsx` (30) |
| Dominio: campos, avisos, tabla de registros y «Verificar ahora» | `pestanas/publicacion/Dominio.tsx`, `apps/web/src/lib/tiendaDominio.ts`, `apps/web/src/hooks/useDominioTienda.ts` |
| Publicación: estado, versión vigente, «Ver cambios» y diálogos | `pestanas/publicacion/Publicacion.tsx` |
| Versiones: tabla y diálogo «Restaurar versión» | `pestanas/publicacion/Versiones.tsx`, `apps/web/src/hooks/useVersionesTienda.ts` |
| Borrador, publicación y vista previa (cliente de RPC) | `apps/web/src/lib/tiendaBorrador.ts`, `apps/web/src/hooks/useBorradorTienda.ts` |
| Vista previa a página completa | `apps/web/src/pages/empresas/tienda/VistaPreviaTienda.tsx`, ruta en `apps/web/src/App.tsx` |
| Fuente de datos inyectable de las secciones públicas | `apps/web/src/lib/fuenteTienda.tsx`, `apps/web/src/pages/tienda-publica/secciones/TemaTienda.tsx` |
| Redirección del dominio secundario en el front público | `apps/web/src/pages/tienda-publica/index.tsx` |

- **Textos visibles** (verificados en el código): «Esta empresa todavía no tiene dominio», «Dominio principal»,
  «Redirigir también», «Guardar dominio», «Verificar ahora», «Verificando registros DNS…», «DNS verificado
  correctamente», «Dominio verificado» / «Dominio sin verificar», «Certificado SSL activo» / «Certificado
  pendiente» / «Certificado con error», «Correcto» / «Incorrecto» / «Pendiente», «Estado: publicada» /
  «Estado: fuera de línea», «En línea» / «Fuera de línea», «N cambios sin publicar: …», «Ver cambios»,
  «Hay cambios sin publicar.» / «No hay cambios sin publicar.», «Descartar», «Guardar y publicar», «Store
  publicada», «Cambios descartados», «Versión restaurada como borrador», «Se cerró el diálogo porque cambió la
  empresa activa. No se aplicó nada.».
- **Empresa activa (Principio VIII).** La pestaña opera sobre la empresa activa de la barra superior. Al
  cambiarla se invalidan y recargan todas las consultas, se descartan los cambios sin guardar con aviso y los
  diálogos abiertos se cierran con aviso («Se cerró el diálogo porque cambió la empresa activa. No se aplicó
  nada.» / «No se restauró nada.»). No queda ningún dato de la empresa anterior.
- **Acceso.** Solo con **edición en Empresas** (mismo criterio que MSF-147); sin edición, la pestaña no existe y
  la URL no abre. La vista previa (`/empresas/:id/tienda/vista-previa`) exige la misma edición.
- **Front público.** `main.tsx` decide por `Host` si sirve la tienda o el panel (`VITE_PANEL_HOSTS`). Si
  `publico.tienda_por_dominio` no devuelve fila, el front consulta `publico.redireccion_por_dominio` y, si
  hay dominio principal, redirige con `location.replace` conservando ruta, query y hash.
- **Carga diferida.** La pestaña y la vista previa se cargan con `lazy`; la tabla de versiones y la vista previa
  no entran al recorrido inicial de la gestión.

## Seguridad y aislamiento

- Las cuatro tablas nuevas tienen **RLS** por organización (`private.organizacion_id()`) y nivel
  `private.nivel_seccion('empresas')` en `lectura` o `edicion`. Nacen con `revoke all … from public, anon,
  authenticated` y `grant select … to authenticated`: **nadie escribe por tabla**.
- Toda RPC nueva lleva `revoke execute … from public, anon` y `grant execute … to authenticated`; la única
  excepción es `public.registrar_verificacion_dns`, **exclusiva de `service_role`**.
- `anon` sigue ejecutando **solo** funciones de `publico`; la nueva es `publico.redireccion_por_dominio`.
  `publico` **no tiene tablas** (lo verifica el pgTAP).
- El borrador, las versiones y la vista previa **no son accesibles sin sesión**; la vista previa lleva
  `<meta name="robots" content="noindex,nofollow">` y no tiene URL pública.
- El bucket `tienda-identidad` sigue siendo de **lectura pública** (las imágenes se muestran sin sesión). Las
  rutas llevan un UUID y no son adivinables; los archivos de un borrador no se enlazan desde `publico.*` hasta
  publicar. Es un límite aceptado y documentado.

## Operación

- **DNS por entorno.** `public.tienda_dns_plataforma` es la fila única que dice a dónde debe apuntar cualquier
  tienda. La migración siembra valores de documentación; el equipo técnico carga los reales por SQL:

  ```sql
  update public.tienda_dns_plataforma
     set ip_publica = '<IP pública de la plataforma>',
         cname_destino = '<host de destino del CNAME>',
         prefijo_txt = 'gc-verify',
         updated_at = now();
  ```

- **Alta técnica por SQL** (primera carga) sigue siendo válida: `dominio.tiendas` acepta el alta directa; el
  dominio se guarda normalizado y es único a nivel plataforma.
- **Certificado SSL.** Lo emite el proveedor de alojamiento de la aplicación pública (**a confirmar**, D1); esta
  épica **no** llama a su API: la app solo informa el estado que deduce de la comprobación TLS. El equipo
  técnico agrega cada dominio en el proveedor.
- **Edge Function.** Requiere `Deno.resolveDns`, `Deno.connect` y `Deno.startTls` en el runtime de Edge
  Functions self-hosted. Validarlo al desplegar; si no estuvieran, la verificación debe moverse a un worker en
  `workers/` con el mismo contrato.
- **`publico` expuesto en la API.** La redirección nueva está en el mismo esquema que el resto: si `publico` no
  está en `PGRST_DB_SCHEMAS` / `SUPABASE_API_SCHEMAS` (ni en `supabase/config.toml` en local), no resuelve.
- **Migraciones.** Aplicar en orden (`20270203130000`, `…130100`, `…130200`). Son aditivas; la reversión está
  en el encabezado de cada archivo.
- **Sin caché** de las respuestas públicas.

## Guía de prueba

### Prerrequisitos

- **Rol:** Administrador de la organización (necesita **edición en Empresas**). Con otro rol, la pestaña no
  aparece y la URL responde con el patrón de acceso restringido.
- **Stack:** `pnpm dev:supabase` corriendo (Postgres + Auth + Storage local) y el panel en `pnpm dev`.
- **Datos:** dos empresas de **organizaciones distintas** (para comprobar el aislamiento) y una tienda con
  identidad, contenido y catálogo cargados.
- **DNS:** la verificación real consulta DNS. Para probar sin internet se usa el E2E, que **simula** el
  resultado llamando `public.registrar_verificacion_dns` con la service-role key **desde Node** (el navegador
  nunca la ve). A mano, el dominio que se use debe tener los registros correctos.
- **URL:** panel en `http://localhost:5173`; la tienda pública, en el dominio configurado
  (`mundojc.localhost:4300` y `sanjavucho.localhost:4300` con el seed local).

### Pasos (a mano)

**A. Conectar y verificar el dominio**

1. Entrá a **Canales → Empresas**, hacé clic en **Tienda** de la empresa y abrí la pestaña **Dominio y publicación**.
   - *Se ve:* la sección **Dominio** con los campos **Dominio principal** y **Redirigir también**, el botón
     **Guardar dominio** y —si la tienda no tiene dirección— el estado vacío «Esta empresa todavía no tiene
     dominio».
2. Escribí un dominio (por ejemplo `tienda-ejemplo.com.ar`) y hacé clic en **Guardar dominio**.
   - *Se ve:* «Dominio guardado.» y la tabla de registros con las columnas **Tipo**, **Nombre**, **Valor** y
     **Estado**.
3. Cargá en tu proveedor de DNS los valores de la tabla: **A** `@` → la IP pública de la plataforma; **TXT**
     `_verif` → `<prefijo>=<token>`; **CNAME** del dominio de redirección → el destino de la plataforma (solo si
     configuraste «Redirigir también»).
4. Hacé clic en **Verificar ahora** (el botón queda apagado mientras el dominio tenga cambios sin guardar: primero hay que guardarlo).
   - *Se ve:* «Verificando registros DNS…» y, al terminar, «DNS verificado correctamente» con cada registro en
     **Correcto**, el chip «Dominio verificado» y el estado del certificado.
5. Repetí el paso 4 con un registro mal cargado.
   - *Se ve:* ese registro en **Incorrecto** (con el valor encontrado debajo) o **Pendiente**, el chip «Dominio sin
     verificar» y que **no** se comprueba el certificado.
6. Guardá un dominio ya usado por otra tienda.
   - *Se ve:* el error en el campo y **no** se guarda nada; la tienda sigue respondiendo en el dominio vigente.
7. Guardá un dominio nuevo distinto del vigente.
   - *Se ve:* el texto «Pendiente de verificación. Hoy la tienda responde en `<dominio vigente>`.» y la tienda
     sigue accesible en el anterior.
8. Con «Redirigir también» configurado, abrí la tienda con ese dominio en el navegador.
   - *Se ve:* redirige al dominio principal.

**B. Preparar, publicar y descartar**

1. En la pestaña **Identidad visual** (o **Contenido** / **Catálogo visible**) cambiá un color y hacé clic en
   **Guardar**.
   - *Se ve:* el aviso de cambios guardados; la tienda pública **no** cambia todavía.
2. Volvé a la pestaña **Dominio y publicación**.
   - *Se ve:* «1 cambio sin publicar: …» (o «N cambios sin publicar: …»), el botón **Ver cambios** y la tarjeta
     con «Hay cambios sin publicar.», **Descartar** y **Guardar y publicar**.
3. Hacé clic en **Ver cambios**.
   - *Se ve:* el detalle por área con los campos tocados, **sin los valores**.
4. Hacé clic en **Guardar y publicar** y confirmá en el diálogo **Publicar cambios**.
   - *Se ve:* «Store publicada», el aviso de cambios desaparece y la tienda pública muestra el cambio al
     instante. La versión vigente sube un número.
5. Hacé clic en **Descartar** y confirmá en el diálogo **Descartar cambios**.
   - *Se ve:* «Cambios descartados»; las pestañas vuelven a lo publicado.
6. Cambiá el precio o el stock de un producto y mirá la tienda y la vista previa.
   - *Se ve:* ambos reflejan el cambio **al instante**, sin pasar por el borrador.

**C. Versiones y restauración**

1. Con al menos dos versiones publicadas, mirá la sección **Versiones**.
   - *Se ve:* la tabla **Versión**, **Fecha**, **Por**, **Cambios**, de la más nueva a la más vieja; **Restaurar**
     en todas menos en la vigente.
2. Hacé clic en **Restaurar** en una versión anterior y confirmá en el diálogo **Restaurar versión**.
   - *Se ve:* «Versión restaurada como borrador» y el aviso «N cambios sin publicar».
3. Hacé clic en **Guardar y publicar**.
   - *Se ve:* nace una **versión nueva** (el historial no se reescribe) y la tienda muestra la versión restaurada.

**D. Aislamiento**

1. Cambiá de empresa activa con un diálogo abierto (por ejemplo, **Publicar cambios**).
   - *Se ve:* el diálogo se cierra con aviso y **no** se aplica nada de la empresa anterior.
2. Sin sesión, pedí el borrador, las versiones o la vista previa por la API.
   - *Se ve:* un error de permisos (`403`); el acceso anónimo no existe.

### Resultado esperado

- **Given** una tienda con dominio configurado, **when** el administrador carga los registros correctos y
  pulsa «Verificar ahora», **then** el dominio queda verificado, el certificado se informa y la tienda sigue
  respondiendo en el dominio vigente hasta que el nuevo esté verificado con certificado activo.
- **Given** un cambio guardado en **Identidad visual**, **Contenido** o **Catálogo visible**, **when** el
  administrador mira la tienda pública antes de publicar, **then** la tienda no lo muestra.
- **Given** un borrador, **when** el administrador pulsa «Guardar y publicar» y confirma, **then** la tienda
  muestra los cambios al instante, nace la versión siguiente y el borrador desaparece.
- **Given** una versión anterior, **when** el administrador la restaura y publica, **then** nace una versión
  nueva (el historial no se reescribe) y el contenido restaurado queda publicado.
- **Given** dos empresas de organizaciones distintas, **when** una publica o restaura, **then** la otra no cambia
  y el acceso anónimo no ve borrador, versiones ni vista previa.

### Cómo automatizarlo

Rótulos propuestos por criterio (`[MSF-xxx:T0yy]`, `xxx` = historia y `T0yy` = tarea de `tasks.md`). El E2E
ya trae su rótulo; **el resto todavía no lo lleva dentro del archivo de test** (queda pendiente de automatizar
como tal):

| Rótulo | Criterio | Qué automatiza | Estado |
|---|---|---|---|
| `[MSF-198:T004]` | FR-002…FR-014, SC-001/002/004 | pgTAP: aislamiento, unicidad, normalización, pendiente sin cortar el vigente, `anon` solo con `publico.redireccion_por_dominio`, `publico` sin tablas, permisos por sección, fila de actividad | Existe: `supabase/tests/database/tienda_dominio_verificacion.test.sql` (sin rótulo dentro) |
| `[MSF-198:T007]` | FR-006, FR-009…FR-012, SC-005 | Deno test con DNS/TLS simulados: correctos/incorrectos/ausentes, certificado válido/pendiente/error, sin permiso, límite de 10 s y no conectar a un host cuyo A no apunta a la plataforma | Existe: `supabase/functions/verificar-dominio-tienda/handler.test.ts` (sin rótulo dentro) |
| `[MSF-198:T008]` | FR-001, FR-007, FR-016…FR-018, SC-006, SC-011 | Vitest + axe: tabla y estados, «Verificar ahora» con progreso y errores, dominio inválido/duplicado, redirección, estado vacío, cambio de empresa con campos sin guardar, 320/768/1440 | Existe: `apps/web/src/pages/empresas/tienda/Dominio.test.tsx` (sin rótulo dentro) |
| `[MSF-216:T016]` | FR-050…FR-052, FR-056, FR-058, FR-061…FR-064, SC-007 | pgTAP: guardar en borrador no cambia `publico.*`; `anon` sin acceso; las tres `guardar_*` no ejecutables por `authenticated`; publicar transaccional, idempotente y con versión; versión 1; vista previa sin costos; aislamiento; archivos referenciados | Existe: `supabase/tests/database/tienda_borrador.test.sql` (sin rótulo dentro) |
| `[MSF-216:T017]` | FR-051, FR-053…FR-060, FR-065, FR-066, FR-070, SC-012, SC-014 | Vitest + axe: aviso con resumen, «Ver cambios», diálogos y mensajes, «Fuera de línea», sin borrador, precio/stock en vivo, «no indexar», diálogo abierto al cambiar de empresa, 320/768/1440 | Existe: `apps/web/src/pages/empresas/tienda/Publicacion.test.tsx` (sin rótulo dentro) |
| `[MSF-235:T022]` | FR-071, FR-073…FR-075 | pgTAP: `anon` sin acceso, aislamiento, restaurar reemplaza el borrador sin tocar lo publicado, omite elementos eliminados, no reescribe el historial, permisos | Existe: `supabase/tests/database/tienda_versiones.test.sql` (sin rótulo dentro) |
| `[MSF-235:T023]` | FR-071, FR-072, FR-076, FR-077, SC-013 | Vitest + axe: tabla sin «Restaurar» en la vigente, diálogo con y sin aviso, mensaje, cambio de empresa con el diálogo abierto, 320/768/1440 | Existe: `apps/web/src/pages/empresas/tienda/Versiones.test.tsx` (sin rótulo dentro) |
| `[MSF-779:T024]` | SC-003 | E2E Playwright con dos empresas: alta de dominio, verificación con DNS simulado, borrador, publicar, restaurar la versión 1 y publicar de nuevo; `anon` solo ve lo publicado y la otra empresa no cambia | Existe **con rótulo**: `apps/web/e2e/tienda-publicacion.e2e.ts` |

```bash
pnpm dev:supabase
pnpm --filter @platform/web test
pnpm --filter @platform/web test:e2e tienda-publicacion
```

El E2E se omite sin el stack local (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`) y
**aborta** si `SUPABASE_URL` no es un Supabase local: ver [E2E de la app](../e2e-app.md).

## Decisiones y supuestos

| Decisión | Supuesto adoptado | Si cambia |
|---|---|---|
| **D1** proveedor y certificado | El SSL lo emite el proveedor de alojamiento (**a confirmar**); la app solo informa el estado que deduce de la comprobación TLS y no llama a su API | Sustituir la comprobación TLS por el estado del proveedor; la pantalla no cambia |
| **D2** DNS de las dos tiendas | El seed usa dominios de prueba; el equipo técnico carga la IP, el destino CNAME y el prefijo TXT reales por entorno | `update public.tienda_dns_plataforma` (ver «Operación») |
| **D3** dónde se publica | En las pestañas de MSF-147 el botón sigue siendo **«Guardar»** y ahora guarda en el **borrador**; «Guardar y publicar» y «Descartar» viven en la pestaña **Dominio y publicación** | Agregar «Guardar y publicar» a cada pestaña |
| **D4** «Ver cambios» | Detalle desplegable por área (**Identidad visual**, **Contenido**, **Catálogo visible**; etiquetas en `ETIQUETA_AREA`, `apps/web/src/lib/tiendaBorrador.ts`) con los campos tocados, **sin valores** | Comparación de valores antes/después |
| **D5** dominio nuevo sin cortar el actual | El pendiente se promociona a principal solo con verificación **y** certificado activo | Reemplazo inmediato del dominio (riesgo: apaga la tienda) |
| **D6** restaurar con borrador existente | Restaurar **reemplaza** el borrador; el diálogo suma una línea de aviso solo si hay borrador | Restaurar fusionando con el borrador actual |
| **D7** límites técnicos | Una verificación cada 10 s por tienda; las últimas 100 versiones; prefijo TXT `gc-verify` | Constantes en la migración y en `lib/tiendaBorrador.ts` |

## Límites y deuda

- **Certificado sin proveedor confirmado (D1).** Mientras no se sepa quién emite el SSL, el estado del
  certificado es el que deduce la comprobación TLS; si el proveedor no emite todavía, queda «pendiente».
- **`public.tienda_dns_plataforma.ip_publica` solo valida el formato** (admite loopback, privadas u octetos
  > 255). La carga el equipo técnico por SQL. Trazado como **MSF-797**.
- **El timeout de 5 s de la comprobación TLS no cierra el socket colgado** (acotado por el límite de una
  verificación cada 10 s). Trazado como **MSF-797**.
- **La política de borrado del bucket `tienda-identidad` deja a un editor borrar objetos que una versión
  restaurable todavía referencia**; `public.rutas_tienda_sin_referencia` es solo el filtro del servidor y la
  limpieza del cliente es un consejo. Trazado como **MSF-796**.
- **Bucket de lectura pública:** los logos y banners de un borrador o de una versión vieja son legibles por
  quien conozca la ruta (lleva UUID, no adivinable). Aceptado y documentado: no son confidenciales a nivel de
  almacenamiento.
- **Sin reverificación periódica del DNS:** la verificación es a pedido («Verificar ahora»).
- **Colaboración simultánea en tiempo real sobre el borrador:** gana el último guardado por área; al publicar,
  el bloqueo es por empresa.
- **Fuera de alcance:** pestañas **General**, **Precios y moneda** y **Mercado Libre**; registrar el dominio en
  el proveedor o emitir el certificado; navegar catálogo, ficha y búsqueda dentro de la vista previa
  (MSF-167/191); comparar valores antes/después en «Ver cambios»; paginar o borrar versiones; editar precios,
  stock o estado activo con borrador; SEO y robots de la tienda pública (MSF-149, salvo el «no indexar» de la
  vista previa).

## Diferencias con el prototipo

- La pestaña se llama **«Dominio y publicación»** y **publica por separado**: el prototipo muestra
  «Guardar y publicar» en las pestañas de Identidad, Contenido y Catálogo; acá «Guardar» deja el cambio en el
  borrador y la publicación se hace en la pestaña nueva (D3).
- El prototipo no dibuja los estados negativos (dominio sin verificar, certificado pendiente o con error,
  tienda desactivada): se agregan con los mismos chips del prototipo, en tono de aviso.
- «Ver cambios» no tiene diálogo propio en el prototipo: es un detalle desplegable por área, sin valores (D4).
- La vista previa es una **tarjeta** dentro de la pestaña, con un botón que abre la página completa
  (`/empresas/:id/tienda/vista-previa`); el prototipo solo mostraba la tarjeta.
- En el prototipo la tabla de versiones y la de registros DNS están separadas de la sección; acá cada historia
  aporta su bloque y se compone por `orden` (`Dominio` 10, `Publicación` 20, `Versiones` 25, `Vista previa` 30).

## TODO

- **Capturas de la pantalla «Dominio y publicación»** (sección Dominio, aviso de cambios, diálogos
  «Publicar cambios» / «Descartar cambios» / «Restaurar versión», tabla de versiones y vista previa) y de la
  ruta de vista previa. **Dueño:** agente Documentador (con el stack local y la rama de la épica, porque el
  código de MSF-133 no está en `main`). Cuando existan, van en
  `docs/producto/img/tienda-dominio-y-publicacion/` y se referencian desde
  [Dominio, publicación y versiones de la tienda](../producto/tienda-dominio-y-publicacion.md). **Sin video.**
