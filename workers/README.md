# Workers

## Alta de un worker nuevo

Cada worker nuevo debe vivir en `workers/<nombre>/` y declarar un paquete
privado `@workers/<nombre>` con scripts `build`, `lint`, `test` y `start`.
El pipeline descubre automáticamente esas carpetas; no hay que editar una
lista central ni copiar un Dockerfile propio — `workers/Dockerfile` ya es la
plantilla parametrizada por `WORKER` que usa el workflow de publicación
(spec 017). El nombre solo puede usar minúsculas, números y guiones.

Antes de publicar, el worker debe tener:

- código compilable y tests deterministas sin credenciales reales;
- contrato de entrada/salida y códigos de error sanitizados (ver `CONTRATO.md`);
- allowlist de egress documentada para el proveedor que necesita;
- flow de Kestra o configuración de flow que apunte a su imagen por digest;
- idempotencia para reintentos de la misma ejecución.

La allowlist se declara en `workers/egress-allowlists.json`. La red de cada
worker sigue `worker-egress-<sistema>` y se aplica fuera de Docker mediante el
firewall/proxy del servidor: Docker no ofrece allowlist de dominios por sí solo.
El `worker.env` local del servidor debe fijar esa red y las variables de base;
el flow solo transmite los nombres de variables ya cargadas, no secretos.

Validación local del descubrimiento:

```powershell
pnpm workers:discover
pnpm test:workers:discover
```

`pnpm workers:discover` termina con error si todavía no hay ningún worker
real bajo `workers/` — es intencional (`scripts/descubrir-workers.mjs`
falla explícito en vez de devolver una lista vacía silenciosa): corrélo
recién después de agregar el primero. `pnpm test:workers:discover` sí corre
sin workers reales, porque prueba la función de descubrimiento contra sus
propios fixtures.

Cada worker futuro vive en su propia carpeta con Dockerfile, contrato de entrada,
salida idempotente, healthcheck y pruebas. No se crea un worker hasta identificar
una automatización concreta que Kestra necesite ejecutar.

## Convención de workers de integración

Cuando la automatización concreta es traer datos de un sistema externo, el worker
sigue la convención de abajo — para que una integración nueva no tenga que
rediseñar desde cero su estructura, su relación con Kestra ni su modelo de datos.

### Runtime

Node.js + TypeScript es el runtime por defecto — ya es el lenguaje del resto del
monorepo (`apps/web`), y comparte tooling (`pnpm lint`/`build`/`test`, el mismo
runner de CI). No es obligatorio: un worker puntual puede usar otro lenguaje si
su carga de trabajo lo justifica (por ejemplo, procesamiento de datos pesado).

### Un worker por sistema externo, un conector por tipo de dato

Un worker se dedica a un único sistema externo. Cuando ese sistema expone más de
un tipo de dato o reporte, cada uno se implementa como un conector propio dentro
del worker — aislado de los demás, sin conocerlos ni depender de ellos. Cada
conector elige su propio método de acceso: API, o automatización de navegador
con Playwright cuando no hay API disponible para ese reporte puntual. La
automatización de navegador reutiliza la infraestructura de Playwright ya
existente en el template (`infra/playwright`), sin requerir una imagen o
servicio nuevo.

### Kestra orquesta, el worker ejecuta

Kestra programa, reintenta y alerta. El worker ejecuta el trabajo técnico:
llamadas a APIs, automatización de navegador, descarga y procesamiento de
archivos, validación e importación. Uno no reemplaza al otro.

### Healthcheck de un worker de ejecución puntual

Un worker de este tipo no queda corriendo esperando requests — Kestra lo
dispara, corre, y termina. Para ese perfil, el healthcheck se cumple con el
código de salida/estado que Kestra ya registra por cada ejecución; no hace
falta un endpoint HTTP separado. Un worker que en cambio sea un servicio
persistente necesita un healthcheck tradicional — ese caso queda fuera de esta
convención.

Si el fallo es una credencial invalida, el worker DEBE escribir en stderr solo
el marcador `CREDENCIAL_INVALIDA:<conexion_id>` y terminar con error. Kestra
usa esa señal para marcar exclusivamente esa conexión como inválida y alertar
a su organización; cualquier otro error se trata como técnico. `conexion_id`
se recibe como variable de entorno de despacho, nunca contiene una credencial.

### Acceso efímero y salida sanitizada

Kestra solo entrega `ORGANIZACION_ID`, `SISTEMA_EXTERNO` y `CONEXION_ID`; nunca
entrega `CREDENCIAL`. Ya dentro de su proceso, el worker autenticado como el
rol `worker_<organizacion_id>` obtiene el valor estrictamente necesario con
`private.obtener_credencial_para_worker(CONEXION_ID)`, lo usa para la
autenticación externa y descarta la referencia al terminar el intento.

Antes de emitir stdout, stderr, métricas, traces o una excepción persistible,
el worker debe reemplazar el valor literal de la credencial y sus variantes
URL y Base64 comunes por `[REDACTADO]`. Para una credencial inválida no debe
imprimir la causa del proveedor: solo `CREDENCIAL_INVALIDA:<conexion_id>`; para
una falla técnica debe emitir una causa ya sanitizada.

### Ciclo de ejecuciones (spec 016): inicio

Cuando el producto adoptó el ciclo de ejecuciones del template, cada
disparo de Kestra ocurre dentro de una ejecución auditada
(`specs/016-ciclo-ejecuciones-workers/contracts/ciclo-ejecuciones.md`):

- Un disparo manual crea por RPC la ejecución y su orden durable en una sola
  transacción. Kestra reclama esa orden por JDBC antes de despachar el
  contenedor; el worker no inicia la ejecución por sí mismo. Si la capacidad
  ya tiene una ejecución activa para esa organización, el inicio falla con
  `YA_EN_CURSO` y no se crea orden: el worker nunca corre duplicado por este
  motivo.
- El contenedor recibe, además de las variables ya documentadas,
  `CAPACIDAD` (la clave registrada y habilitada para esa conexión) y
  `EJECUCION_ID` (el intento auditable al que pertenece este trabajo). El
  worker propaga `EJECUCION_ID` a sus logs y a las rutas de evidencia que
  suba, para que el cierre pueda atarlos al intento correcto.
- `CAPACIDAD` nunca es un valor arbitrario del cliente: es una de las claves
  registradas en `capacidades_ejecucion` para esa conexión. Un worker que
  necesite exponer una capacidad nueva la registra primero (el inicio
  rechaza cualquier otra con `CAPACIDAD_NO_HABILITADA`).
- El contrato de la orden es genérico: no contiene proveedor, URL, credencial
  ni comando. La capacidad y el detalle se resuelven al reclamar; el flow
  conserva el fencing por `despacho_id` e `intento` hasta resolver la orden.

El cierre y la evidencia se documentan en la subsección siguiente.

### Ciclo de ejecuciones (spec 016): cierre y evidencia

Al terminar el trabajo técnico, el worker cierra su ejecución por JDBC con
el rol `worker_<organizacion_id>` (solo su propia organización, FR-008):

```sql
select cerrar_ejecucion_worker(EJECUCION_ID, ESTADO, MOTIVO, DETALLE, ARCHIVO, EVIDENCIA);
-- ESTADO: solo 'exitosa' o 'fallida'. MOTIVO: causa ya sanitizada
-- (ver sección siguiente). DETALLE: jsonb extensible, sin secretos.
-- ARCHIVO/EVIDENCIA: rutas del bucket, solo si exitosa.
```

- **Evidencia primero, cierre después**: el worker sube el archivo original
  y la evidencia a `evidencias-ejecuciones/<ORGANIZACION_ID>/<CAPACIDAD>/
  <EJECUCION_ID>/...` y recién entonces cierra pasando esas rutas. Si la
  subida falla después de que el trabajo terminó, cierra como `fallida` sin
  rutas — el último éxito previo de esa capacidad sigue intacto y
  descargable (FR-006).
- **Cierre único**: un segundo cierre de la misma ejecución falla con
  `YA_CERRADA` sin modificar nada; el worker no necesita lógica propia de
  "terminar dos veces".
- **Motivo sanitizado en origen**: antes de cerrar, el worker aplica la
  misma redacción documentada en "Acceso efímero y salida sanitizada". La
  función además rechaza por forma (`SECRETO_DETECTADO`) cualquier motivo o
  detalle con pinta de credencial, sesión o token — defensa en profundidad,
  no sustituto de sanitizar en origen.

### Tabla central: normalizar datos de varias fuentes sin una tabla por sistema

Cuando un worker importa un tipo de registro de negocio que también puede
llegar por otros sistemas externos (otros workers, u otros conectores del
mismo worker), ese tipo de registro se normaliza en una **tabla central** en
vez de crear una tabla por sistema. Cada worker puede tener varias tablas
centrales — una por cada tipo de registro distinto que produzca — y un mismo
conector puede escribir en más de una si el dato que trae mezcla más de un
concepto de negocio.

La tabla central sigue la misma estructura conceptual sin importar el dominio:

- Una columna que identifica la **organización** dueña del registro — como
  cualquier tabla expuesta del template, no es una excepción al aislamiento
  multi-tenant: requiere RLS igual que si las filas las escribiera un usuario
  desde la UI en vez de un worker. La organización de cada registro es la
  dueña de la conexión/credencial que el worker usó en esa ejecución; el
  worker la propaga a cada fila que escribe, no es algo que el conector deba
  inferir de los datos en sí.
- Una columna `origen` que identifica de qué conector/sistema vino el
  registro.
- Una columna `id_externo` con el identificador que el sistema de origen le
  asignó.
- Una columna `jsonb` (por ejemplo `datos_originales`) para los campos
  particulares de cada fuente que no comparten las demás — evita forzar todo
  a una estructura común.

La clave de idempotencia es la combinación **`(organización, origen,
id_externo)`** — los tres campos juntos, nunca `id_externo` solo ni
`origen` + `id_externo` sin la organización: dos organizaciones distintas
pueden conectar cada una su propia cuenta del mismo sistema externo, y cada
una asigna sus propios `id_externo` — pueden coincidir en número sin ser el
mismo dato. Reimportar un período ya procesado no debe generar filas
duplicadas para la misma combinación.

Esto es una convención de diseño, no una estructura de columnas que el
template provea directamente: los nombres de columnas de dominio, los tipos
de datos específicos y la estructura SQL real son responsabilidad de cada
implementación que adapte el patrón a su propio dominio de negocio.

La tabla central vive en su propio esquema de base de datos (`dominio`),
separado del esquema de plataforma (`public`) donde vive el resto del
template — organizaciones, perfiles, membresías, feature flags, backups,
etc. Cada implementación crea sus tablas de dominio ahí, no en `public`;
el template solo habilita el esquema vacío, sin tablas, hasta que una
implementación cree la primera.

La lectura de esas filas importadas queda disponible para cualquier miembro de
la organización, mediante las políticas RLS de la tabla de dominio. No exige
el rol de administrador que sí se necesita para gestionar la conexión que
trajo los datos: `conexiones` y sus credenciales son recursos operativos,
mientras que los datos ya normalizados forman parte del dominio compartido de
la organización.

### Testing de la normalización

Cada conector conserva fixtures JSON del dato crudo que recibe del sistema
externo y los usa en CI para probar la normalización hacia sus tablas
centrales. Las pruebas deben cubrir transformaciones e idempotencia sin
requerir acceso en vivo al sistema externo ni credenciales reales.

La automatización de navegador no busca una cobertura automatizada realista
contra el sistema externo real. Su resultado se controla por el estado y el
código de salida que Kestra registra en cada ejecución; los fixtures cubren la
lógica determinista que sí puede verificarse de manera repetible.

### Fuera de alcance

Esta convención no resuelve procesamiento en tiempo real disparado por eventos
de usuario (colas como Redis/BullMQ) ni un backend HTTP síncrono que sirva a
un frontend. Si una implementación puntual necesita alguna de las dos cosas,
es una decisión propia de esa implementación — no algo que esta convención
cubra ni que deba forzarse dentro de un worker de integración.

### Origen de esta convención

Esta convención no se diseñó de antemano: surge de que al menos dos
automatizaciones de dominios de negocio independientes llegaron al mismo
patrón (runtime, división worker/conector, relación con Kestra, tabla
central) sin coordinación entre sí. Por eso se documenta acá, a nivel de
template, en vez de quedar dentro de una implementación puntual.

### Credenciales de un conector

Un conector necesita credenciales para acceder a su sistema externo (API
keys, una sesión de navegador logueada, u otro secreto equivalente). Esas
credenciales siguen el manejo de secretos ya establecido para el proyecto:
nunca en Git, solo en gestores de variables o vault por entorno (ver
`.env.example` en la raíz y en cada `infra/<producto>/`). Esta convención no
define un mecanismo de almacenamiento nuevo ni específico para conectores.
