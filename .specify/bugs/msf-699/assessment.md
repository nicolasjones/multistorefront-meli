# Bug Assessment: la importación CSV de migración trunca celdas sobrantes en silencio y Documentos IA deja documentos huérfanos sin validar tamaño ni tipo

- **Slug**: msf-699 (provisto por el usuario)
- **Created**: 2026-11-01
- **Source**: pasted text — "[Bug] Importaciones: el CSV de migración descarta en silencio las celdas sobrantes de una fila y Documentos IA deja documentos huérfanos sin validar tamaño ni tipo (It's a Plan MSF-699) slug=msf-699". Sin URL: no hay nada que traer.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> Importaciones: el CSV de migración descarta en silencio las celdas sobrantes de una fila
> y Documentos IA deja documentos huérfanos sin validar tamaño ni tipo.

El reporte agrupa dos defectos independientes, en dos pantallas distintas:

1. **Migración de datos** (`/migracion/importar/:entidad`): una fila del CSV con más
   valores que columnas de encabezado pierde los valores sobrantes **sin aviso**, sin
   error y sin marca en la vista previa.
2. **IA › Documentos** (`/ia/documentos`): la pantalla de subida no valida tamaño ni
   tipo antes de tocar la base, y si la subida falla después de crear la identidad
   lógica del documento quedan filas (y objetos de Storage) huérfanos.

## Symptom

**CSV de migración.** El ancho de la fila se define por el encabezado
(`encabezados.length`) y las celdas que exceden ese ancho se descartan en silencio.
Esperado: que el asistente de importación detecte la fila inconsistente y la
reporte (error o aviso) antes de aplicar la carga, como ya hace con las filas que
no pasan la validación de la base.

Consecuencia práctica: en una fila con una **coma sin escapar** (típico de un
export de Excel: `1,Cliente, S.A.,20300123456` con 3 columnas de encabezado), el
parser ve 4 valores, corre todo a la izquierda y **descarta el último**: la fila
queda `["1", "Cliente", "S.A."]` — el DNI/CUIT real desaparece y `"S.A."` queda
en la columna del documento. La carga se aplica y el informe de conciliación
dice que todo salió bien.

**Documentos IA.** `subirArchivo` no mira `archivo.size` ni `archivo.type` (el
`accept` del `<input type="file">` es solo una sugerencia del selector de
archivos, no una validación) y crea la fila en `documentos` **antes** de subir el
archivo. Si la subida falla (tamaño > 20 MB, MIME no permitido, red), la fila
queda creada y sin ninguna versión: un documento huérfano, visible en la lista y
nunca indexable. Si la subida funciona pero falla el insert de
`versiones_documento`, además queda un **objeto huérfano en el bucket**: ese
objeto no lo referencia ninguna versión, y `private.eliminar_documento` solo borra
los objetos cuyo `storage_path` está en `versiones_documento` → nunca se borra.

## Reproduction

### A. CSV de migración (celdas sobrantes)

1. Armar `clientes.csv` con encabezado de 3 columnas
   (`id_externo,nombre,documento`) y una fila con una coma sin escapar en el
   nombre: `1,Cliente, S.A.,20300123456`.
2. `/migracion/importar/clientes` → «Elegir archivo CSV» → el archivo se acepta
   sin ningún aviso (chip «N filas · UTF-8»).
3. «Mapear columnas» → el mapeo automático es correcto (3 columnas).
4. «Vista previa» → la fila aparece **válida**, sin error ni warning.
5. «Importar» → la fila se carga con `documento = "S.A."` y el DNI/CUIT
   `20300123456` no existe en ningún lado.

Evidencia reproducida con la lógica vigente de `analizarCsv` (copia en `/tmp`, sin
tocar el repo): para `id_externo,nombre,documento\n1,Cliente, S.A.,20300123456\n2,Obra SRL,20300123457\n`
la fila 2 queda `["1","Cliente","S.A."]` y la celda `20300123456` no aparece en
ningún lado. Para `nombre,id_externo\nUno,SINT-1,EXTRA-SOBRANTE\n` la celda
`EXTRA-SOBRANTE` tampoco aparece.

### B. Documentos IA (huérfanos y sin validación)

1. `/ia/documentos` con la funcionalidad `busqueda-documental` habilitada.
2. «Subir documento» → elegir un archivo de 25 MB (o un `.exe` renombrado a
   `.txt`): **no hay validación previa**, el picker lo deja pasar.
3. Se crea la fila en `documentos` (paso 1 del flujo) y recién después se sube
   el archivo; Storage lo rechaza por `file_size_limit` / `allowed_mime_types`.
4. El `catch` muestra el mensaje crudo de Storage (en inglés) y **no borra la fila
   creada** → el documento queda listado como «Click para ver historial de
   versiones», sin ninguna versión, sin archivo y sin motivo visible.
5. Variante: si la subida funciona pero falla el insert de `versiones_documento`,
   el objeto queda en el bucket `documentos-rag` sin fila que lo referencie →
   objeto huérfano que `eliminar_documento` no alcanza a borrar.

## Suspected Code Paths

### CSV de migración

- `apps/web/src/lib/migracionCsv.ts:143-152` (`analizarCsv`) — **origen del
  descarte silencioso**: `const ancho = encabezados.length` y
  `celdas: Array.from({ length: ancho }, (_, indice) => (fila.celdas[indice] ?? '').trim())`
  recortan toda celda que exceda el ancho del encabezado. No hay ninguna marca ni
  error asociado.
- `apps/web/src/lib/migracionCsv.ts:49-52` — el test «rellena columnas faltantes y
  recorta los valores» cubre el caso de **menos** celdas, no el de más: el hueco
  de cobertura es exacto.
- `apps/web/src/lib/migracion.ts:133-142` (`construirFilas`) — mapeo **posicional**
  (`fila.celdas[Number(indice)]`): la fila ya viene truncada y desalineada, así
  que la celda perdida nunca llega a la RPC y la carga se aplica como si fuera
  correcta.
- `apps/web/src/pages/migracion/AsistenteImportacion.tsx:133` y `:313` — la pantalla
  solo muestra cantidad de filas y de columnas; ningún punto de la UI tiene dónde
  mostrar «la fila N tiene una celda de más».
- `apps/web/src/pages/migracion/entidades/*.ts` — las definiciones de entidad
  (campos, obligatorios) no contemplan el caso «más celdas que columnas»; la
  validación de la base (`previsualizar_lote_*`) tampoco lo ve porque recibe
  campos ya mapeados.

No es el importador del historial: `workers/historial-importador/src/lector.ts:35`
usa PapaParse y `workers/historial-importador/src/validar.ts:35` (`mapearColumnas`)
mapea **por nombre de encabezado**, no por posición → una celda de más en una fila
no desplaza los demás valores. Es otro camino de código, no el del reporte.

### Documentos IA

- `apps/web/src/pages/ia/documentos.tsx:50-91` (`subirArchivo`) — **origen de los
  huérfanos**: inserta `documentos` (`:61`) → sube a Storage (`:68`) → inserta
  `versiones_documento` (`:71`) → invoca `indexar-documento` (`:74`). Entre pasos
  no hay rollback ni limpieza.
- `apps/web/src/pages/ia/documentos.tsx:86-88` — el `catch` solo muestra
  `uploadError.message` crudo (texto de Storage en inglés) y no deshace nada.
- `apps/web/src/pages/ia/documentos.tsx:142` — `accept=".txt,.pdf,.docx"`: hint del
  selector, no validación; no hay `archivo.size` ni `archivo.type` en ninguna
  parte del archivo.
- `apps/web/src/pages/ia/documentos.tsx:55-57` y `:168`
  (`documentoAActualizarRef`) — si el usuario cancela el selector después de
  pulsar «Actualizar», el `onChange` no dispara y la ref queda apuntando al
  documento anterior: la **subida siguiente** crea una versión de ese documento
  viejo en vez de un documento nuevo (y `documentos.nombre` no se actualiza).
- `supabase/functions/indexar-documento/index.ts:53-70` (`extraerTexto`) y
  `:119-123` — el parser se elige por la **extensión del nombre del documento**
  (`documentos.nombre`), no por el archivo: si el nombre no acompaña al archivo
  (caso de la ref vencida, o de una actualización con otro formato) el texto sale
  mal o la versión queda `fallida` con «formato no soportado».
- `supabase/migrations/20261005000001_rag_busqueda_documental.sql:154-161` — el
  bucket `documentos-rag` **sí** limita en el servidor (20 MB y tres MIME), o sea
  que la guarda existe pero llega tarde: después de que la fila huérfana ya está
  creada, y con un mensaje que el usuario no entiende.
- `supabase/migrations/20261005000001_rag_busqueda_documental.sql:264-291`
  (`private.eliminar_documento`) — borra los objetos de Storage **listados en
  `versiones_documento`**: un objeto sin fila de versión no se puede borrar nunca.
- `apps/web/src/lib/historial.ts:9,65-76` (`validarArchivoHistorial`) y
  `:104-140` (`solicitarImportacionHistorial`) — **el patrón correcto ya existe en
  el repo** para el importador del historial: valida extensión/vacío/tamaño antes
  de subir y, si la RPC falla, borra el archivo recién subido («no queda un
  huérfano en el bucket privado», `historial.ts:103`). Documentos IA no tiene
  ninguna de las dos cosas.

## Root Cause Hypothesis

**CSV de migración (confianza: alta).** `analizarCsv` normaliza cada fila al ancho
del encabezado con un `Array.from({ length: ancho })`. El parser es posicional y el
encabezado es el contrato de columnas, así que una fila con más valores es
inconsistente por definición; en vez de detectarla, el código la recorta. Como el
recorte es silencioso y el mapeo posterior también es posicional, la fila queda
desalineada (el valor que estaba en la última columna se corre a la anterior) y se
carga como válida: pérdida de datos sin señal. El caso raíz habitual es una coma
sin escapar dentro de un valor (exports de Excel), que es exactamente lo que
produce una celda de más. El hueco de tests es coherente con el defecto: solo se
cubre el caso de menos celdas (`migracionCsv.test.ts:49-52`).

**Documentos IA (confianza: alta).** La pantalla no valida el archivo antes de
escribir y escribe en tres pasos sin compensación: crea la identidad lógica
(`documentos`), sube el objeto y recién después crea la versión. Cualquier
fallo intermedio deja una fila sin versión (documento huérfano) y/o un objeto de
Storage sin fila que lo referencie (huérfano permanente, porque la purga solo
recorre `versiones_documento`). La ausencia de validación previa de tamaño y tipo
es la causa disparadora: el rechazo del bucket —que sí existe y es correcto— llega
cuando el huérfano ya está creado, y como el `catch` no limpia, se queda. En
paralelo, la `ref` de «Actualizar» no se limpia si el usuario cancela el selector,
lo que permite adjuntar un archivo al documento equivocado y dejar el nombre
(que es lo que decide el parser del lado del servidor) desalineado con el
contenido real.

## Proposed Remediation

**Preferred — CSV de migración.** En `analizarCsv`, dejar de recortar: detectar
las filas cuyo número de celdas **no vacías** excede el ancho del encabezado y
fallar con un `ErrorCsv` que nombre la fila, en el mismo estilo del error de
comillas sin cerrar (`migracionCsv.ts:119-121`):

> `La fila 12 tiene 4 valores y el archivo tiene 3 columnas. Revisá el archivo (¿una coma sin escapar?).`

**No** se bloquea por celdas sobrantes **vacías** (una coma final genera una
celda vacía de más: es inocuo y hoy pasa en exports reales). La fila se reporta
entera, no se importa nada. Racional: en un CSV posicional una fila con más
valores significa que las columnas están corridas → los datos que se importen
están desalineados, así que esa fila (y su archivo) no es confiable; el asistente
ya tiene la filosofía de «un archivo que no se puede leer no avanza en el
asistente» (comentario de `migracionCsv.ts:8-9`).

**Preferred — Documentos IA.** Tres cambios, en el orden del flujo:

1. **Validar antes de escribir.** Un `validarArchivoDocumento(archivo)` (módulo
   nuevo `apps/web/src/lib/documentosIa.ts`, calcado de
   `validarArchivoHistorial` en `apps/web/src/lib/historial.ts:65-76`): extensión
   en {txt, pdf, docx}, archivo no vacío y tamaño ≤ 20 MB (el mismo límite del
   bucket, constante compartida, no un número duplicado en la UI). Mensaje en
   castellano y se detiene **antes** del insert → ni fila huérfana ni error crudo
   de Storage.
2. **Limpiar lo que ya se creó si algo falla.** Trackear el `documentoId` creado
   en este intento y, en el `catch`, hacer limpieza *best effort* como en
   `solicitarImportacionHistorial`: borrar el objeto subido
   (`storage.from('documentos-rag').remove([storagePath])`) y borrar la fila de
   `documentos` creada (RLS lo permite por organización). Si la limpieza falla, se
   loguea; el mensaje que ve el usuario sigue siendo el de la causa real.
3. **Cerrar la ref de «Actualizar» y el nombre del documento.** Limpiar
   `documentoAActualizarRef` cuando el selector se cancela (por ejemplo, escuchando
   el `focus` de la ventana o reseteando la ref en el `onClick` del botón «Subir
   documento» antes de abrir el selector) y **actualizar `documentos.nombre`** al
   subir una versión nueva, para que el parser del servidor ([
   `indexar-documento/index.ts:119-123`]) use la extensión del archivo real.

**Alternatives**:
- *CSV — marcar la fila como error en vez de bloquear el archivo*: encaja con el
  mecanismo de «filas con error» de la vista previa, pero exige que la fila viaje
  a la RPC con un dato nuevo (la celda sobrante) → **migración + cambio de
  contrato** para las cuatro entidades. Más caro y, si la fila está corrida, la
  RPC la importaría igual salvo que también se marque. Solo tiene sentido si
  negocio prefiere seguir importando el resto del archivo.
- *CSV — recortar pero avisar*: mostrar un contador «N filas con celdas de más»
  sin bloquear. **Descartado**: mantiene la corrupción de datos y el aviso se
  pierde en la pantalla de resultado.
- *Documentos IA — subir el archivo antes de crear las filas*: cambiar el
  `storage_path` a `{organizacion_id}/{version_id}` (la policy del bucket solo
  exige que el primer segmento sea la organización, así que sigue siendo válido).
  Reduce una ventana de huérfano, pero **no la elimina**: si el insert de
  `documentos` falla queda el objeto huérfano. La limpieza compensatoria sigue
  haciendo falta.
- *Documentos IA — guardar el nombre/mime del archivo por versión* (columna
  `nombre_archivo` en `versiones_documento`, migración aditiva): es la solución
  robusta para que el parser no dependa del nombre lógico del documento, pero
  agrega una migración y un campo más al modelo. Queda como segunda etapa si se
  quiere que «Actualizar» con otro formato funcione de punta a punta.

**Files likely to change**:
- `apps/web/src/lib/migracionCsv.ts` (no recortar + `ErrorCsv` con el número de fila)
- `apps/web/src/lib/migracionCsv.test.ts` (caso de celdas sobrantes)
- `apps/web/src/pages/ia/documentos.tsx` (validación previa, limpieza, ref, nombre)
- `apps/web/src/lib/documentosIa.ts` (nuevo: validación + constantes compartidas
  con el bucket)
- `apps/web/src/pages/ia/documentos.test.tsx` (nuevo)
- `supabase/functions/indexar-documento/index.ts` (solo si se cambia la
  detección de formato)
- `supabase/migrations/<nuevo>_versiones_documento_nombre_archivo.sql` (solo en la
  alternativa de la columna por versión)
- `docs/migracion-inicial-de-datos.md` (el error nuevo y el paso «subir → mapear»
  revisado) y `docs/roadmap-template.md` (fila 21, Búsqueda documental) —
  `pnpm docs:check` exige documentación equivalente en el mismo cambio

**Tests to add or update**:
- Vitest `migracionCsv.test.ts`: fila con más celdas que el encabezado → `ErrorCsv`
  con el número de fila; celdas sobrantes **vacías** (coma final) → se siguen
  ignorando; los tests actuales (menos celdas, comillas, BOM, `;`) siguen pasando.
- Vitest `apps/web/src/pages/ia/documentos.test.tsx` (nuevo): archivo de 25 MB →
  mensaje de tamaño y **ninguna** llamada a `documentos.insert`; `.exe` → mensaje
  de formato; subida fallida → no queda fila en `documentos` ni objeto en el
  bucket; cancelar el selector de «Actualizar» y subir después → crea un
  documento nuevo, no una versión del anterior.
- pgTAP `supabase/tests/database/rag_busqueda_documental.test.sql`: si se agrega
  la columna `nombre_archivo`, su default y su lectura por la Edge Function.

## Risks & Considerations

- **Falsos positivos al bloquear el archivo**: hay exports reales con una coma
  final (celda sobrante vacía) — el corte tiene que distinguir “celda sobrante con
  contenido” de “celda sobrante vacía”, si no se bloquean archivos que hoy
  importan bien. Hay que decidir con negocio si bloquear **todo el archivo** o
  solo **esa fila** (hoy la base ya rechaza filas inválidas con motivo y número,
  así que marcar la fila es viable; pero la fila desalineada no es confiable).
- **Cambio de UX en una migración en curso**: bloquear un archivo que antes
  “funcionaba” (con datos corridos) es visible para el usuario que está
  migrando. Conviene comunicarlo en las notas de release (el repo usa
  release-please) y en `docs/migracion-inicial-de-datos.md`.
- **La limpieza en el `catch` borra una fila que el usuario puede no conocer**:
  solo debe borrar el `documentos` que esa misma llamada acaba de crear (id
  trackeado en el intento), nunca uno preexistente.
- **Borrar el objeto subido puede fallar** (políticas de Storage): la limpieza
  es *best effort* y se loguea; no debe tapar el error original que ve el usuario.
- **El límite de 20 MB está en el bucket** (`file_size_limit = 20971520`); el
  número en la UI debe salir de la misma constante/configuración, no escrito a
  mano en dos lugares.
- **Sin migración obligatoria**: el arreglo preferido es solo TypeScript. La
  migración es aditiva si se elige la columna `nombre_archivo`.
- **RLS**: el borrado compensatorio del documento debe usar la sesión del usuario
  (`documentos` tiene policy de delete por organización) — nunca service-role en
  el navegador (regla del repo).
- **`documentos.nombre`**: al actualizarlo se cambia lo que el usuario ve en la
  lista; es razonable (el nombre del archivo nuevo), pero es un cambio visible en
  el producto y hay que documentarlo.

## Open Questions

- [NEEDS CLARIFICATION: ¿Una fila con celdas sobrantes debe bloquear el archivo
  entero o solo esa fila? Recomendación: bloquear el archivo, porque la fila
  desalineada no es confiable — pero hay que confirmarlo con negocio.]
- [NEEDS CLARIFICATION: ¿Confirmar 20 MB como el límite que se muestra en la UI de
  Documentos? Es el que impone el bucket (`file_size_limit = 20971520`).]
- [NEEDS CLARIFICATION: «Documentos huérfanos» — se interpreta como *filas de
  `documentos` sin versión* y *objetos de Storage sin versión que los referencie*.
  ¿Alguno de los dos debe además purgarse con una rutina periódica, o alcanza con
  la limpieza en el `catch`?]
- [NEEDS CLARIFICATION: ¿El nombre del documento debe actualizarse al subir una
  versión nueva, o el nombre lógico (`documentos.nombre`) se congela en la
  primera carga? Depende de si el nombre es “la identidad del documento” o “el
  nombre del archivo”.]
