# Research: Orquestación de Workers Multi-Organización

## R1. Cómo Kestra despacha la ejecución al servidor de la organización

**Decision**: una tarea de Kestra de tipo SSH (plugin `io.kestra.plugin.fs.ssh.Command` o equivalente disponible en la imagen `kestra/kestra` ya pinneada por el repo) que se conecta al servidor de la organización con la credencial de acceso remoto de esa organización (Vault, ver R3) y ejecuta un comando remoto: `docker pull` de la imagen del worker en el tag vigente + `docker run` con las variables de conexión del conector correspondiente.

**Rationale**: es la capacidad explícita que la spec pide (FR-002) en vez de Kestra Worker Groups (Enterprise). No requiere agente ni software adicional instalado en el servidor de la organización más allá de Docker y un daemon SSH — ambos estándar en cualquier VPS.

**Alternatives considered**:
- Kestra Worker Groups: descartado explícitamente por la spec (Enterprise-only).
- Un agente propio corriendo en cada servidor de organización que haga polling a Kestra: más infraestructura y mantenimiento (Principio V) por el mismo resultado que ya logra SSH.

## R2. Cómo Kestra se autoriza para leer/escribir en las tablas de esta spec

**Decision**: un rol de Postgres dedicado, `kestra_orquestacion`, mismo patrón que `kestra_backups` (spec 011, research R1/R2): `LOGIN`, sin RLS ni privilegios generales, con `EXECUTE` acotado a las funciones `SECURITY DEFINER` que esta spec define (obtener credenciales, marcar estado de conexión, registrar alerta). Conexión JDBC directa, no vía PostgREST.

**Rationale**: mismo razonamiento que R1/R2 de la spec 011 — Kestra es un proceso de backend sin sesión de Supabase Auth; un rol dedicado con `EXECUTE` mínimo cumple FR-008 (esa credencial no crece con cada organización nueva, porque es una sola para todo Kestra, independiente de cuántas organizaciones existan).

**Alternatives considered**: reusar `service_role` — descartado, mismo motivo que la spec 011 (viola mínimo privilegio).

## R3. Cómo se cifran las credenciales de negocio y de infraestructura

**Decision**: extensión `supabase_vault` de Postgres (primer uso en este repo — no estaba habilitada). Cada credencial (de negocio en `conexiones`, de infraestructura en `servidores_organizacion`) se guarda con `vault.create_secret()`, que devuelve un `id` (uuid) guardado como columna en la tabla correspondiente. El valor descifrado solo se lee a través de `vault.decrypted_secrets`, y solo desde dentro de una función `SECURITY DEFINER` que primero valida el permiso de quien pide el secreto (ver R4) — nunca por acceso directo a esa vista desde `authenticated`.

**Rationale**: es la extensión de bóveda de secretos que ya está disponible en el proyecto de base de datos compartido (Assumptions de `spec.md`) — no se introduce una herramienta externa nueva. Cumple FR-006/FR-007 al pie de la letra: "accesibles solo mediante un mecanismo que aplique primero el control de acceso... antes de descifrar".

**Alternatives considered**:
- Cifrado aplicativo (por ejemplo, `pgcrypto` con una clave manejada por la app): más superficie propia de manejo de claves por un beneficio que Vault ya cubre.
- Guardar el secreto en un vault externo (HashiCorp Vault, AWS Secrets Manager): infraestructura nueva sin caso de uso que la justifique (Principio V) cuando Vault ya viene con Supabase.

## R4. Cómo se controla el acceso a un secreto ya cifrado

**Decision**: dos funciones `SECURITY DEFINER`, `private.obtener_credencial_conexion(p_conexion_id)` y `private.obtener_credencial_servidor(p_organizacion_id)`, cada una valida primero `private.is_superadmin() OR private.es_administrador_de(organizacion_id) OR current_user = 'kestra_orquestacion'` y solo si eso es verdadero hace el `select decrypted_secret from vault.decrypted_secrets where id = ...`. `revoke execute ... from public` + `grant execute ... to authenticated` (para que el chequeo de rol interno decida) y `grant execute ... to kestra_orquestacion` explícito.

**Rationale**: mismo mecanismo de "un solo punto de entrada que decide antes de descifrar" que ya pide FR-006/FR-007, generalizado a los dos consumidores reales: un administrador viendo/usando la conexión desde Refine, y Kestra/el worker ejecutando el conector. `private.es_administrador_de(organizacion_id)` es una función nueva con la misma forma que `private.puede_gestionar_membresias` (spec 005) — rol `administrador` en esa organización, o superadmin.

**Alternatives considered**: dejar que el propio Kestra lea `vault.decrypted_secrets` directo con su rol — descartado, es exactamente el "acceso directo a una vista de secretos ya descifrados" que FR-006 prohíbe explícitamente; pasar siempre por la función mantiene un único lugar donde auditar quién pidió qué.

## R5. Cómo el worker de una organización escribe en las tablas de dominio sin depender de un claim propio

**Decision**: al aprovisionar el servidor de una organización (FR-014), la función de aprovisionamiento crea además un rol de Postgres dedicado a esa organización (`worker_<organizacion_id sin guiones>`), registra su nombre en `servidores_organizacion.rol_db` y su contraseña en Vault. Las políticas RLS de las tablas de dominio (definidas por cada implementación futura, spec 012) resuelven la organización de ese rol mediante una función `private.organizacion_del_rol_actual()` que consulta una tabla de mapeo rol → organización (`servidores_organizacion`), no un claim JWT que el propio worker podría fijar.

**Rationale**: FR-007 pide explícitamente "credencial de su rol de base de datos acotado" (uno por organización, no compartido) — la alternativa de una única credencial de "worker" compartida por todas las organizaciones obligaría a confiar en un `organizacion_id` que el propio proceso declara, sin verificación del lado de la base. Un rol de Postgres por organización hace que la identidad de la organización sea quien conectó, no un dato que el worker afirma.

**Alternatives considered**:
- Un solo rol `workers` compartido + claim de organización en la conexión: descartado, es exactamente el "acceso irrestricto" que la spec pide evitar (US5 AC1: "credenciales de infraestructura acotadas, no acceso irrestricto").
- JWT de Supabase Auth por organización para el worker (como si fuera un usuario): más complejo que un rol de Postgres directo, y el worker no tiene ni necesita el resto de las capacidades de una sesión de Auth.

## R6. Tope de concurrencia del flow genérico

**Decision**: el flow genérico usa una tarea `EachParallel` (o `ForEach` con `concurrencyLimit`, según la sintaxis vigente en la versión de Kestra ya pinneada) con un límite tomado de una variable de entorno (`KESTRA_ORQUESTACION_CONCURRENCIA`, default documentado `10`), no de un valor fijo en el YAML del flow.

**Rationale**: la clarificación de `spec.md` (FR-004) pide un tope configurable, no ilimitado y no fijo — una variable de entorno permite ajustarlo por entorno (desarrollo/staging/producción) sin tocar el flow versionado, mismo patrón que las URLs de conexión de Kestra (`.env` por entorno, nunca en el YAML).

**Alternatives considered**: valor fijo en el YAML — descartado, obligaría a un cambio de código (y su propio PR) para ajustar algo operativo.

## R7. Reintentos ante falla técnica antes de alertar

**Decision**: la tarea SSH del flow lleva un bloque `retry` nativo de Kestra (`type: constant`, `maxAttempt: 3`, `interval: PT30S` como default documentado) antes de que el flow entre en su bloque `errors:` (que dispara la alerta, ver R8).

**Rationale**: cumple la clarificación de `spec.md` (FR-012, 3 reintentos con backoff) usando el mecanismo de reintento que Kestra ya provee nativamente por tarea, sin lógica propia de reintento en el worker ni en SQL.

**Alternatives considered**: reintentar desde dentro del propio worker (loop interno): descartado, duplicaría un mecanismo que Kestra ya resuelve a nivel de orquestación — es exactamente la responsabilidad que la spec 012 le asigna a Kestra ("programa, reintenta y alerta").

## R8. Mecanismo centralizado de alertas

**Decision**: un subflow de Kestra (`platform.alertas`, namespace igual al de la spec 011) invocado con `io.kestra.plugin.core.flow.Subflow` desde el bloque `errors:` de cada flow genérico/dedicado, con inputs `tipo` (`tecnica` | `credencial`), `organizacion_id`, `conexion_id` (opcional) y `motivo`. El subflow registra una fila en `alertas` (vía una función `SECURITY DEFINER`, `private.registrar_alerta`) y despacha la notificación al canal configurado (email o webhook, según Assumptions de `spec.md` — no fijado por esta spec).

**Rationale**: FR-011 pide explícitamente "un mecanismo centralizado, no lógica repetida dentro de cada flow individual" — un subflow reusado es la forma nativa de Kestra de lograr eso, mismo principio de reuso que ya motivó "un solo flow genérico en vez de un flow por organización" (FR-003).

**Alternatives considered**: una función de Postgres que se dispare por trigger ante cualquier fila de ejecución fallida: más difícil de mantener centralizado cuando la notificación en sí (email/webhook) vive naturalmente del lado de Kestra, no de la base.

## R9. Limpieza automática del estado "credencial inválida"

**Decision**: el propio flow, al completar sin error de credencial contra una conexión, llama a una función `SECURITY DEFINER` (`private.marcar_conexion_activa`) que actualiza `conexiones.estado` a `activa` si no lo estaba ya. No hace falta ninguna acción del administrador (clarificación de `spec.md`, FR-013).

**Rationale**: es la traducción directa de la clarificación a un punto de código concreto — el mismo flow que detecta la falla de credencial (y llama a `private.marcar_conexion_credencial_invalida`) es el que puede detectar la recuperación.

**Alternatives considered**: un job periódico aparte que reintente conexiones en estado inválido para ver si ya se arreglaron: más infraestructura (Principio V) que simplemente dejar que la próxima ejecución programada normal actualice el estado.

## R10. Unicidad de conexiones por organización y sistema externo

**Decision**: sin restricción de unicidad — `conexiones` no lleva un índice único sobre `(organizacion_id, sistema_externo)`. Una organización puede tener cualquier cantidad de conexiones al mismo sistema externo (clarificación de `spec.md`, FR-021).

**Rationale**: directa de la clarificación — modelarlo así desde el inicio evita una migración futura si aparece el caso real, sin costo hoy.

**Alternatives considered**: índice único con una bandera de "conexión principal": descartado por ahora, agrega complejidad sin un caso de uso concreto que la pida (Principio V) — se puede sumar después si hace falta distinguir cuál conexión usa un flow genérico por defecto.

## R11. Cómo se distribuye la imagen de un worker a los servidores de organización

**Decision**: GitHub Container Registry (`ghcr.io`), publicada por el mismo CI que ya corre en los runners self-hosted del repo (`infra/runner/`), con el `GITHUB_TOKEN` ya disponible en ese contexto — sin credencial nueva que gestionar. El comando SSH de despacho (R1) hace `docker pull` de la imagen antes de `docker run`, así que una actualización de versión no requiere ningún paso de despliegue activo hacia cada servidor de organización (FR-016): el próximo disparo de Kestra ya trae la imagen vigente.

**Rationale**: cero infraestructura nueva (Principio V) — el repo ya está en GitHub y el CI ya corre ahí; GHCR es gratuito para repos que ya usan Actions. Cumple FR-016 al pie de la letra.

**Alternatives considered**: un registro privado propio (Docker Registry autoalojado): infraestructura y mantenimiento adicional sin necesidad, cuando GHCR ya resuelve el caso sin costo.

## R12. Dónde vive la convención de testing con fixtures para la normalización de un conector

**Decision**: FR-017/FR-018 no generan código en esta spec — son una convención para specs de producto futuras. Se documentan como una subsección nueva de `workers/README.md` (spec 012), extendiendo el contrato de worker ya existente ("pruebas") sin duplicarlo: fixtures grabados (JSON) del dato crudo del sistema externo, usados para verificar la función de normalización (crudo → fila de tabla central) en CI, sin depender de acceso en vivo al sistema externo real; la automatización de navegador (Playwright) queda fuera de esa cobertura (FR-018), apoyada en el registro de estado por ejecución que ya exige el contrato de worker.

**Rationale**: mismo criterio que ya aplicó la spec 012 — una convención de testing reusable por cualquier worker futuro vive en `workers/README.md`, no en el código de esta spec (que no tiene ningún conector real que probar).

**Alternatives considered**: documentarlo solo en `spec.md`/`plan.md` de esta spec: descartado, quedaría enterrado en una spec de orquestación en vez de en el documento que alguien realmente lee al construir un worker nuevo (mismo argumento ya usado para no meter la separación de esquemas dentro de esta spec).

## R13. Dónde vive el procedimiento de aprovisionamiento y la nota de continuidad ante restauración de backup

**Decision**: una sección nueva en `docs/deployment.md` ("Servidores de organización"), junto a las secciones ya existentes de Desarrollo/Staging/Producción — documenta el procedimiento manual de alta de un servidor nuevo (FR-014) y la nota de que las credenciales cifradas no son recuperables tras restaurar un backup en un proyecto distinto, con reconexión y regeneración de credenciales como respuesta aceptada (FR-019).

**Rationale**: `docs/deployment.md` ya es el documento operativo vivo del repo para procedimientos de entorno/despliegue — es donde alguien operando la plataforma ya sabe buscar este tipo de procedimiento, en vez de un documento nuevo que nadie va a recordar que existe.

**Alternatives considered**: `quickstart.md` de esta spec: descartado como ubicación final — ese archivo valida esta spec puntual, no es el lugar donde alguien busca un procedimiento operativo meses después.
