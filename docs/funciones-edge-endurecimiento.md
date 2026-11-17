---
owner: plataforma
sources:
  - supabase/functions/chat-ia-responder/guardas.ts
  - supabase/functions/preguntar-documentos/index.ts
  - supabase/functions/indexar-documento/handler.ts
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
  seguía llamando al proveedor) y aplica un tope por usuario: 60 mensajes por hora (`CHAT_IA_LIMITE_HORA`), contado
  sobre `mensajes_chat_ia` con la sesión del usuario, así que es un tope real y compartido entre instancias (429).
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
  la segunda recibe 409. `marcarFallida` solo actúa mientras la versión sigue `procesando`.
- Errores permanentes (sin texto legible, más de 2000 fragmentos) dejan la versión `fallida` con un mensaje claro.
  Errores transitorios (proveedor, descarga, base) **sueltan la reclamación y dejan la versión `procesando`**: el
  frontend puede reintentar la misma versión (antes devolvía 409 «ya procesada»). Los fragmentos de un intento
  previo se borran antes de insertar.

## `enviar-correo-proveedor` y avisos (MSF-731)

- Valida que el proveedor esté activo y que `correo` sea una única dirección válida; 20 envíos por hora y usuario
  (`CORREO_PROVEEDOR_LIMITE_HORA`, en memoria del isolate, 429); cada envío deja una línea en el log de la función
  (usuario, proveedor, resultado; sin asunto, cuerpo ni dirección).
- Las funciones de aviso (`enviar-aviso-faltante`, `enviar-resumen-reposicion`, `enviar-resumen-semanal`,
  `recalcular-alertas-inicio`) rechazan con 503 «no configurada» un token de menos de 32 caracteres o que empiece con
  `change-me` (`_shared/token.ts`). En local, `AVISOS_PERMITIR_TOKEN_DEBIL=true` (viene en
  `supabase/functions/.env.example`) permite el valor de ejemplo; **no la definas en stg/prd**. En stg/prd generá
  los tokens con `openssl rand -hex 32` (en Kestra van en base64 como `SECRET_*`).
- Esas cuatro funciones, que solo llama Kestra, ya no responden `Access-Control-Allow-Origin: *`.

## Servidor MCP (MSF-729)

Detalle en `packages/mcp-server/CONTRATO.md`, sección «Robustez del servidor». El MSF-677 (#1091) ya había resuelto la
revalidación de credencial por solicitud. Este lote agrega: `try/catch` del handler HTTP (500 genérico, el proceso no
muere), nombres de herramienta únicos cuando una funcionalidad tiene varias vistas o acciones, vencimiento de
ejecuciones `en_curso` abandonadas (10 minutos, `MCP_EJECUCION_VENCE_MIN`), mensajes genéricos al cliente externo y un
override de organización más amplio en `ejecutar_*`.

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
- `infra/kestra/compose.vps.yaml` exige `CORREO_MASIVO_URL_BAJA` (`${…:?}`): **el despliegue al VPS falla si el
  `.env.staging`/`.env.production` no la define.** Debe ser el origen público https del panel, sin barra final.
- Sin verificar: que la ruta `/baja-correo/:token` exista solo en el host del panel (ver informe de frontend).

## Pendientes (requieren migración o una decisión de negocio)

| Pendiente | Por qué no se hizo | Propuesta |
|---|---|---|
| Tope persistente de uso de IA y de correos por usuario/organización (MSF-727, MSF-731) | Necesita una tabla y definir los topes por plan | `uso_funciones_edge(usuario_id, organizacion_id, funcion, creado_en)` con RLS, RPC `consumir_cupo_funcion(p_funcion, p_max, p_ventana)` que cuente e inserte en una transacción; reemplaza `_shared/limite-memoria.ts`. Topes por defecto: chat 60/h, preguntas 30/h, correos a proveedor 20/h (los de este lote). Decidir si el tope es por usuario, por organización o por ambos |
| Historial persistente de envíos a proveedores (MSF-731) | Tabla nueva | `dominio.proveedores_correos_enviados(id, organizacion_id, proveedor_id, usuario_id, asunto, creado_en, resultado)` con RLS por organización y lectura con `proveedores`; la función la escribe con la sesión del usuario |
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
