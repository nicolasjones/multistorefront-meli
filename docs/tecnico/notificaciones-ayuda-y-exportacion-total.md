---
owner: tecnico
sources:
  - specs/20270215-100000-notificaciones-ayuda-y-exportacion-total
  - apps/web/src/components/navegacion
  - apps/web/src/ayuda
  - apps/web/src/pages/importaciones
  - apps/web/src/hooks/useExportacionTotal.ts
  - apps/web/src/lib/exportacionTotal.ts
  - workers/exportar-organizacion
  - infra/kestra/flows/exportar-organizacion.yml
  - supabase/migrations
  - supabase/tests/database
  - apps/web/e2e
---

# Notificaciones, ayuda y exportación total (MSF-224)

Épica de Plataforma con tres historias: **F-NOT-02 · MSF-378** (centro de notificaciones en el panel),
**F-CFG-02 · MSF-385** (ayuda dentro del panel) y **F-OPS-06 · MSF-396** (exportar todos los datos). El manual de
la persona que usa el sistema está en [La campanita de notificaciones](../producto/notificaciones.md),
[La ayuda dentro del panel](../producto/ayuda.md) y [Importaciones y exportaciones](../producto/importaciones.md);
esta página cubre datos, API, flujos, operación y pruebas.

!!! warning "Dónde vive el código"
    La implementación está en la línea `dokploy`: PR #810 (rama
    `epic/MSF-224-plataforma-notificaciones-ayuda-y-export`), más la revisión retroactiva en el PR #809 y el cierre
    en `a8feea0c`. Llega a `main` con la promoción de `dokploy` (PR #775 abierto contra `main`); hasta entonces las
    rutas, migraciones y pruebas citadas no existen en `main`. La spec vive en
    `specs/20270215-100000-notificaciones-ayuda-y-exportacion-total/` (`spec.md`, `plan.md`, `tasks.md`,
    `contracts/`) y en la rama de la épica.

## Alcance

- **Entrega:** `refine`, `supabase`, `kestra` y `workers`. Sin `superset`: ningún reporte nuevo.
- **No hace:** no crea tablas. Reutiliza `public.avisos_pendientes` (F-NOT-01, MSF-189) y
  `public.procesos_masivos` (F-IMP-01, MSF-206).
- **Fuera de alcance:** ir al detalle desde un aviso, preferencias propias de la campanita, exportar por empresa o
  programar exportaciones, editar la ayuda desde la UI y los avisos de seguridad de Auth.

## Modelo de datos

**Ninguna tabla nueva.** Migraciones aditivas (números reales de la rama de la épica):

| Migración | Contenido |
|---|---|
| `20270217300001_notificaciones_leido.sql` | `public.avisos_pendientes.leido_en timestamptz` (aditiva) e índice `avisos_pendientes_usuario_creado_idx (user_id, creado_en desc)` |
| `20270217300002_notificaciones_funciones.sql` | `public.listar_notificaciones`, `public.contar_notificaciones_sin_leer`, `public.marcar_notificaciones_leidas` + grants |
| `20270217300003_exportacion_total_conjuntos.sql` | `private.conjuntos_exportacion_total`, `private.exclusiones_exportacion_total`, `private.datos_exportacion_total`, `private.filas_exportacion_total` + grants al rol de worker |
| `20270217300004_exportacion_total_solicitud.sql` | `public.solicitar_exportacion_total`, bucket privado `exportaciones-organizacion` y su política de lectura |
| `20270217300005_notificaciones_contar_por_tipo.sql` | El conteo pasa a evaluar el acceso una vez por **tipo** de aviso (revisión retroactiva) |
| `20270217300006_exportacion_total_solo_admin_propio.sql` | `private.es_administrador_propio_de(uuid)`; la solicitud y la descarga exigen la membresía propia de administrador |
| `20270217300007_exportacion_total_conjuntos_nuevos.sql` | Suman `dominio.cotizacion_configuracion` y `dominio.precios_propios_empresa` a la lista permitida |

| Objeto | Esquema | Cambio |
|---|---|---|
| `public.avisos_pendientes` | `public` | **alterada**: columna `leido_en` + índice. Sin cambio de RLS ni de privilegios: sigue activada **sin políticas**, sin `select` para `authenticated` ni `anon` |
| `public.tipos_aviso` | `public` | Sin cambio: la campanita lee el catálogo de tipos de F-NOT-01 (nombre legible y sección de permisos) |
| `public.preferencias_aviso` | `public` | Sin cambio: un tipo apagado en «Avisos por correo» no se encola, así que nunca llega a la campanita |
| `public.procesos_masivos`, `public.procesos_masivos_errores`, `public.ejecuciones_worker`, `public.despachos_ejecucion` | `public` | Sin cambio de tabla ni de RLS: la exportación total registra un proceso más del contrato de F-IMP-01 |
| `public.conexiones`, `public.capacidades_ejecucion` | `public` | Sin cambio: se leen para la conexión `historial-ventas` y la capacidad `exportar-organizacion-<organizacion_id>` |
| Bucket `exportaciones-organizacion` | Storage | **nuevo**: privado, `file_size_limit` 524288000, `allowed_mime_types` `application/zip` |

Tablas y DER del grafo afectado: [Datos y DER](datos.md#notificaciones-ayuda-y-exportacion-total-msf-224).

## F-NOT-02 · Centro de notificaciones

### RPC

Las tres son `security definer` con `search_path = ''`; la persona y la organización salen **siempre** de la sesión
(`auth.uid()` y `private.organizacion_id()`), nunca de un parámetro.

| Función | Devuelve / hace | Seguridad |
|---|---|---|
| `public.listar_notificaciones(p_limite int default 20, p_antes_de timestamptz default null, p_antes_id uuid default null)` | `jsonb` `{ total, items[] }` con `id`, `tipo_nombre`, `datos`, `creado_en`, `leido_en`. Orden `creado_en desc, id desc`; cursor compuesto `(creado_en, id)`; `p_limite` acotado a 1..50 | `revoke … from public, anon`; `grant execute … to authenticated` |
| `public.contar_notificaciones_sin_leer()` | `integer`: avisos propios sin leer con los mismos filtros | ídem |
| `public.marcar_notificaciones_leidas(p_ids uuid[] default null)` | `integer`: cuántos marcó. `p_ids` nulo = todos los propios sin leer. Idempotente y **conserva el primer** `leido_en` | ídem |

Filtros comunes: `estado <> 'descartado'`, `user_id = auth.uid()`, `organizacion_id = private.organizacion_id()` y el
tipo de aviso debe seguir siendo visible (`private.nivel_seccion_de_usuario(...) <> 'ninguno'`). El acceso se evalúa
**una vez por tipo** de aviso (no por fila) desde `20270217300005`.

### Panel

- `apps/web/src/components/navegacion/CampanitaNotificaciones.tsx`: botón de campana con `aria-label`
  «Notificaciones, N sin leer», punto rojo (`tokens.color.peligro`, 12 px, borde de superficie) solo si hay sin leer;
  el desplegable es un `Popover` con `role="dialog"`, ancho `min(400px, 100vw - 16px)`.
- `ListaNotificaciones.tsx`: tipo legible, detalle de `datos` en texto plano (`detalleLegible`, máximo 140 caracteres),
  hora relativa (`Intl.RelativeTimeFormat` en `es`) y no leídos destacados. Estados compartidos de carga, vacío
  («No tenés notificaciones.») y error con «Reintentar».
- `useNotificaciones.ts`: lista con `useInfiniteQuery` y cursor `(creado_en, id)`; conteo con refresco al montar, al
  volver a la pestaña y cada 60 s (`INTERVALO_REFRESCO_MS`), **sin consultar con la pestaña oculta**
  (`document.visibilityState`). Un contador de generación descarta respuestas viejas: el punto rojo no reaparece
  por una respuesta que llega tarde.
- `notificaciones.ts`: `LIMITE_TANDA = 20`, `MAXIMO_DETALLE = 140`.
- «Marcar todas como leídas» llama `marcar_notificaciones_leidas` con `p_ids` nulo; el doble clic sobre un aviso no
  descuenta dos veces el contador.
- `EncabezadoPanel.tsx`: el botón va entre `BusquedaGlobal` y `MenuCuenta`.

### Empresa activa: no aplica

Los avisos son personales: al emitirse ya se filtraron por las empresas a las que la persona accede
(`private.empresas_accesibles_de_usuario`, F-NOT-01) y no se reencuadran por la empresa de la barra superior. La
campanita no guarda su propia empresa ni duplica el selector.

## F-CFG-02 · Ayuda dentro del panel

- **Contenido estático en el repo**: `apps/web/src/ayuda/contenidos/` (un módulo por sección del menú: `inicio`,
  `catalogo`, `stock`, `ventas`, `service`, `contactos`, `canales`, `analisis`, `reportes`, `administracion`,
  `plataforma`) y `index.ts` con el mapa por `id` de destino de `SECCIONES_PANEL`.
- **Resolución por ruta**: `apps/web/src/ayuda/resolverAyuda.ts` usa `coincideRuta` (extraído a
  `apps/web/src/components/navegacion/destinosPanel.ts` **sin cambiar el comportamiento de las migas de pan**). Si
  coinciden varios destinos, gana el **más específico** (la ruta más larga); una subruta (ficha, formulario) cae en
  su destino padre. Sin destino: `TEXTO_SIN_AYUDA` = «Esta pantalla todavía no tiene ayuda».
- **Panel**: `apps/web/src/components/navegacion/PanelAyuda.tsx` (botón `HelpOutlineIcon` con `aria-label` «Ayuda» y
  `Drawer` a la derecha, `role="dialog"`, `aria-modal`, `width: min(420px, 100vw)`), con «Cerrar» y Escape; el foco
  vuelve al botón.
- **Brevedad**: `apps/web/src/ayuda/tipos.ts` fija `AYUDA_MAX_RESUMEN = 600`, `AYUDA_MAX_PASOS = 5` y
  `AYUDA_MAX_PASO = 140`.
- **Cobertura**: `ayuda-cobertura.test.ts` falla si un destino de `SECCIONES_PANEL` no tiene entrada o si hay una
  entrada sin destino (44 destinos hoy).
- **Enlace al manual de producto** (MSF-385, PR #816): al pie del panel, un `Link` abre en pestaña nueva
  (`target="_blank"`, `rel="noopener noreferrer"`) la página del manual de la pantalla («Ver el manual completo de esta
  pantalla») o el índice («Abrir el manual») si la pantalla no tiene página propia.
  - **La dirección vive en un solo lugar**: `apps/web/src/ayuda/manual.ts`. Es una **plantilla con `{pagina}`**
    (`MANUAL_URL_POR_DEFECTO` = `https://docs.212-90-120-53.sslip.io/producto/{pagina}/`, el sitio MkDocs publicado) que se
    puede sobrescribir con **`VITE_MANUAL_URL`** al construir la imagen (build-arg de `apps/web/Dockerfile`, documentada en
    `apps/web/.env.example`). El índice es todo lo que va antes de `{pagina}`. Una plantilla inválida (no `http(s)`, o sin
    `{pagina}` en la ruta) se descarta y se avisa en consola.
  - **Qué página le toca a cada pantalla**: `apps/web/src/ayuda/manualPorDestino.ts` (`MANUAL_POR_DESTINO`, nombres de
    página sin extensión; nunca direcciones) y `SIN_PAGINA_PROPIA`. `manual.test.ts` exige que todo destino del menú esté
    en una de las dos listas. Que la página exista en `docs/producto/` lo debe revisar quien agrega o renombra páginas: el
    CI de `dokploy` no ve el manual (vive en `main`).
  - **El sitio se publica aparte** del sistema: una página nueva del manual no aparece en el enlace hasta que se
    vuelve a publicar el sitio.

### Empresa activa: no aplica

La ayuda no consulta datos: es contenido estático y es el mismo para todas las empresas.

## F-OPS-06 · Exportar todos los datos

### Solicitud

`public.solicitar_exportacion_total()` (`security definer`, `revoke … from public, anon`, `grant execute … to
authenticated`) devuelve `proceso_id, ejecucion_id, estado, reutilizado`:

- **Permiso**: `private.es_administrador_propio_de(v_org)` desde `20270217300006`: la **membresía propia** de
  administrador. Un superadmin con acceso de soporte a otra organización **no** exporta (error `42501`
  `NO_AUTORIZADO`).
- **Conexión**: la conexión `historial-ventas` de la organización (la misma que usa la exportación diferida de
  comprobantes). Si no existe: `P0001` `SIN_CONEXION_EXPORTACION`.
- **Capacidad**: `exportar-organizacion-<organizacion_id>`, creada al primer uso con `tiempo_max_seg = 3600`.
- **Proceso**: `public.iniciar_proceso_masivo(conexion, capacidad, 'exportacion', 'exportacion_total', …)`, **sin
  empresa**: el proceso es de la organización.
- **Idempotencia**: si hay una exportación total `pendiente` o `en_curso` creada en la última hora, devuelve esa
  (`reutilizado = true`); un `pg_advisory_xact_lock` por organización evita dos pedidos simultáneos.

### Worker y flow

- **Flow**: `infra/kestra/flows/exportar-organizacion.yml` (namespace `platform.exportacion`) reclama
  `exportar-organizacion-*` (nunca las capacidades de otros productos), resuelve la conexión `historial-ventas`,
  lanza el worker por SSH y resuelve la orden (confirmar, liberar o agotar). El código **78** se agota en el primer
  intento.
- **Worker**: `workers/exportar-organizacion` (`src/exportar.ts`, `csv.ts`, `zip.ts`, `infra.ts`).
  - Recorre los conjuntos con `private.conjuntos_exportacion_total()` y las filas con
    `private.filas_exportacion_total(ejecucion, esquema, tabla, desde, limite)` en lotes de **2000** (`TAMANO_LOTE`).
  - Un CSV por conjunto, con nombre `<esquema>/<tabla>.csv`: separador `;`, BOM UTF-8, CRLF, comillas según RFC 4180
    y neutralización de fórmulas (prefijo `'` ante `= + - @`).
  - ZIP en streaming con `fflate`: cada trozo se escribe a un archivo temporal; tope de **200 MB**
    (`TOPE_BYTES`), que es una falla no reintentable (`TOPE_EXCEDIDO`, código 78).
  - Sube el ZIP a `exportaciones-organizacion/<organizacion_id>/<ejecucion_id>.zip` (idempotente, con `upsert`) y
    **borra el archivo anterior** de la organización: queda solo el último.
  - Un `LEEME` dentro del ZIP lista los conjuntos y cuántas filas trae cada uno.
  - Cierra el proceso `completado` o `con_errores` (un error por conjunto fallido); una cancelación o una falla no
    publica un ZIP parcial.
- **Aislamiento**: las funciones de lectura solo las ejecuta un rol `worker_<org>` (miembro de
  `workers_orquestacion`) sobre una ejecución **en curso** de la capacidad `exportar-organizacion-*`; la organización
  sale de la ejecución, nunca de un parámetro, y el conjunto pedido se valida contra la lista permitida.
- **Descarga**: el panel pide una **URL firmada de 60 s** (`SEGUNDOS_URL_DESCARGA`) al bucket; la política
  `exportaciones_organizacion_select` deja leer solo al administrador propio de la organización dueña de la carpeta
  (`storage.foldername(name))[1] = organizacion_id`). No hay política de `insert`/`update`/`delete` para
  `authenticated`: el worker escribe con la clave de servicio del servidor.
- **Configuración**: `EXPORTAR_ORGANIZACION_IMAGEN` (`.env.example`; en Kestra, `ENV_EXPORTAR_ORGANIZACION_IMAGEN`
  por `infra/kestra/compose.yaml`).

### Qué entra y qué no

- **Lista permitida**: `private.conjuntos_exportacion_total()` — tablas de `public` y `dominio` con datos de negocio
  de la organización. Las columnas salen del catálogo real de la base y **se omiten las que parecen secreto**
  (`attname !~* '(secret|token|password|passwd|api_?key|vault|credencial|private_key)'`).
- **Exclusiones**: `private.exclusiones_exportacion_total()`, cada una con su motivo (colas internas de avisos y
  correo, registros operativos y de monitoreo, procesos masivos, credenciales y conexiones, datos derivados).
- **Completitud**: el pgTAP `exportacion_total.test.sql` falla si una tabla con `organizacion_id` de `public` o
  `dominio` no está en la lista permitida ni en las exclusiones. Por eso `20270217300007` suma
  `dominio.cotizacion_configuracion` y `dominio.precios_propios_empresa`.

### Empresa activa: no aplica

La exportación es de **toda la organización**: el bloque de `/importaciones` no depende de la empresa activa y el
proceso se registra sin empresa. Al cambiar la empresa, el bloque se sigue viendo igual.

## Pantallas

- **Barra superior**: `CampanitaNotificaciones` y `PanelAyuda` en `EncabezadoPanel`, entre `BusquedaGlobal` y
  `MenuCuenta`.
- **`/importaciones`**: `apps/web/src/pages/importaciones/ExportacionTotal.tsx` (bloque «Exportar todos los datos» con
  diálogo de confirmación, avance y «Descargar»), datos en `apps/web/src/hooks/useExportacionTotal.ts` (última
  exportación de la organización, refresco mientras está abierta) y textos en
  `apps/web/src/lib/exportacionTotal.ts`. El bloque solo se monta para administradores.
- El desplegable de la campanita, el panel de ayuda y el bloque de exportación **no están dibujados en el
  prototipo**: se construyeron con los componentes del template y los tokens del sistema de diseño (la épica lo
  confirma: «Ninguna pantalla dibujada todavía»).

## Cómo probarlo (técnico)

### Prerrequisitos

- `pnpm dev:supabase` y el panel servido; para la base, `pnpm test:db` (pgTAP) o `supabase test db --local`.
- Dos personas de la misma organización con rol **Administrador** y, para el caso negativo, una persona con otro rol
  (por ejemplo **Operador**) y una de **otra organización**.
- Para la exportación: una organización con la conexión `historial-ventas` y su capacidad
  `exportar-organizacion-<organizacion_id>` habilitadas. Sin conexión, el pedido falla con
  `SIN_CONEXION_EXPORTACION`.
- Para Kestra: `pnpm dev:kestra` (o el stack de `dokploy`) con `ENV_EXPORTAR_ORGANIZACION_IMAGEN` y la imagen del
  worker publicada.

### Pasos

1. **Base de la campanita (pgTAP).** Correr `pnpm test:db`. Deben quedar verdes `notificaciones_panel.test.sql` y
   `rls_en_toda_tabla`.
2. **Emitir un aviso y ver la campanita.** Como administrador, encolar un aviso para otra persona de la misma
   organización (`insert into public.avisos_pendientes …` con `tipo_aviso = 'consulta_nueva'`). Iniciar sesión con esa
   persona: la campanita debe mostrar el punto rojo y el desplegable listar el aviso con su tipo, el detalle y la hora
   relativa.
3. **Marcar leído.** Abrir el aviso: el punto debe apagarse y el aviso quedar con `leido_en` no nulo en
   `public.avisos_pendientes`. Con **Marcar todas como leídas** deben quedar todos leídos.
4. **Aislamiento.** Con la sesión de otra persona, la lista debe estar vacía; con `anon`, `listar_notificaciones` y
   `contar_notificaciones_sin_leer` deben fallar. Un aviso de una sección a la que la persona ya no tiene acceso no debe
   listarse ni contarse.
5. **Ayuda.** Entrar a tres pantallas distintas (por ejemplo `/categorias`, `/ventas/comprobantes` y `/usuarios`) y
   pulsar «Ayuda» en cada una: cada panel debe mostrar un texto distinto, con el nombre de la pantalla y hasta cinco
   pasos. Cerrar con **Cerrar** y con Escape: el foco debe volver al botón «Ayuda». En una ruta sin destino debe
   aparecer «Esta pantalla todavía no tiene ayuda».
6. **Pedir la exportación.** Como administrador, en `/importaciones`, pulsar **Exportar todos los datos** y
   confirmar. Debe aparecer un proceso `exportacion_total` `pendiente` en la tabla del centro, con `ejecucion_id` y su
   orden de despacho. Volver a pedirlo sin que termine: debe devolver el mismo proceso (`reutilizado = true`) y no crear
   otro.
7. **Seguir y descargar.** Con el worker y el flow levantados, el proceso debe pasar a `en_curso`, informar el avance
   (`total` = cantidad de conjuntos) y cerrar `completado` (o `con_errores` si un conjunto falló). El bloque debe
   mostrar «Descargar»; el ZIP debe traer un CSV por conjunto y un `LEEME`, y debe estar en
   `exportaciones-organizacion/<organizacion_id>/<ejecucion_id>.zip`. Con un administrador de otra organización, la
   descarga debe fallar; con un no administrador, el bloque no debe verse.
8. **Retención y cancelación.** Con una segunda exportación terminada, el archivo anterior debe desaparecer. Con una
   exportación en curso, cancelarla desde el centro: el proceso debe cerrar `cancelado` **sin** ZIP parcial.
9. **SQL de contraste.**

   ```sql
   select id, tipo_aviso, leido_en, estado from public.avisos_pendientes order by creado_en desc limit 10;
   select id, funcionalidad, estado, total, procesados, con_errores
     from public.procesos_masivos where funcionalidad = 'exportacion_total' order by creado_en desc limit 5;
   select name, (storage.foldername(name))[1] as organizacion
     from storage.objects where bucket_id = 'exportaciones-organizacion';
   ```

### Resultado esperado

- **Dado** el panel con avisos sin leer, **cuando** se carga la barra superior, **entonces** la campana muestra el punto
  rojo y el desplegable lista los avisos propios; otra persona y `anon` no ven nada.
- **Dado** un aviso sin leer, **cuando** se abre o se pulsa «Marcar todas como leídas», **entonces** queda leído
  (`leido_en`) y el punto se apaga sin recargar la página.
- **Dado** una pantalla del menú, **cuando** se pulsa «Ayuda», **entonces** se abre un panel con el título de la
  pantalla, para qué sirve y sus pasos; una pantalla sin ayuda lo dice y nunca queda vacío.
- **Dado** un administrador, **cuando** pide la exportación total, **entonces** ve un proceso en el centro, avanza por
  grupos de datos y termina con un ZIP descargable que contiene los datos de su organización y de ninguna otra.
- **Dado** un no administrador o un superadmin con acceso de soporte, **cuando** intenta pedir o descargar la
  exportación, **entonces** el sistema lo rechaza.

### Cómo automatizarlo

| Qué cubre | Test | Rótulo / tarea |
|---|---|---|
| Aislamiento, `descartado`, sección sin acceso, marcar ajeno e idempotencia | pgTAP `supabase/tests/database/notificaciones_panel.test.sql` | T003 (pgTAP: sin rótulo en el archivo) |
| Componente, foco, teclado, ancho y carrera del punto rojo | Vitest `CampanitaNotificaciones.test.tsx`, `ListaNotificaciones.test.tsx`, `marcar-leidas.test.tsx`, `refresco-notificaciones.test.tsx`, `CampanitaNotificaciones.a11y.test.tsx`, `conteo-carrera.test.tsx` | T004–T008 |
| Punto, lista, abrir un aviso, marcar todas y aislamiento entre personas (con axe) | E2E `apps/web/e2e/notificaciones.e2e.ts` | `[MSF-378:T010]` |
| Resolución por ruta, contenido, brevedad y cobertura de destinos | Vitest `apps/web/src/ayuda/resolverAyuda.test.ts`, `ayuda-contenidos.test.ts`, `ayuda-cobertura.test.ts`, `PanelAyuda.test.tsx`, `coincideRuta.test.ts` | T011–T014 |
| Tres pantallas con textos distintos, cierre por teclado y foco devuelto (con axe) | E2E `apps/web/e2e/ayuda.e2e.ts` | `[MSF-385:T015]` |
| Solo administrador, idempotencia, aislamiento y completitud de la lista | pgTAP `supabase/tests/database/exportacion_total.test.sql` | T022 (pgTAP: sin rótulo en el archivo) |
| ZIP con un CSV por conjunto, lotes, cancelación sin ZIP parcial, código 78 y borrado del archivo anterior | Vitest `workers/exportar-organizacion/test/exportar.test.ts` | T023–T024 |
| Bloque, diálogo, avance, descarga y permisos (con axe) | Vitest `apps/web/src/pages/importaciones/exportacion-total.test.tsx`, `exportacion-total.a11y.test.tsx`, `exportacion-empresa-activa.test.tsx` | T026–T027 |
| Pedir, ver el avance, descargar el ZIP y respetar los permisos | E2E `apps/web/e2e/exportacion-total.e2e.ts` | `[MSF-396:T028]` |

**Pendiente de automatizar:** el E2E de la exportación total (`[MSF-396:T028]`) necesita el stack local de Supabase
**y** un worker y un flow de Kestra levantados; en el entorno de documentación no se pudo ejecutar. Los rótulos están
en el nombre del test y siguen la convención `[<historia>:<tarea de la tasks.md de la épica>]`; los pgTAP y los Vitest
se citan por su tarea (T0xx).

## Límites y deuda

- **Deuda trazada** en la historia **MSF-817** («Endurecer la exportación total y cerrar huecos de pruebas»): lista
  negra de columnas secretas en vez de lista blanca por tabla; casos negativos del aislamiento del worker con un
  worker real de otra organización; paginación por *keyset* en vez de `offset` sin snapshot; reintentos y candados del
  flow de Kestra; caducidad del ZIP en el bucket; neutralización de fórmulas que altera teléfonos (`+549…`);
  `marcar_notificaciones_leidas` con `p_ids` ausente equivale a «marcar todas»; desempate por `id` del cursor sin probar.
- **Sin captura de pantalla** de la campanita, del panel de ayuda ni del bloque de exportación.
  `TODO (Documentación · Owner: agente Documentador)`: generarlas con `pnpm --filter @platform/web pantallas:capturar`
  contra una app levantada con datos de demostración y dejarlas en `docs/producto/img/notificaciones/`,
  `docs/producto/img/ayuda/` y `docs/producto/img/importaciones/`.
- **Sin ERD interactivo (Archify)** de la épica: el grafo afectado es una sola columna alterada
  (`avisos_pendientes.leido_en`) y ninguna tabla nueva. `TODO (Documentación · Owner: agente Documentador)`.
- La exportación total **no expira**: el archivo anterior se borra al completar la siguiente, pero no hay limpieza
  programada (ver MSF-817, punto 5).

## Reversión

Migraciones aditivas; la reversión de cada una está en su encabezado (drop de funciones, del índice, de la columna
`leido_en`, de la política y del bucket `exportaciones-organizacion`).

- **Campanita**: quitar `<CampanitaNotificaciones />` de `EncabezadoPanel`.
- **Ayuda**: quitar `<PanelAyuda />` de `EncabezadoPanel`; no hay migraciones.
- **Exportación total**: revertir el flow de Kestra y la imagen del worker; en la base, `drop function
  public.solicitar_exportacion_total()`, `drop policy exportaciones_organizacion_select on storage.objects` y vaciar
  y borrar el bucket desde la API de Storage. El proceso ya registrado en `procesos_masivos` queda como histórico.
