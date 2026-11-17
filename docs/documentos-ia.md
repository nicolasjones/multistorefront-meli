---
owner: tecnico
sources:
  - specs/20261005-document-rag-mechanism
  - apps/web/src/lib/documentosIa.ts
  - supabase/migrations/20261005000001_rag_busqueda_documental.sql
---

# Documentos IA (búsqueda documental)

Pantalla **IA › Documentos** (`/ia/documentos`): la organización sube documentos propios y les
pregunta en lenguaje natural; la respuesta cita el documento de origen. Spec:
`specs/20261005-document-rag-mechanism/spec.md`.
El bucket, los permisos y la indexación están en la migración
`20261005000001_rag_busqueda_documental.sql`.

## Qué se sube y con qué reglas (MSF-699)

| Regla | Valor | De dónde sale |
|---|---|---|
| Formatos | `.txt`, `.pdf`, `.docx` | `apps/web/src/lib/documentosIa.ts` (`EXTENSIONES`) |
| Tamaño máximo | 20 MB | el mismo límite del bucket `documentos-rag` (`file_size_limit = 20971520`) |
| MIME | `text/plain`, `application/pdf`, MIME de Word | `allowed_mime_types` del bucket |

El archivo se **valida en el navegador antes de tocar la base**: si el formato no está admitido,
si está vacío o si pesa más de 20 MB, la pantalla lo dice y **no crea el documento ni sube
nada**. El `accept` del selector es solo una sugerencia (el navegador deja elegir cualquier
archivo): la validación real es la del código. El `content-type` con el que se sube es el del
bucket para la extensión del archivo, no el que informa el navegador.

## Sin documentos huérfanos

La subida son tres pasos: crear el documento → subir el objeto a Storage → registrar la versión.
Si algo falla en el medio, se deshace lo que **ese** intento creó:

- Si falla la subida o el registro de la versión, se borra el objeto del bucket y la fila de
  `documentos` que se había creado. No queda un documento sin versión ni un objeto que ninguna
  versión referencia (esa última purga no la puede alcanzar `eliminar_documento`, que solo
  borra los objetos listados en `versiones_documento`).
- Si falla la indexación, la versión ya quedó registrada: se conservan el documento, la versión
  y el objeto. La versión queda en `fallida` con su motivo (es el estado que deja la Edge
  Function `indexar-documento`).
  Desde el lote de endurecimiento, solo los errores permanentes (documento sin texto o con más de 2000 fragmentos)
  dejan la versión `fallida`; un fallo transitorio (proveedor, descarga) la deja `procesando`, y una invocación
  duplicada recibe 409 sin pisar la versión activa. Pasados 15 minutos la pantalla muestra «Se interrumpió el procesamiento»
  con el botón Reintentar (reintento manual; no hay barrido automático). Un 42501 al activar deja la versión `fallida`. Ver [funciones-edge-endurecimiento.md](funciones-edge-endurecimiento.md).

La limpieza es *best effort*: si no se puede borrar, queda registrado en la consola y el mensaje
que ve el usuario sigue siendo el de la causa real. Nunca se borra un documento que ya existía
antes del intento (solo el que creó esta misma subida).

## Versiones

- «Actualizar» sube una **versión nueva** del mismo documento: la anterior queda `reemplazada` y
  la nueva `activa` (FR-003: la activación es atómica, nunca hay una ventana sin versión usable).
- El **nombre del documento sigue al archivo** que se subió: el servidor elige el parser por la
  extensión de `documentos.nombre`, así que un `.pdf` nuevo sobre un documento que era `.txt`
  se puede indexar.
- «Actualizar» y «Subir documento» no se mezclan: si se cancela el selector de archivos, la
  siguiente subida por «Subir documento» crea un **documento nuevo**, no una versión del anterior.

## Errores que se muestran

| Situación | Qué ve el usuario |
|---|---|
| Falla la RPC que verifica la funcionalidad | «No pudimos verificar la búsqueda documental» con reintentar (no «todavía no está habilitada»: eso es otra cosa) |
| Falla la carga de la lista | «No pudimos cargar los documentos» con reintentar (no «Todavía no hay documentos») |
| El bucket rechaza el archivo | Mensaje en castellano; lo que se había creado se limpia |

## Aislamiento y permisos

- El navegador usa **la sesión del usuario**, nunca una service-role key: las policies de
  `documentos`, `versiones_documento` y del bucket acotan todo a la organización de la sesión
  (`private.organizacion_id()`), y la primera parte de la ruta en Storage es el id de la
  organización.
- La búsqueda documental es una **funcionalidad habilitada por organización**
  (`busqueda-documental`): si no está habilitada, la pantalla lo dice y no lista nada.
- Eliminar un documento purga de verdad: objetos de Storage, versiones y fragmentos indexados
  (`private.eliminar_documento`).

## Pruebas

- `apps/web/src/lib/documentosIa.test.ts`: formatos, tamaño (incluido el límite exacto), MIME.
- `apps/web/src/pages/ia/documentos.test.tsx`: archivo no admitido o muy grande sin tocar la
  base, limpieza del documento y del objeto cuando falla la subida o la versión, versión nueva
  que actualiza el nombre, cancelación del selector de «Actualizar» y errores de la RPC de
  funcionalidad y de la lista.

## Activación de una versión (MSF-652)

`public.activar_version_documento(p_version_id)` (la llama `indexar-documento` con la sesión de quien subió el archivo) valida, desde `20270507150000`: que la versión pertenezca a la organización del llamador (versión inexistente, ya procesada o de otra organización dan el mismo error genérico `22023`), que la funcionalidad `busqueda-documental` esté habilitada y que el llamador sea quien subió la versión o un administrador de la organización (`42501` si no). `anon` no ejecuta la RPC. Prueba: `supabase/tests/database/activar_version_documento_valida_organizacion.test.sql`.

## Escritura de documentos: Consulta no escribe (lote 32 · MSF-651)

Regla: **el rol Consulta no sube, modifica ni borra documentos de la búsqueda documental**; los demás roles (Administrador, Operador,
Mostrador, Depósito, Administración, Técnico) siguen operando como hasta ahora. Desde `20270507180400` las políticas de escritura de
`public.fragmentos_indexados`, `public.documentos`, `public.versiones_documento` y las de insert/delete del bucket `documentos-rag`
exigen `private.puede_gestionar_documentos()` (miembro activo con rol distinto de `consulta`, o superadmin con organización activa);
`private.eliminar_documento` (la RPC `eliminar_documento`) rechaza con `42501` a Consulta. La lectura y la búsqueda no cambian.

La función Edge `indexar-documento` escribe y borra los fragmentos con el **cliente de servicio**, pero solo después de la
autorización que ya hace con el JWT del usuario (funcionalidad, RLS sobre la versión, permiso y reclamo propio) y acotada a esa
versión: relee la versión por RLS y exige que los fragmentos sean de esa versión y de su organización (el handler no cambió de
orden). `service_role` tiene grants explícitos sobre `fragmentos_indexados`. La pantalla distingue «No tenés permiso para subir
documentos» (403/42501/RLS) del error de conexión. Pruebas: `lote32_documentos_escritura_consulta.test.sql`.
