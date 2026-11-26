---
owner: plataforma
sources:
  - supabase/functions/chat-ia-responder/guardas.ts
  - supabase/functions/chat-ia-responder/handler.ts
  - supabase/functions/preguntar-documentos/index.ts
  - supabase/functions/preguntar-documentos/handler.ts
  - supabase/functions/indexar-documento/handler.ts
  - supabase/functions/indexar-documento/consultas.ts
  - supabase/migrations/20270507200100_borrar_fragmentos_si_dueno.sql
  - supabase/migrations/20270507800000_endurecer_rag_mcp_y_chat_columnas.sql
  - supabase/functions/enviar-correo-proveedor/handler.ts
  - supabase/functions/_shared/embeddings.ts
  - supabase/functions/_shared/fetch-ia.ts
  - supabase/functions/_shared/limite-memoria.ts
  - supabase/functions/_shared/cupo-ia.ts
  - supabase/functions/_shared/log-seguro.ts
  - supabase/migrations/20270507900000_cupo_persistente_de_ia_por_usuario_y_hora.sql
  - packages/ia/src/proveedores/index.ts
  - supabase/functions/_shared/token.ts
  - supabase/functions/crear-organizacion/handler.ts
  - packages/mcp-server/src/herramientas.ts
  - packages/mcp-server/src/servidor.ts
  - packages/ia/src/purga.ts
  - infra/kestra/flows/correo-masivo.yml
---

# Funciones edge de IA y correo: endurecimiento (auditoría MSF-647, lote 25)

Qué se corrigió de los hallazgos MSF-727 a MSF-732 y MSF-711, qué ya estaba resuelto y qué queda pendiente
(con su propuesta). Las correcciones del lote 25 no tocaron la base: lo que exigía una migración quedó en «Pendientes». El lote 89
(migración `20270507800000_endurecer_rag_mcp_y_chat_columnas.sql`) cerró tres de esos pendientes de MSF-728, MSF-729 y
MSF-730; ver «Lote 89» al final. El lote 90 (migración `20270507900000_cupo_persistente_de_ia_por_usuario_y_hora.sql`) cerró el del
cupo persistente de IA de MSF-727; ver «Lote 90».

## Funciones de IA: nada de crédito sin verificar (MSF-727)

- `chat-ia-responder` y `preguntar-documentos` verifican, con el JWT del propio usuario, que la organización tiene
  la funcionalidad (`tiene_feature_publica('chat-ia')` / `('busqueda-documental')`) **antes** de llamar al
  proveedor. Sin la funcionalidad: 403. Si la verificación falla: 503.
- `chat-ia-responder` valida el cuerpo (`mensaje` de texto, hasta 4000 caracteres; `conversacion_id` UUID), comprueba
  que la conversación exista y sea del usuario (404 si no; antes el insert fallaba por RLS en silencio y la función
  seguía llamando al proveedor) y aplica el cupo persistente por usuario y hora (30 por defecto, `CHAT_IA_LIMITE_HORA`, 429
  con `Retry-After`; ver «Lote 90»). Hasta el lote 89 ese tope se contaba sobre `mensajes_chat_ia`, que el usuario puede
  borrar: ya no se usa.
- `preguntar-documentos`: `pregunta` hasta 2000 caracteres y el mismo cupo persistente (30 por hora por defecto,
  `PREGUNTAR_DOCUMENTOS_LIMITE_HORA`; ver «Lote 90»). Hasta el lote 89 vivía en la memoria del isolate.
- Toda llamada al proveedor lleva `AbortSignal.timeout(limiteSegundos)` (`_shared/fetch-ia.ts`, tope 90 s) y los
  embeddings 30 s por request. La rama OpenAI del chat envía `max_tokens` (1024). Desde el lote 90 un timeout responde 504
  (antes 502); ver «Lote 90».

## `chat-ia-responder`: persistencia y herramientas (MSF-730)

- Los inserts en `mensajes_chat_ia` ya no se ignoran (`guardarMensaje`): si la base los rechaza, la función responde
  500 en vez de «ok» sin historial.
- Si el modelo pide **varias** herramientas en un turno, se responde cada `tool_use` / `tool_call_id` (máximo 4 por
  turno; las sobrantes reciben un error corto) en vez de dar 400 en la segunda llamada al proveedor.
- La propuesta de acción guarda lo que se ejecutaría de verdad: nombre de la acción y parámetros, más la descripción
  del asistente marcada «no verificada». Quien confirma ya ve los parámetros reales.
- `leer`: si la fuente define `fuentes_chat_ia.columnas` solo se piden esas columnas (ver «Lote 89»); los filtros elegidos por el modelo se validan (identificadores simples, valores escalares, hasta 8), las
  columnas con nombre de secreto se quitan (`sanitizarDato`) y el resultado viaja marcado como dato no confiable.
- Ya estaba resuelto antes del lote: tope de 50 filas (`limites.ts`) y creación de la propuesta por RPC
  (`proponer_accion_chat_ia`, MSF-724).
- **Handler con dependencias inyectadas.** La lógica vive en `handler.ts` (`manejar(req, deps)`) y `index.ts` solo
  cablea: el cliente admin (única aparición de la service-role: validar el JWT y resolver política y credencial), el
  cliente del usuario (anon + su JWT, con el que van la lectura, la cuota, la conversación y la propuesta de acciones),
  `prepararInvocacion`, el `fetch` con tope de espera, el reloj, el tope por hora y el prompt de sistema. Se separó así
  porque el ciclo de cada proveedor comparte el estado de la conversación y solo se puede probar con los dos
  adaptadores simulados. Regla: `handler.ts` no lee entorno, no crea clientes y no importa nada de `npm:` (corre con
  `node --test`); cualquier dependencia nueva entra por `Deps`. `handler.test.ts` fija el comportamiento (método,
  autenticación, validación, funcionalidad, cuota, política, conversación, los dos ciclos del proveedor con texto,
  herramientas, propuestas, errores y timeouts) y un test de contrato de `index.ts` comprueba qué cliente se usa
  para qué.

## `preguntar-documentos`: handler con dependencias inyectadas (MSF-893)

Mismo patrón que `chat-ia-responder` e `iniciar-sesion-oauth`, sin cambios de comportamiento ni de contrato HTTP: la lógica
vive en `handler.ts` (`manejar(req, deps)`) y `index.ts` solo cablea los clientes de Supabase (admin con service-role para
validar el JWT y resolver política y credencial; usuario con anon + su JWT para la funcionalidad, la búsqueda y las
versiones), `prepararInvocacion`, los embeddings, el `fetch` con tope de espera, el tope horario del cupo
(`PREGUNTAR_DOCUMENTOS_LIMITE_HORA`; el contador vive en la base, lote 90) y el reloj. `handler.ts` no lee entorno ni importa de `npm:`.
`handler.test.ts` (`pnpm test:edge:preguntar-documentos`) cubre método y CORS, JWT, cuerpo y largo de la pregunta, funcionalidad
(403/503), cupo por usuario (429 con `Retry-After`, 503 si no se puede consumir), política (503), credencial (500), proveedor no
soportado (501), errores de embeddings y de búsqueda, ausencia de fragmentos o de texto (sin llamar al proveedor), citas sin
duplicados, error del proveedor (502), timeout del proveedor o de los embeddings (504) y el cableado de `index.ts`.

## `indexar-documento` (MSF-728)

La lógica pasó a `handler.ts` (con pruebas) y los embeddings se piden **en lotes de 256** (`_shared/embeddings.ts`).

- Una invocación duplicada ya no deja la versión activa como `fallida`: la primera **reclama** la versión con un
  compare-and-swap sobre `versiones_documento.motivo_error` (`indexando:<instante>:<id>`, vence a los 10 minutos);
  la segunda recibe 409. `marcarFallida` solo actúa mientras la versión sigue `procesando`. La pantalla de Documentos
  IA no muestra el candado `indexando:…` como si fuera un motivo de error.
- **Autorización previa** (antes de reclamar, descargar, gastar crédito o tocar fragmentos): con el JWT del usuario se
  verifica la funcionalidad `busqueda-documental` y que quien invoca sea **quien subió la versión** (`subida_por`) o un
  **administrador de esa organización** (`contexto_panel_actual().rol_efectivo`, sin superadmin, misma organización que
  la versión). Si no, 403 con el mismo cuerpo para versión inexistente, ajena o sin permiso. Brecha: la regla definitiva
  vive en `activar_version_documento` (#1121) y usa la membresía propia (`private.es_administrador_propio_de`), que no
  tiene wrapper público; aquí el administrador se resuelve por el rol efectivo del contexto. Propuesta: exponer una RPC
  pública `puede_indexar_version(p_version_id)` que aplique la misma regla y usarla en el handler y en la pantalla.
  Consecuencias que quedan fijadas con tests: un **superadmin** que además es administrador real de la organización es
  rechazado (criterio conservador intencional, igual en la pantalla: no ve «Reintentar»); si el RPC de contexto falla y
  quien invoca no subió la versión, la función falla cerrado con **503**; el 403 de «sin permiso», de funcionalidad apagada
  y de versión inexistente tienen el mismo cuerpo. Carrera conocida: un administrador degradado durante la indexación
  recibe 42501 al activar y deja la versión `fallida` (la reintenta quien subió o un administrador vigente).
- Un 22023 al activar (versión ya procesada, ajena o inexistente para la base) responde 409 sin marcar `fallida` ni
  reintentar; si `marcarFallida` no puede aplicarse se registra en el log, se suelta el candado y se responde 502.
- Un 22023 también borra los fragmentos de ese intento (409 genérico, o 404 si la versión ya no existe). Si
  `marcarFallida` no aplica porque otra invocación ya activó la versión, no se borra nada y se responde 200 idempotente
  (`ya_activa`); el fallo se registra y, si además `soltar` falla, el candado queda vigente hasta vencer (10 minutos) y
  queda una línea en el log («no se pudo soltar el candado»). El contexto (rol) solo se lee si quien invoca no subió la
  versión; si la lectura falla, 503.
- Los fragmentos solo se borran si la invocación sigue siendo la dueña de la versión (relee: `procesando` con su propio
  reclamo); nunca los de una versión `activa` ni los de otra invocación que la retomó. La relectura es solo un
  atajo: el borrado real lo hace `public.borrar_fragmentos_si_dueno(version_id, organizacion_id, reclamo)` (envoltorio de
  `private.borrar_fragmentos_si_dueno`, `security definer`, `search_path=''`, solo `service_role`), que comprueba la
  propiedad (la versión existe, no está `activa` y no fue retomada por otro reclamo) y borra en la misma transacción,
  con `for share` sobre la versión; así la ventana sin transacción queda cerrada (deuda m1). Devuelve `false` si no era
  dueña. Si `borrarFragmentos` lanza, el candado se suelta igual.
- La inserción tiene el mismo cierre (lote 41): `public.insertar_fragmentos_si_dueno(version_id, organizacion_id, reclamo, filas)`
  (envoltorio de `private.insertar_fragmentos_si_dueno`, `security definer`, `search_path=''`, solo `service_role`) inserta cada
  lote de hasta 100 filas solo si la versión sigue `procesando` con el reclamo propio y es de la organización (`for share`);
  la versión y la organización de cada fila las pone la función. Si devuelve `false` (otra invocación la retomó o la activó),
  `insertarFragmentos` corta sin seguir con más lotes y el handler responde el 502 reintentable.
- `activar_version_documento` exige además `private.puede_gestionar_documentos()` (42501 para Consulta), igual que el handler.
- **Prueba manual del bloqueo `for share` (dos conexiones reales).** pgTAP corre en una sola transacción, así que el test solo
  comprueba con `pgrowlocks` que el borrado toma «For Share» sobre la fila; la espera de una activación concurrente se prueba a
  mano en un Postgres descartable con las migraciones aplicadas: con una versión `procesando` y reclamo `rec`, la sesión A corre
  `begin; select public.borrar_fragmentos_si_dueno(<version>, <org>, 'rec'); select pg_sleep(4); commit;` y, 1 s después, la
  sesión B corre `update public.versiones_documento set estado = 'activa' where id = <version>`: B espera hasta el `commit` de A
  (verificado en el lote 41: ≈3,5 s). Lo mismo vale para `insertar_fragmentos_si_dueno`.
- El 409 lleva un `codigo`: `ocupado` (candado vigente) o `no_procesable` (ya procesada o 22023). La pantalla muestra un
  mensaje propio por estado/código, nunca el texto del backend (salvo el 422, accionable), y tras `no_procesable` o 404
  deja de ofrecer «Reintentar».
- En la rama 22023 con la versión `procesando` de OTRA invocación se responde `no_procesable` (no `ocupado`): no se borra
  nada, se suelta solo el reclamo propio y la pantalla no vuelve a ofrecer «Reintentar». Si entre la relectura de
  propiedad y `marcarFallida` otra invocación retoma la versión, el update condicional por reclamo no aplica y se responde
  502 sin marcar ni borrar. Las consultas reales de `reclamar`, `soltar` y `marcarFallida` (`.eq('estado','procesando')` y
  `.eq('motivo_error', reclamo)`) se construyen en `consultas.ts` (sin imports de Deno) y `consultas.test.ts` las prueba
  con un cliente simulado que registra cada filtro.
- La pantalla decide el mensaje por el estado HTTP y el `codigo` (`ErrorIndexacion.status` y `.codigo`), no por el texto del backend.
- El rechazo de la política de IA (p. ej. `POLITICA_IA_INACTIVA`) va al log; al usuario y a `motivo_error` solo llega un texto fijo. `marcarFallida` solo aplica si el reclamo en la base sigue siendo el propio.
- Un reintento con el candado vigente muestra «Ya se está procesando; esperá unos minutos» en vez del error crudo.
- Errores permanentes (sin texto legible, más de 2000 fragmentos) dejan la versión `fallida` con un mensaje claro.
- **Rechazo de permisos al activar (42501)** (carrera o regla distinta de la base): no es transitorio. La función
  responde **403** y, si quien invoca es quien subió o administrador, deja la versión `fallida` con un motivo claro; en
  otro caso solo suelta la reclamación, sin marcar ni borrar nada.
- Errores transitorios (proveedor, descarga, base) **sueltan la reclamación y dejan la versión `procesando`**; la
  función responde 502/503/500. **No hay reintento automático ni barrido agendado** (existe `liberar_versiones_documento_atascadas`, sin agendar; ver «Lote 89»). El reintento es **manual**: la pantalla de
  Documentos IA marca como «Se interrumpió el procesamiento» toda versión que sigue `procesando` pasados 15 minutos
  desde su subida y ofrece el botón **Reintentar**, que vuelve a invocar `indexar-documento` para esa misma versión
  (los fragmentos del intento previo se borran antes de insertar). El botón solo aparece para quien subió la versión o un administrador. Si el backend responde 403, 422 o 502, el mensaje
  real se muestra en la pantalla. Subir de nuevo el archivo crea otra versión y deja la anterior `procesando`.

## `enviar-correo-proveedor` y avisos (MSF-731)

- Valida que el proveedor esté activo y que `correo` sea una única dirección válida; 20 envíos por hora y usuario
  (`CORREO_PROVEEDOR_LIMITE_HORA`, en memoria del isolate, 429); cada envío deja una línea en el log de la función
  (usuario, proveedor, resultado; sin asunto, cuerpo ni dirección).
- Las funciones de aviso (`enviar-aviso-faltante`, `enviar-resumen-reposicion`, `enviar-resumen-semanal`,
  `recalcular-alertas-inicio`) rechazan con 503 «no configurada» un token de menos de 32 caracteres o que empiece con
  `change-me` (`_shared/token.ts`). La petición se compara con `tokenValido` (`_shared/token.ts`): SHA-256 de ambos valores y `timingSafeEqual`,
  de modo que no se corta por longitud ni el tiempo revela el largo del token; sin token esperado o sin cabecera
  `x-aviso-token` responde 403 con un cuerpo uniforme («Falta autenticación.»). La usan los `handler.ts` de las cuatro
  funciones de aviso y el de `entregar-webhook`. En local, `AVISOS_PERMITIR_TOKEN_DEBIL=true` junto con la marca `ENTORNO_LOCAL=1` (o `ENVIRONMENT=local`; el `.env.example` trae solo `ENTORNO_LOCAL=1`, no `ENVIRONMENT`) permite el valor de ejemplo; **no las definas en stg/prd, y NO copies `supabase/functions/.env.example` completo a stg/prd**: trae `ENTORNO_LOCAL=1` y la bandera, y como `SUPABASE_URL=http://kong:8000` también es el valor interno de stg/prd, esa copia haría que la bandera se aplique (es el diseño de lista blanca: la protección es no copiar el archivo; un test de `token.test.ts` fija que el `.env.example` lleve la marca y la bandera juntas). Quien tenga un `.env` local viejo sin `ENTORNO_LOCAL=1` verá la bandera ignorada y el aviso en el log: agregá esa línea. La bandera falla cerrado (lista blanca): solo se aplica con esa marca local positiva y sin señal productiva (`ENVIRONMENT`/`APP_ENV`/`ENTORNO` en prod/stg/staging, o `SUPABASE_URL`, `API_EXTERNAL_URL` o `SUPABASE_PUBLIC_URL` con un host público, que ganan aunque la marca esté puesta). `kong` ya no cuenta como indicio de local (es el gateway interno también en stg/prd). Sin la marca, la función IGNORA la variable, deja un `console.warn` sin datos y sigue exigiendo un token fuerte (`permitirTokenDebil`, `_shared/token.ts`). En stg/prd generá
  los tokens con `openssl rand -hex 32` (en Kestra van en base64 como `SECRET_*`).
- Esas cuatro funciones, que solo llama Kestra, ya no responden `Access-Control-Allow-Origin: *`.

## Servidor MCP (MSF-729)

Detalle en `packages/mcp-server/CONTRATO.md`, sección «Robustez del servidor». El MSF-677 (#1091) ya había resuelto la
revalidación de credencial por solicitud. Este lote agrega: `try/catch` del handler HTTP (500 genérico, el proceso no
muere), nombres de herramienta únicos cuando una funcionalidad tiene varias vistas o acciones, vencimiento de
ejecuciones `en_curso` abandonadas (10 minutos; desde el lote 89 el vencimiento vive en `iniciar_ejecucion_mcp`, SQL), mensajes genéricos al cliente externo y un
override de organización que une el criterio histórico (sufijo `organizacion_id`, p. ej. `proveedor_organizacion_id`) con variantes normalizadas (`organizacionId`, `org_id`, `p_organizacion_id`...).

## Deudas menores (MSF-732)

- `crear-organizacion`: si falla la membresía se borra también el usuario invitado de Auth (un reintento con el
  mismo correo ya no da 422); los `delete` de reversión revisan el error y lo registran; `{"nombre":5}` o un cuerpo
  `null` dan 400 en vez de 500; los mensajes de la base y de GoTrue ya no se devuelven textuales.
- `packages/ia/src/purga.ts`: un borrado de Storage fallido ya no frena la tanda; se confirman las evidencias que sí
  se borraron y la purga termina con `PURGA_PARCIAL` si alguna falló (se reintenta en el ciclo siguiente).
- `emitir-acceso-reporte`: un error de la RPC `resolver_organizacion_reporte` responde 503 `analitica_no_disponible`,
  no un 403 que parece falta de permisos.
- `invitar-miembro`: el `APP_URL` por defecto pasó a `http://127.0.0.1:4300`, igual que `.env.example`.
- `CONTRATO.md` del MCP aclara el puerto (8787 en el proceso, 8788 en el compose de desarrollo) y que ese compose es
  solo para desarrollo (`tsx watch`, bind mount y `service_role`).
- `enviar-aviso-consulta` (mencionada en el hallazgo) **no existe** en este repositorio: no hay nada que corregir.

## Correo masivo con el enlace de baja a localhost (MSF-711)

- El flow `correo-masivo` empieza con un `Assert` (`validar_url_baja`): si `CORREO_MASIVO_URL_BAJA` está vacía, no es
  https o apunta a `localhost`/`127.0.0.1`, **falla antes de reclamar el lote** y no sale ningún correo.
  `CORREO_MASIVO_PERMITIR_LOCAL=true` (solo `infra/kestra/.env.example`, desarrollo) lo relaja.
- `infra/kestra/compose.vps.yaml` exige `CORREO_MASIVO_URL_BAJA` (`${…:?}`). **Definila en el secret `VPS_DEPLOY_ENV`
  de GitHub de staging Y de production ANTES de llevar este cambio a `main`.** Valor: el origen público https del
  panel de ese ambiente, sin barra final (por ejemplo `https://panel.ejemplo.com`).
- Si falta, el deploy corta con un error de preflight de `scripts/deploy-vps.mjs` que nombra la variable y el secret
  (antes de `docker compose config`). Sin el preflight, `docker compose config` falla y se aborta el despliegue de los
  tres productos (Kestra es el primero del ciclo; Superset y Nango no se tocan en esa corrida). Lo ya desplegado sigue
  corriendo.
- `CORREO_MASIVO_PERMITIR_LOCAL` (default `false` en el Compose; `true` solo en `infra/kestra/.env.example`) permite
  que el enlace de baja sea http/localhost. **No la definas en staging ni production.**
- Sin verificar: que la ruta `/baja-correo/:token` exista solo en el host del panel (ver informe de frontend).

## Pendientes (requieren migración o una decisión de negocio)

| Pendiente | Por qué no se hizo | Propuesta |
|---|---|---|
| Tope persistente de **correos** a proveedor (MSF-731) | El lote 90 resolvió solo el de IA | Reutilizar `private.consumir_cupo_ia` con otra `funcionalidad` o una tabla propia; hoy `enviar-correo-proveedor` sigue con `_shared/limite-memoria.ts` (20/h por isolate) |
| `indexar-documento` gasta crédito de embeddings sin cupo (MSF-727, hallazgo de la revisión del lote 90) | Fuera del alcance del lote 90: el cupo cubre `chat-ia-responder` y `preguntar-documentos` | Reutilizar `private.consumir_cupo_ia` con otra `funcionalidad` (por ejemplo `indexar-documento`) y un tope en caracteres o fragmentos por usuario y hora; ver también el tope de texto y de fragmentos de MSF-728 |
| Cupo de IA por organización (lote 90) | El cupo es por usuario y funcionalidad, no por organización: una organización con N usuarios, o una persona con N cuentas, obtiene 30·N por hora | Decisión consciente del lote 90. Si hace falta un techo por organización: segunda clave (organización) en `private.ia_cupo_uso` o una tabla análoga y consumir ambos cupos en la misma transacción |
| Logs con `error.message` crudo en funciones fuera de IA (lote 90) | Fuera del alcance del lote 90 (solo IA) | `enviar-aviso-faltante`, `crear-organizacion`, `verificar-dominio-tienda`, `invitar-miembro`, `enviar-correo-proveedor`, `cotizacion-sugerida`, `solicitar-acceso`, `invitar-cliente`, `consultar-estado-reparacion`, `api-v1`, `tienda-seo`, `recuperar-clave-cliente`, `recalcular-alertas-inicio`, `enviar-resumen-semanal`, `enviar-resumen-reposicion`, `entregar-webhook` y `baja-correo-masivo` imprimen `error.message` o el error completo en sus `console.error`/`console.warn`, sin `textoDeError` ni `redactarCredenciales`; pasar los que corresponda por `_shared/log-seguro.ts` |
| Agendar `private.purgar_cupo_ia` (lote 90) | Sin agendar a propósito | Un flow de Kestra o pg_cron semanal con `select private.purgar_cupo_ia();` como `service_role`; sin purga la tabla crece una fila por usuario, funcionalidad y hora de uso |
| Agendar el barrido de versiones `procesando` de `indexar-documento` (MSF-728) | La función ya existe (lote 89) pero no está agendada | Un flow de Kestra o pg_cron que llame `public.liberar_versiones_documento_atascadas(30)` con service_role; considerar que la pantalla ofrece «Reintentar» a los 15 minutos y que tras el barrido la versión queda `fallida` (hay que volver a subir el archivo) |
| Historial persistente de envíos a proveedores (MSF-731) | Tabla nueva | `dominio.proveedores_correos_enviados(id, organizacion_id, proveedor_id, usuario_id, asunto, creado_en, resultado)` con RLS por organización y lectura con `proveedores`; la función la escribe con la sesión del usuario |
| El override de organización del MCP es por nombre de parámetro (MSF-729) | No cubre `id_organizacion`, `tenant_id`, `empresa_id` | El wrapper SQL por acción (fila anterior) es la solución de fondo; abrir ticket y no registrar acciones con esos parámetros hasta tenerlo |
| Lista negra de columnas secretas en `sanitizarDato` (MSF-730) | Es por nombre, ampliada pero no exhaustiva | La lista permitida por vista (`fuentes_chat_ia.columnas`, lote 89) es el control real; cargarla en cada fuente registrada |
| Estado `indexando` en `versiones_documento` (MSF-728) | Migración y cambio de `activar_version_documento` | Ampliar el `check` de estado con `indexando` y que `activar_version_documento` lo acepte; con eso el candado deja de usar `motivo_error` (el índice único `(version_id, orden)` ya existe, lote 89) |
| Wrapper SQL por acción del MCP que inyecte la organización desde la credencial (MSF-729) | Riesgo latente: no hay acciones registradas en `acciones_mcp`; decisión de modelo | Wrapper `private.ejecutar_accion_mcp(p_credencial_id, p_rpc, p_parametros)` que resuelva la organización por la credencial y llame a la RPC registrada; no registrar acciones hasta tenerlo (el `feature_id` único y el vencimiento en SQL ya están, lote 89) |
| `invitar-miembro` recorre todos los usuarios de Auth (MSF-732) | Necesita una RPC sobre `auth.users` | `private.usuario_auth_por_correo(p_correo)` (`security definer`, solo `service_role`) con un índice por `lower(email)` |
| Pedidos de `recuperar-clave-cliente` descartados en silencio (MSF-731) | Decisión de diseño | Contar por IP/host además de correo y responder siempre igual; no se puede evitar que 3 pedidos bloqueen 10 minutos al cliente sin un límite por IP |
| `Access-Control-Allow-Origin: *` en las funciones llamadas desde el navegador | Son llamadas por el panel | Restringir al origen del panel (`APP_URL`) cuando se decida el esquema de orígenes por ambiente |
| Un `NANGO_SECRET_KEY` con forma de UUID real en `.env.example` | Hay que confirmar si es un valor de uso real | Rotarlo si alguna vez se usó y poner un placeholder no válido |

## Verificación

`pnpm test:edge:indexar-documento`, `pnpm test:edge:compartido-ia`, `pnpm test:edge:chat-ia-limites`, `pnpm test:edge:chat-ia-responder`, `pnpm test:edge:preguntar-documentos`,
`pnpm test:edge:enviar-correo-proveedor`, `pnpm test:edge:crear-organizacion`, `pnpm test:edge:emitir-acceso-reporte`, `pnpm test:edge:iniciar-sesion-oauth`,
`pnpm test:kestra:correo-masivo`, `pnpm --filter @platform/mcp-server test` y `pnpm --filter @platform/ia test`.

## Lote 89: unicidad, barrido, vencimiento en SQL y columnas permitidas (MSF-728, MSF-729, MSF-730)

Una sola migración, `20270507800000_endurecer_rag_mcp_y_chat_columnas.sql` (reaplicable; reversión documentada en el propio
archivo). Prueba: `supabase/tests/database/lote89_endurecer_rag_mcp_y_chat_columnas.test.sql`.

**Reversión: advertencia.** Revertir esta migración REABRE el hueco de aislamiento entre organizaciones de MSF-728: con las políticas
viejas de `fragmentos_indexados` (20270507180400) un escritor puede insertar o mover fragmentos propios a una versión de otra organización, y con
el `insertar_fragmentos_si_dueno` viejo se pierde la deduplicación y el `do update`. Es solo un paso transitorio: requiere una decisión
explícita y volver a aplicar una migración equivalente cuanto antes. Los pasos están en el encabezado de la migración (se copian solo los
bloques de función y política, no los archivos completos).

**Orden de despliegue:** aplicar la migración ANTES de desplegar `chat-ia-responder`. El handler selecciona `fuentes_chat_ia.columnas`;
si la función sale primero, esa columna no existe y toda lectura del chat responde `FUENTE_NO_DISPONIBLE` (falla cerrado, pero el chat
deja de leer datos hasta aplicar la migración).

- **Fragmentos únicos por `(version_id, orden)`** (`fragmentos_indexados_version_orden_uidx`).
  - *Aislamiento entre organizaciones.* Las políticas INSERT y UPDATE de `authenticated` solo exigían
    `organizacion_id = organización del usuario`: quien conociera el UUID de una versión de otra organización podía insertar ahí un
    fragmento propio y, con el índice único, ocupar un `orden` de la versión ajena. Ahora además la versión debe pertenecer a la
    organización del fragmento (versión, documento, organización); siguen exigiendo `private.puede_gestionar_documentos()`.
  - *Deduplicación previa.* `private.deduplicar_fragmentos_indexados()` primero borra todo fragmento cuya organización no es la dueña
    de su versión y recién después, entre los repetidos de la dueña (indistinguibles: mismo contenido), conserva el de menor `id`
    (uuid aleatorio: determinista, no cronológico).
  - *Conflicto.* `insertar_fragmentos_si_dueno` rechaza con 22023 «p_filas tiene valores de orden repetidos» y, ante un conflicto
    `(version_id, orden)` con una fila ya guardada, la actualiza (`do update`: texto, embedding y organización) con lo recibido. Decisión:
    el dueño con el reclamo vigente es la fuente de verdad; un reintento con las mismas filas es idempotente y una fila vieja o ajena
    con otro contenido nunca queda en silencio (con `do nothing` la versión se activaba con un hueco). Devuelve `true` si era dueña.
    `indexar-documento/handler.ts` no cambia (ya borraba los fragmentos del intento previo antes de insertar).
- **Aplicar en producción (bloqueo).** `create unique index` dentro de la migración no es `concurrently`: toma un lock SHARE sobre
  `fragmentos_indexados` (bloquea INSERT/UPDATE/DELETE durante la construcción; la tabla tiene además el índice HNSW del vector) y la
  deduplicación recorre la tabla entera. La tabla crece ~1 fila por 1200 caracteres de documento. Aplicar en una ventana sin
  indexaciones y sin Documentos IA en uso; medir antes con `select count(*) from public.fragmentos_indexados;` y buscar repetidos con
  `select version_id, orden, count(*) from public.fragmentos_indexados group by 1, 2 having count(*) > 1;`. Si la tabla es grande y no hay
  ventana, hacerlo en caliente antes de la migración: (1) borrar a mano los repetidos y los fragmentos de otra organización en tandas
  (la lógica es la de `private.deduplicar_fragmentos_indexados`); (2) `create unique index concurrently if not exists
  fragmentos_indexados_version_orden_uidx on public.fragmentos_indexados (version_id, orden);` fuera de una transacción;
  (3) **verificar que quedó válido**: `select indisvalid from pg_index where indexrelid = 'public.fragmentos_indexados_version_orden_uidx'::regclass;`
  debe dar `true`. Un `create unique index concurrently` que falla (p. ej. por un repetido nuevo) deja un índice INVALID con ese nombre; si
  `indisvalid` es `false`, `drop index concurrently public.fragmentos_indexados_version_orden_uidx;` y repetir desde (1); (4) aplicar la
  migración, cuyo `create unique index if not exists` ya no hace nada y cuya deduplicación no encuentra filas. Como red de seguridad, la
  migración llama a `private.exigir_indice_fragmentos_valido()` (que usa `private.exigir_indice_valido(regclass)`) y aborta (55000) con esa
  misma instrucción si el índice existe pero es INVALID. La prueba `lote89b_indice_invalido.test.sql` provoca un `create unique index
  concurrently` fallido de verdad sobre una tabla scratch (fuera de transacción, sin superusuario) y la limpia al terminar; la tabla nace con clave primaria,
  RLS y una política explícita para que, si la prueba se corta a mitad, el residuo no haga fallar los tests globales de higiene. Un índice inexistente
  (parámetro nulo) aborta con 42704 en vez de pasar en silencio.
- **Barrido de versiones atascadas, sin agendar.** `public.liberar_versiones_documento_atascadas(p_minutos int default 30)`
  (envoltorio de `private.…`, `security definer`, `search_path=''`, solo `service_role`) marca `fallida`, con el motivo «Se
  interrumpió el procesamiento: más de N minutos sin completarse. Subí el archivo de nuevo.», toda versión `procesando` subida
  hace más de N minutos y sin candado de indexación vigente (`indexando:<ms>:<id>` de menos de 10 minutos, el mismo
  vencimiento del handler; un candado ilegible o con un instante en el futuro, de más de un minuto, no protege) y borra sus
  fragmentos huérfanos. Devuelve cuántas marcó; es idempotente. `p_minutos` nulo o menor que 1: 22023. Se invoca a mano, p. ej.
  `select public.liberar_versiones_documento_atascadas(30);` con service_role; **agendarla (Kestra o pg_cron) queda como seguimiento**:
  la pantalla ofrece «Reintentar» a los 15 minutos, así que conviene un N mayor y recordar que después del barrido la versión solo se
  recupera subiendo el archivo de nuevo.
- **MCP: una fila por funcionalidad** en `fuentes_mcp` y `acciones_mcp` (índices únicos por `feature_id`;
  `private.mcp_leer_fila` resuelve una sola vista por funcionalidad y el candado de ejecución es por credencial y funcionalidad).
  Son tablas de seguridad: si ya existen funcionalidades con varias filas, la migración **aborta** (23505) con un mensaje que las
  nombra («fuentes_mcp tiene más de una fila por feature_id (…): dejá una sola por funcionalidad y reaplicá la migración») y un
  superadmin debe dejar la fila correcta; no se borra ni se elige ninguna en silencio. `fuentes_chat_ia` no cambia: el chat parte de
  la vista. El nombrado por vista/RPC del servidor TypeScript se mantiene como defensa.
- **MCP: vencimiento en SQL.** `private.iniciar_ejecucion_mcp` pasa a `fallida` / `vencida` las ejecuciones `en_curso` de esa
  credencial y funcionalidad (solo esas: probado con otra credencial y con otra funcionalidad) con más de
  `private.ejecucion_mcp_vence_min()` minutos (10) antes de poner el candado, en la misma transacción. El servidor TypeScript ya no
  toca `ejecuciones_mcp` y la variable `MCP_EJECUCION_VENCE_MIN` se retiró. Misma firma y ACL. **No se creó** el wrapper
  `ejecutar_accion_mcp`: sigue pendiente (riesgo latente, no hay acciones registradas).
- **Chat: columnas permitidas por vista.** `fuentes_chat_ia.columnas text[]` (nullable). Con `NULL` `leer` conserva
  `select *` y acepta cualquier filtro válido (las fuentes existentes, p. ej. `ia_consulta_*`, no cambian); si está definida pide solo
  esas columnas y **solo admite filtros sobre ellas** (`FILTROS_INVALIDOS` si no: filtrar por una columna no entregada sería un
  oráculo). La base exige de 1 a 50 identificadores `[a-z0-9_]` sin nulos, vacíos ni repetidos (CHECK `fuentes_chat_ia_columnas_validas`)
  y `handler.ts` lo vuelve a validar (`columnasParaSelect`, mismo criterio): una lista inválida responde `FUENTE_NO_DISPONIBLE` sin
  consultar la vista. No se intersecta con las columnas reales (exigiría otra consulta): una columna inexistente da `ERROR_AL_LEER`.
  `sanitizarDato` sigue quitando columnas con nombre de secreto. El contrato HTTP no cambia.

## Lote 90: cupo persistente de IA, timeout y controles previos (MSF-727)

Una sola migración, `20270507900000_cupo_persistente_de_ia_por_usuario_y_hora.sql` (reaplicable; reversión documentada en el propio
archivo). Prueba: `supabase/tests/database/lote90_cupo_persistente_de_ia.test.sql` (corre con el rol no superusuario del CI, sin `skip`).

**Qué ya estaba resuelto antes del lote (lote 25) y no se tocó:** verificación de la funcionalidad con el JWT del usuario antes del
proveedor (`tiene_feature_publica`, función autenticada que ya existía; el lote no creó ni usó ninguna variante anónima), existencia y
pertenencia de la conversación (404), topes de 4000 caracteres (`mensaje`) y 2000 (`pregunta`), `max_tokens` (1024) en las ramas Anthropic
y OpenAI del chat y en la generación de `preguntar-documentos`, y `AbortSignal.timeout` en `fetch-ia.ts` y `embeddings.ts`.

**Qué hace el lote:**

- **Cupo persistente por usuario, funcionalidad y hora.** Tabla `private.ia_cupo_uso (usuario_id, funcionalidad, ventana, usos)` con clave
  primaria `(usuario_id, funcionalidad, ventana)`, RLS activado y una política que deniega todo a `anon` y `authenticated` (sin privilegios de
  tabla para ellos; `service_role` solo lee). `private.consumir_cupo_ia(p_usuario, p_funcionalidad, p_limite)` consume un uso de la hora UTC
  en curso de forma atómica (`insert ... on conflict do update ... where usos < p_limite`) y devuelve `se_consumio`, `usos_actuales` y
  `segundos_hasta_reinicio`; `public.consumir_cupo_ia` es su envoltorio RPC (solo `service_role`). Probado con 24 sesiones simultáneas
  contra un tope de 5: se consumieron exactamente 5.
- **Topes decididos:** 30 consultas por usuario y hora, por funcionalidad (`chat-ia` y `busqueda-documental` se cuentan por separado).
  Configurables con `CHAT_IA_LIMITE_HORA` y `PREGUNTAR_DOCUMENTOS_LIMITE_HORA`: se acepta un entero de **1 a 1000**; un valor ausente,
  inválido, decimal, no positivo o **mayor que 1000 vuelve a 30**. La función SQL también rechaza `p_limite` fuera de 1..1000 con 22023
  (un valor que no entra en `int` o equivale a «sin tope» no llega a la base). Antes: chat 60 por
  hora contados sobre `mensajes_chat_ia` (que el usuario podía borrar) y preguntas 30 por hora en memoria del isolate.
- **Orden de los chequeos.** Chat: JWT, cuerpo (longitud), funcionalidad (403/503), conversación existente (404/503), política (503),
  `prepararInvocacion` (400), credencial (500) y adaptador (501), y **recién entonces el cupo**, justo antes de la primera escritura y de la
  llamada al proveedor (crear la conversación, guardar el mensaje). Preguntas: JWT, cuerpo, funcionalidad, política, credencial, proveedor
  soportado (501) y cupo, justo antes del embedding. Una petición inválida o una configuración que falta no gasta cupo, y un 429 no crea
  conversaciones ni mensajes. Cambio de contrato: los rechazos 400/500/501 del chat ya no guardan un mensaje `fallida` ni crean conversación
  (el cuerpo incluye `conversacion_id` solo si el cliente la había enviado). En su lugar dejan un **log de servidor** con prefijo
  `[chat-ia-responder] configuración de la plataforma:` y el motivo (`credencial_no_disponible`, `adaptador_no_soportado:<adaptador>` o
  `politica_invalida:<código>`), sin la clave, el contenido del mensaje ni datos del usuario; un error de entrada del cliente (esquema,
  organización) no se registra. Un fallo del cupo deja el log `[cupo-ia]` con la funcionalidad y: si la RPC LANZÓ o rechazó la promesa (red, `fetch`), solo el
  nombre y el código del error (`textoDeError`, sin mensaje ni URL); si la RPC DEVOLVIÓ un error de Postgres/PostgREST (23503, 22023,
  `permission denied`…), su código y su mensaje saneado (sin el id del usuario, uuids y correos tachados, credenciales y URLs redactadas) y acotado a 300.
  **Higiene de los logs** (`supabase/functions/_shared/log-seguro.ts`): (1) los errores del proveedor, de red/`fetch`, las excepciones de la RPC
  de cupo e inesperados se registran con `textoDeError`, que deja solo el nombre del error (`TypeError`, `AbortError`) y un `code` corto de
  caracteres simples (o el código propio de la plataforma, como `EMBEDDING_PROVEEDOR_IA_TIMEOUT`): nunca el mensaje, la `cause` ni la URL,
  que pueden traer claves; un nombre o `code` con `sk-`, `eyJ` o `Bearer` se omite; (2) el resto de los datos variables pasa por
  `limpiarParaLog` (recorta antes de limpiar; una sola línea: saltos, controles, NUL y U+2028/U+2029 por un espacio; sin par sustituto partido
  al final; el `max` se normaliza igual en `limpiarParaLog` y `mensajeParaLog`: entero finito >= 0, los decimales se truncan y cualquier otro
  valor usa 300; adaptador y códigos a 64, mensajes a 300); (3) los mensajes que DEVUELVE la base (verificación de funcionalidad, error al
  marcar la versión fallida, búsqueda, creación de la conversación, error de la RPC de cupo) pasan además por `redactarCredenciales`, SIEMPRE
  antes del recorte final: URL de cualquier esquema (`https://`, `postgres://`…), JWT, `Bearer`, `sk-…`, `Authorization` con su esquema
  (`Basic`, `Digest`, `Token`) y campos sensibles (`apikey`, `api_key`, `secret`, `token`, `password`, `passwd`), también con el nombre
  embebido en uno más largo (`sb-access-token`) y con comillas JSON. La redacción cubre esos formatos y **no es exhaustiva** (no cubre
  `AIza…`, `xoxb-…`, `ghp_…` ni base64 sin prefijo): los errores de red o del proveedor no imprimen mensaje; (4) en `[cupo-ia]` se tachan,
  antes de acotar a 300, el uuid del usuario (sin distinguir mayúsculas), cualquier otro uuid, con o sin guiones (`[uuid]`), y los correos
  (`[correo]`). Como el tachado precede al recorte, un uuid completo nunca queda cortado por él y no se descarta nada al final (hacerlo
  borraría texto legítimo como `commit deadbeef`); (5) los helpers de `log-seguro.ts` y los `catch` de `embeddings.ts` y `packages/ia` leen los
  campos de un error sin lanzar (getters o `Proxy` hostiles), porque se usan dentro de bloques `catch`.
  **Logs del chat y de preguntar-documentos** (cada uno con su prueba): chat: funcionalidad no verificable, `[chat-ia-responder] configuración de
  la plataforma` (política, credencial, adaptador), fallo del proveedor (1.ª y 2.ª llamada en Anthropic y en OpenAI), error inesperado, no se
  pudo crear la conversación, no se pudo guardar el mensaje del usuario y la respuesta; preguntar-documentos: funcionalidad no verificable,
  credencial, proveedor no soportado, fallo del embedding, fallo del proveedor y búsqueda. Los rechazos del cliente o de estado (403, 400, 404, 429,
  503 de política) no dejan log.
  **Alcance de la regla:** vale para `chat-ia-responder`, `preguntar-documentos`, `indexar-documento` (handler, `fragmentos.ts`, `index.ts`) y
  `_shared/cupo-ia.ts`. Quedan fuera, por no tener datos variables, `_shared/token.ts` (`console.warn` con un texto fijo) y, por no correr en
  producción, `_shared/verificacion/smtp-real.deno.ts` (script manual de verificación). Las demás funciones fuera de IA siguen imprimiendo
  `error.message` (ver «Pendientes»).
  **Volumen:** son una línea por petición fallida, acotada en longitud y sin datos del usuario ni del contenido;
  con la base caída pueden repetirse una vez por petición y no hay limitador (el volumen lo acota el tamaño del tráfico, y el cupo no
  aplica si la RPC falla). Si se vuelve un problema, el seguimiento es agregar un limitador por minuto.
  **Costo de ese orden:** un usuario sin cupo paga `prepararInvocacion` y `obtener_clave_perfil_ia` (una lectura que descifra la clave del
  proveedor) en CADA petición antes de recibir el 429. Es solo lectura y no llama al proveedor, y los 500/501 solo ocurren con la
  plataforma mal configurada. Se descartó un cupo previo «suave» antes de esas lecturas porque rompería la regla de que un 400/500/501 no
  gasta cupo.
- **Qué cuenta como un uso.** (a) El uso se consume ANTES de llamar al proveedor y **no se reintegra**: un error, un timeout (504) o un 502 del
  proveedor ya gastaron ese uso. (b) Una unidad de cupo es **una petición HTTP**: el chat puede hacer hasta 2 llamadas al proveedor (la
  consulta y el ciclo de la herramienta `leer`) por un solo uso. (c) El cupo es **por usuario y por funcionalidad, no por organización**: una
  organización con N usuarios, o una persona con N cuentas, obtiene 30·N por hora; el techo por organización queda como seguimiento.
- **Cupo agotado:** 429 con `Retry-After` (segundos hasta la próxima hora en punto UTC) y mensaje en español, sin llamar al proveedor ni crear
  nada. **Falla cerrado:** si la base no responde, la RPC lanza o rechaza la promesa, o la respuesta no se entiende, 503 «No se pudo verificar tu cuota de uso.» y no se gasta crédito.
- **Timeout.** `invocarProveedorIa` y `descubrirModelos` (`packages/ia`) aceptan `{ timeoutMs }` opcional (agregan `AbortSignal.timeout`) y
  convierten el tiempo agotado en `INVOCACION_PROVEEDOR_IA_TIMEOUT` / `DESCUBRIMIENTO_MODELOS_IA_TIMEOUT`; `embeddings.ts` en
  `EMBEDDING_PROVEEDOR_IA_TIMEOUT`. Las funciones responden **504** «El proveedor de IA tardó demasiado en responder, probá de nuevo.» (antes
  502) sin detalle del proveedor. Los dos handlers siguen inyectando `fetchConTimeout`, así que el tope real sigue siendo el de la política
  (máximo 90 s). Cambio de contrato: el 504 es nuevo; el resto de los estados no cambió.
- **Purga:** `private.purgar_cupo_ia(p_dias int default 2)` borra las ventanas anteriores a `p_dias` días (idempotente, devuelve cuántas borró).
  **No está agendada.** Invocar como `service_role` o dueño: `select private.purgar_cupo_ia();`. Agendarla queda como seguimiento.
- **Sin auditoría de consumo.** Existe `ia_interacciones` (`actor_id`, `consumidor_codigo`, `iniciada_en`), pero no se usó: es la máquina de
  estados de la capacidad de IA gobernada (una fila por ejecución con política, perfil, `idempotency_key` única por consumidor, estados y
  purga de evidencia) y ni `chat-ia-responder` ni `preguntar-documentos` escriben en ella. Guarda estados por ejecución, no un contador atómico por usuario y hora,
  y no cubre las peticiones rechazadas antes de invocar. `ia_cupo_uso` guarda solo los
  contadores de la hora y se purga. Tampoco `ia_consulta_registro` sirve: esa migración (`20270224110100_ia_consulta_registro.sql`) y su test registran las cuatro fuentes de consulta del asistente (insertan en `features`, `eventos_features`, `fuentes_chat_ia`, `fuentes_mcp`, `capacidades_chat_ia` y `capacidades_mcp`), no crean ninguna tabla de uso.

**Orden de despliegue:** aplicar la migración ANTES de desplegar `chat-ia-responder` y `preguntar-documentos`. Si una función sale primero,
`public.consumir_cupo_ia` no existe y toda consulta responde 503 (falla cerrado: no se gasta crédito, pero el chat y la búsqueda
documental quedan sin servicio hasta aplicar la migración).

**Reversión: advertencia.** Revertir quita el único cupo persistente: hay que volver a desplegar antes las versiones anteriores de las dos
funciones y después borrar la tabla y las funciones (pasos en el encabezado de la migración). Con las versiones anteriores vuelve el tope de
mejor esfuerzo (mensajes borrables y contador por isolate) y se reabre el hueco de gasto de crédito del proveedor sin cuota real.
