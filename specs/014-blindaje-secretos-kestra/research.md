# Investigación: blindaje de secretos

## R1. Los outputs de Kestra no son un canal para credenciales

**Decisión**: eliminar las tareas JDBC que devuelven credenciales a
`outputs.*`; el flow solo transmite IDs no sensibles y el worker recupera la
credencial dentro de su propio proceso.

**Rationale**: la documentación de Kestra indica que los outputs se almacenan
en texto claro en el backend, el almacenamiento interno, los logs y las
respuestas API. Las plantillas existentes hacen precisamente eso mediante
`obtener_credencial_*`.

**Alternativas consideradas**:

- Conservar el output y redactar logs: rechazado, porque el output y el
  historial siguen siendo recuperables.
- Usar `encryptedOutputs`: rechazado, pues requiere Enterprise/Cloud y el
  template usa Kestra OSS; además seguiría transportando el secreto por Kestra.

## R2. El worker debe obtener solamente la credencial de su organización

**Decisión**: agregar una función `SECURITY DEFINER` de Supabase, ejecutable
por un rol de grupo de workers, que valide que `session_user` corresponde al
servidor de la organización y que la conexión solicitada le pertenece; recién
entonces devuelve el valor descifrado desde Vault. El aprovisionamiento agrega
cada rol `worker_<organizacion_id>` a ese grupo.

**Rationale**: evita dar SELECT sobre `conexiones`, Vault o las tablas de
orquestación. La credencial viaja directamente al proceso que la usa, no al
orquestador. La prueba pgTAP puede demostrar pertenencia, ausencia de permisos
directos y rechazo cruzado.

**Alternativas consideradas**:

- Dar acceso directo de Vault al worker: rechazado por privilegio excesivo.
- Mantener la función actual para Kestra: rechazado porque su resultado se
  persiste como output.

## R3. La autenticación SSH no debe resolverse por ejecución

**Decisión**: usar una clave de orquestación estática, instalada como clave
pública autorizada en cada servidor de organización y referenciada en el flow
con `secret('ORQUESTACION_SSH_PRIVATE_KEY')`. Documentar en el `.env.example` de
la raíz la
variable `SECRET_ORQUESTACION_SSH_PRIVATE_KEY` codificada en Base64, sin valor
real.

**Rationale**: Kestra OSS resuelve `secret()` desde variables `SECRET_` y evita
que el valor aparezca en YAML, outputs o logs. El password SSH actual proviene
de una tarea JDBC y es un segundo secreto de organización expuesto.

**Alternativas consideradas**:

- Password SSH por output: rechazado por la misma filtración.
- Una clave privada por organización recuperada dinámicamente: rechazado,
  porque reincorpora el secreto en el contexto de ejecución.

## R4. Sanitización antes de cruzar límites persistentes

**Decisión**: definir una rutina de sanitización en el worker para el valor
literal, URL y Base64 de la credencial actual; el worker solo emitirá
`CREDENCIAL_INVALIDA:<conexion_id>` o una causa técnica ya sanitizada. Los
flows no usarán `errorLogs()` como motivo: llamarán al handler con clasificación
y causa segura explícitas.

**Rationale**: Kestra advierte que la ofuscación de logs es de mejor esfuerzo y
que transformaciones pueden sortearla. Sanitizar antes de stdout/stderr,
outputs, alertas y SQL conserva diagnóstico útil sin persistir el secreto.

**Alternativas consideradas**:

- Confiar solamente en masking de Kestra: rechazado, no cubre variantes.
- Eliminar toda causa de error: rechazado, incumple FR-003 y FR-005.

## R5. Prueba con centinela y sin saneamiento retroactivo

**Decisión**: añadir una prueba de contrato/recorrido local que ejecute los
dos flows con un centinela y sus variantes, inspeccione la ejecución y los
registros de alertas, y confirme cero apariciones. No se modifica historial
previo.

**Rationale**: responde directamente SC-001 y SC-004 sin tratar contenido
histórico potencialmente sensible durante una entrega preventiva.

**Alternativas consideradas**:

- Solo revisión de YAML: rechazado, no prueba persistencia en runtime.
- Purgar historial existente: fuera del alcance aclarado de esta spec.
