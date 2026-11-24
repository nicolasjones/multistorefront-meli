---
owner: plataforma
sources:
  - supabase/functions/chat-ia-responder/guardas.ts
  - supabase/functions/preguntar-documentos/index.ts
  - supabase/functions/indexar-documento/handler.ts
  - supabase/functions/indexar-documento/consultas.ts
  - supabase/migrations/20270507200100_borrar_fragmentos_si_dueno.sql
  - supabase/functions/enviar-correo-proveedor/handler.ts
  - supabase/functions/_shared/embeddings.ts
  - supabase/functions/_shared/fetch-ia.ts
  - supabase/functions/_shared/limite-memoria.ts
  - supabase/functions/_shared/token.ts
  - supabase/functions/crear-organizacion/handler.ts
  - packages/mcp-server/src/herramientas.ts
  - packages/mcp-server/src/servidor.ts
  - packages/ia/src/purga.ts
  - infra/kestra/flows/correo-masivo.yml
---

# Funciones edge de IA y correo: endurecimiento (auditoría MSF-647, lote 25)

Qué se corrigió de los hallazgos MSF-727 a MSF-732 y MSF-711, qué ya estaba resuelto y qué queda pendiente
(con su propuesta). Ninguna corrección de este lote toca la base: lo que exige una migración figura en
«Pendientes».

## Funciones de IA: nada de crédito sin verificar (MSF-727)

- `chat-ia-responder` y `preguntar-documentos` verifican, con el JWT del propio usuario, que la organización tiene
  la funcionalidad (`tiene_feature_publica('chat-ia')` / `('busqueda-documental')`) **antes** de llamar al
  proveedor. Sin la funcionalidad: 403. Si la verificación falla: 503.
- `chat-ia-responder` valida el cuerpo (`mensaje` de texto, hasta 4000 caracteres; `conversacion_id` UUID), comprueba
  que la conversación exista y sea del usuario (404 si no; antes el insert fallaba por RLS en silencio y la función
  seguía llamando al proveedor) y aplica un tope por usuario: 60 mensajes por hora (`CHAT_IA_LIMITE_HORA`, 429),
  contado sobre `mensajes_chat_ia` con la sesión del usuario. Es compartido entre instancias pero de **mejor esfuerzo**:
  `authenticated` conserva `DELETE` sobre sus propios mensajes (la migración MSF-724 solo revocó insert/update), así que
  borrarlos reinicia el contador (ver «Pendientes»).
- `preguntar-documentos`: `pregunta` hasta 2000 caracteres y un límite de 30 preguntas por hora y usuario
  (`PREGUNTAR_DOCUMENTOS_LIMITE_HORA`). Ese límite vive **en memoria del isolate**: frena un bucle, pero no es una
  cuota global (ver «Pendientes»).
- Toda llamada al proveedor lleva `AbortSignal.timeout(limiteSegundos)` (`_shared/fetch-ia.ts`, tope 90 s) y los
  embeddings 30 s por request. La rama OpenAI del chat ahora envía `max_tokens` (1024).

## `chat-ia-responder`: persistencia y herramientas (MSF-730)

- Los inserts en `mensajes_chat_ia` ya no se ignoran (`guardarMensaje`): si la base los rechaza, la función responde
  500 en vez de «ok» sin historial.
- Si el modelo pide **varias** herramientas en un turno, se responde cada `tool_use` / `tool_call_id` (máximo 4 por
  turno; las sobrantes reciben un error corto) en vez de dar 400 en la segunda llamada al proveedor.
- La propuesta de acción guarda lo que se ejecutaría de verdad: nombre de la acción y parámetros, más la descripción
  del asistente marcada «no verificada». Quien confirma ya ve los parámetros reales.
- `leer`: los filtros elegidos por el modelo se validan (identificadores simples, valores escalares, hasta 8), las
  columnas con nombre de secreto se quitan (`sanitizarDato`) y el resultado viaja marcado como dato no confiable.
- Ya estaba resuelto antes del lote: tope de 50 filas (`limites.ts`) y creación de la propuesta por RPC
  (`proponer_accion_chat_ia`, MSF-724).

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
  función responde 502/503/500. **No hay reintento ni barrido automático.** El reintento es **manual**: la pantalla de
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
ejecuciones `en_curso` abandonadas (10 minutos, `MCP_EJECUCION_VENCE_MIN`), mensajes genéricos al cliente externo y un
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
| Barrido automático de versiones `procesando` de `indexar-documento` | Necesita migración | Función `private.cerrar_versiones_documento_colgadas(p_horas int default 6)` que pase a `fallida` (motivo «Se interrumpió el procesamiento») las `procesando` con más de N horas, programada con pg_cron o un flow de Kestra; hoy solo hay reintento manual |
| Tope persistente de uso de IA y de correos por usuario/organización (MSF-727, MSF-731) | Necesita una tabla y definir los topes por plan | `uso_funciones_edge(usuario_id, organizacion_id, funcion, creado_en)` con RLS, RPC `consumir_cupo_funcion(p_funcion, p_max, p_ventana)` que cuente e inserte en una transacción; reemplaza `_shared/limite-memoria.ts`. Topes por defecto: chat 60/h, preguntas 30/h, correos a proveedor 20/h (los de este lote). Decidir si el tope es por usuario, por organización o por ambos |
| Historial persistente de envíos a proveedores (MSF-731) | Tabla nueva | `dominio.proveedores_correos_enviados(id, organizacion_id, proveedor_id, usuario_id, asunto, creado_en, resultado)` con RLS por organización y lectura con `proveedores`; la función la escribe con la sesión del usuario |
| El tope del chat se elude borrando mensajes (MSF-727) | Revocar `DELETE` o mover el contador exige migración (no hay en este lote) | Opción A: `revoke delete on mensajes_chat_ia from authenticated` y una RPC `borrar_conversacion_chat_ia` que archive en vez de borrar. Opción B (preferida, y la misma tabla del tope persistente): `uso_funciones_edge` sin `DELETE` para el usuario, y que el chat cuente ahí |
| El override de organización del MCP es por nombre de parámetro (MSF-729) | No cubre `id_organizacion`, `tenant_id`, `empresa_id` | El wrapper SQL por acción (fila de arriba) es la solución de fondo; abrir ticket y no registrar acciones con esos parámetros hasta tenerlo |
| Lista negra de columnas secretas en `sanitizarDato` (MSF-730) | Es por nombre, ampliada pero no exhaustiva | La lista permitida por vista (`columnas`, fila siguiente) es el control real; priorizarla |
| Columnas permitidas por vista en el chat (MSF-730) | `fuentes_chat_ia` no tiene la columna | `alter table fuentes_chat_ia add column columnas text[]`; `leer` hace `select(columnas.join(','))` y rechaza si es nula |
| Índice único `(version_id, orden)` y estado `indexando` en `versiones_documento` (MSF-728) | Migración | `create unique index … on fragmentos_indexados (version_id, orden)`; ampliar el `check` de estado con `indexando` y que `activar_version_documento` acepte `indexando`. Con eso el candado deja de usar `motivo_error` |
| `feature_id` único o nombres por vista/RPC en `fuentes_mcp` / `acciones_mcp`; wrapper SQL por acción que inyecte la organización desde la credencial; vencimiento dentro de `iniciar_ejecucion_mcp` (MSF-729) | Migración y decisión de modelo | Wrapper `private.ejecutar_accion_mcp(p_credencial_id, p_rpc, p_parametros)` que resuelva la organización por la credencial y llame a la RPC registrada; mover el vencimiento (hoy en TypeScript) a SQL |
| `invitar-miembro` recorre todos los usuarios de Auth (MSF-732) | Necesita una RPC sobre `auth.users` | `private.usuario_auth_por_correo(p_correo)` (`security definer`, solo `service_role`) con un índice por `lower(email)` |
| Pedidos de `recuperar-clave-cliente` descartados en silencio (MSF-731) | Decisión de diseño | Contar por IP/host además de correo y responder siempre igual; no se puede evitar que 3 pedidos bloqueen 10 minutos al cliente sin un límite por IP |
| `iniciar-sesion-oauth` y `chat-ia-responder` siguen sin `handler.ts` completo (MSF-732) | Alcance del lote | `chat-ia-responder` ya separó `guardas.ts` con pruebas; falta extraer el handler con dependencias inyectadas como se hizo con `indexar-documento` |
| `Access-Control-Allow-Origin: *` en las funciones llamadas desde el navegador | Son llamadas por el panel | Restringir al origen del panel (`APP_URL`) cuando se decida el esquema de orígenes por ambiente |
| Un `NANGO_SECRET_KEY` con forma de UUID real en `.env.example` | Hay que confirmar si es un valor de uso real | Rotarlo si alguna vez se usó y poner un placeholder no válido |

## Verificación

`pnpm test:edge:indexar-documento`, `pnpm test:edge:compartido-ia`, `pnpm test:edge:chat-ia-limites`,
`pnpm test:edge:enviar-correo-proveedor`, `pnpm test:edge:crear-organizacion`, `pnpm test:edge:emitir-acceso-reporte`,
`pnpm test:kestra:correo-masivo`, `pnpm --filter @platform/mcp-server test` y `pnpm --filter @platform/ia test`.
