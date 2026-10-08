# Feature Specification: Runners locales que no saturan la red ni la memoria

**Feature Branch**: `nicolasjones/optimizar-runners-locales`

**Created**: 2026-09-25

**Status**: Draft

**Delivery scope**: workers (infraestructura de CI de plataforma: `infra/runner/`). No toca `refine`, `supabase`, `kestra` ni `superset`, ni contiene lógica de negocio.

**Input**: User description: "Optimizar los runners self-hosted locales
(`infra/runner/`) para que varios agentes y varias corridas de CI en paralelo
no saturen la red ni la memoria de la máquina: store de pnpm compartido entre
réplicas (y reutilizable por los runners de productos derivados en la misma
máquina) con acceso concurrente verificado, cantidad de réplicas configurable,
tope de memoria por contenedor y menos conexiones simultáneas de descarga si
tiene sentido; sin cachés remotas de GitHub Actions. Publicarlo como capacidad
versionada con pasos de adopción para `estudio-contable-automation`."

**Origen**: incidente observado el 2026-09-25 en la máquina de desarrollo. Cada
corrida del workflow Validate ocupa tres runners (application, infrastructure,
database) y cada uno instala dependencias desde el registro público. Con dos o
tres PRs abiertos a la vez hubo entre seis y ocho descargas simultáneas por la
misma conexión Wi-Fi: el establecimiento de TLS con el registro tardaba unos
4 s y la instalación falló con `ECONNRESET`. Los CI quedaron en rojo por la
red, no por el código. Además, el store de dependencias vive dentro de cada
contenedor (uno por réplica y por repositorio), así que la misma dependencia se
descarga una vez por réplica. La memoria de la máquina quedó al límite con
cuatro agentes, dos stacks de Supabase, dos de Kestra, los stacks del CI
aislado y tres réplicas de runner por repositorio.

## Clarifications

### Session 2026-09-25

Las respuestas las decidió el agente que implementa (el operador delegó el
clarify); cada una lleva su fundamento.

- Q: ¿El store se comparte con los runners de otros productos por defecto o
  solo si el operador lo pide? → A: Por defecto, con un nombre de volumen fijo
  e igual en todos los productos; una variable permite aislarlo. Fundamento:
  el objetivo es una descarga por máquina; los repositorios son del mismo
  operador y cada runner ya monta el socket de Docker del host (equivale a
  root en la máquina), así que compartir el store no agrega confianza nueva, y
  el gestor verifica la integridad de cada archivo al importarlo.
- Q: ¿Qué tope de memoria por contenedor runner se usa por defecto? → A: El
  pico medido de un runner durante el CI completo con un margen de ~50 %,
  redondeado a GiB (valor y medición en `research.md`). Fundamento: un tope
  menor que el pico real rompe el CI por memoria (SC-005); uno arbitrario no
  protege; el margen absorbe el crecimiento del repositorio.
- Q: ¿Cuántas conexiones de descarga simultáneas usa cada instalación? → A:
  16 por instalación (ajustable), con 5 reintentos ante cortes. Fundamento:
  el predeterminado del gestor en esta máquina es 64 por instalación; con tres
  réplicas por repositorio y dos repositorios son hasta ~380 conexiones sobre
  el mismo Wi-Fi. 16 es el valor que el gestor usaba históricamente y, con el
  store compartido, solo pesa en instalaciones en frío.
- Q: ¿Qué pasa con `RUNNER_REPLICAS=0` o un valor no numérico? → A: 0 es un
  valor válido y explícito para no levantar runners de ese repositorio
  (documentado); un valor no numérico hace fallar el arranque de forma
  visible. Fundamento: 0 es la forma natural de liberar la máquina sin borrar
  la configuración; un texto nunca es intencional.
- Q: ¿Cómo se demuestra que la segunda corrida no descarga? → A: Con el
  resumen de progreso que el gestor imprime en cada instalación (`reused` vs
  `downloaded`) y la duración del paso, en dos corridas del CI del PR con el
  mismo lockfile, más el tamaño del store antes y después. Fundamento: es
  evidencia del propio CI, reproducible y sin instrumentación extra.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Una dependencia se descarga una sola vez por máquina (Priority: P1)

Como operador que mantiene varios PRs abiertos a la vez, quiero que todas las
réplicas del runner (y, opcionalmente, los runners de otros productos en la
misma máquina) reutilicen un único store de dependencias persistente, para que
una dependencia ya descargada no vuelva a bajarse del registro y los CI no
fallen por saturar la red.

**Why this priority**: es la causa directa de los CI caídos por red. Sin esto,
cada réplica descarga el árbol completo de dependencias.

**Independent Test**: recrear los runners con el store compartido, correr el
CI de un PR dos veces y comparar el log de instalación de ambas corridas: en
la segunda, los paquetes figuran como reutilizados y no como descargados, y la
instalación tarda menos.

**Acceptance Scenarios**:

1. **Given** un store compartido ya poblado por una corrida anterior,
   **When** cualquier réplica ejecuta la instalación con el mismo lockfile,
   **Then** el log muestra cero paquetes descargados (todo reutilizado).
2. **Given** varias réplicas instalando en paralelo contra el mismo store,
   **When** terminan, **Then** ninguna falla por el acceso concurrente y el
   store queda íntegro.
3. **Given** que los runners se recrean (`down`/`up` o reconstrucción de la
   imagen), **When** vuelve a correr el CI, **Then** el store sobrevive y se
   reutiliza.

---

### User Story 2 - Ajustar cuántas réplicas corren según la máquina (Priority: P2)

Como operador, quiero fijar la cantidad de réplicas del runner con una variable
de entorno, manteniendo tres por defecto, para bajarla cuando hay varios
agentes activos o poca memoria o red, sin editar archivos versionados.

**Why this priority**: es la palanca más directa sobre memoria y red, pero el
store compartido ya resuelve la mayor parte del problema de descargas.

**Independent Test**: levantar el runner con la variable en 1 y comprobar que
queda un único contenedor registrado; sin la variable, quedan tres.

**Acceptance Scenarios**:

1. **Given** la variable sin definir, **When** se levanta el runner, **Then**
   quedan tres réplicas, igual que hoy.
2. **Given** la variable en un número N, **When** se levanta el runner,
   **Then** quedan exactamente N réplicas registradas en GitHub.
3. **Given** la documentación, **When** el operador duda si bajar la cantidad,
   **Then** encuentra criterios concretos (agentes activos, memoria libre, red)
   y el efecto en los jobs en cola.

---

### User Story 3 - Contener el consumo de red y memoria de cada runner (Priority: P3)

Como operador, quiero que cada contenedor runner tenga un tope de memoria
configurable y que la instalación de dependencias abra menos conexiones
simultáneas y reintente ante cortes transitorios, para que un job pesado no
deje sin memoria al resto de la máquina y la red compartida no se sature.

**Why this priority**: mitiga el problema restante una vez que las descargas
son únicas; la instalación en frío (store vacío o lockfile nuevo) sigue
descargando.

**Independent Test**: inspeccionar un contenedor runner recreado y comprobar
su tope de memoria efectivo y la configuración de concurrencia y reintentos
de descarga que ven los jobs; correr el CI completo sin fallas por el tope.

**Acceptance Scenarios**:

1. **Given** el runner recreado, **When** se inspecciona un contenedor,
   **Then** tiene el tope de memoria por defecto documentado, o el valor de la
   variable si se definió.
2. **Given** un job de instalación, **When** corre, **Then** usa la
   concurrencia de descarga reducida y los reintentos definidos por el runner,
   sin cambios en el workflow del repositorio.
3. **Given** el CI completo del PR, **When** corre con los topes, **Then**
   ningún job falla por memoria.

---

### User Story 4 - Adoptar la mejora en un producto derivado (Priority: P3)

Como operador de `estudio-contable-automation`, quiero que la mejora se
publique como capacidad versionada del template con pasos de adopción, para
aplicarla a los runners del producto cuando no haya jobs en curso.

**Why this priority**: el beneficio completo (una descarga por máquina)
requiere que ambos repositorios usen el mismo store.

**Independent Test**: el catálogo de capacidades lista la nueva capacidad con
sus rutas, el chequeo de versiones pasa y la guía de adopción describe los
pasos, la verificación previa de runners ocupados y la reversión.

**Acceptance Scenarios**:

1. **Given** el catálogo del template, **When** el producto corre su
   verificación de adopción, **Then** la capacidad aparece como pendiente.
2. **Given** la guía de adopción, **When** el operador la sigue, **Then** sabe
   qué cambia en el producto, cómo verificar que no haya jobs en curso antes
   de recrear los runners y cómo volver atrás.

### Edge Cases

- Instalación con el store vacío o con un lockfile que agrega dependencias:
  descarga solo lo faltante, con la concurrencia reducida.
- Dos instalaciones en paralelo que escriben el mismo archivo del store.
- Limpieza del store (`prune`) mientras otro job instala: no se ejecuta de
  forma automática; la documentación indica hacerla con los runners sin jobs.
- El store crece sin límite con el tiempo: la documentación indica cómo medir
  su tamaño y limpiarlo con los runners detenidos.
- El store compartido y el directorio de trabajo del job quedan en sistemas de
  archivos distintos: la instalación funciona igual (copia en vez de enlace).
- Un job supera el tope de memoria: se corta ese job con un error visible, el
  contenedor runner se reinicia y vuelve a registrarse.
- Recrear los runners mientras hay un job en curso lo corta: antes de
  recrearlos se verifica que ninguno esté ocupado.
- La variable de réplicas en 0 no levanta runners de ese repositorio (uso
  explícito y documentado); con un valor no numérico el arranque falla de
  forma visible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todas las réplicas del runner del repositorio MUST usar un único
  store de dependencias persistente, que sobreviva a la recreación de los
  contenedores y a la reconstrucción de la imagen.
- **FR-002**: El store MUST compartirse por defecto con los runners de
  productos derivados de la misma máquina que adopten la capacidad (mismo
  nombre de volumen), y MUST poder aislarse por repositorio con una variable
  de entorno, sin editar archivos versionados.
- **FR-003**: El acceso concurrente de varias instalaciones al mismo store MUST
  estar verificado contra el comportamiento real del gestor de paquetes en la
  versión usada, y documentado con sus límites (qué operaciones no son seguras
  en paralelo).
- **FR-004**: La solución MUST NOT usar cachés remotas de GitHub Actions ni
  ningún almacenamiento de dependencias fuera de la máquina.
- **FR-005**: La cantidad de réplicas MUST configurarse por la variable
  `RUNNER_REPLICAS`, con tres por defecto.
- **FR-006**: Cada contenedor runner MUST tener un tope de memoria configurable
  por variable de entorno, con un valor por defecto medido sobre el consumo
  real del CI (pico con ~50 % de margen, redondeado a GiB) y documentado.
- **FR-007**: Las instalaciones de dependencias que corran en el runner MUST
  usar 16 descargas simultáneas por defecto (en lugar de las 64 que el gestor
  usa en esta máquina) y 5 reintentos ante cortes transitorios, configurados
  en el runner (no en el workflow ni en la configuración del repositorio), con
  la concurrencia ajustable por variable, y un tiempo máximo por descarga que
  permita completar los paquetes grandes en una red lenta (ver `research.md`
  R4b).
- **FR-012**: La información de verificación del lockfile y la metadata del
  registro que el gestor cachea MUST compartirse junto con el store, para que
  una instalación con el store completo no vuelva a consultar el registro.
- **FR-008**: Las nuevas variables MUST figurar en `.env.example` con su valor
  por defecto y sin secretos.
- **FR-009**: La configuración de infraestructura MUST seguir validando con
  `pnpm infra:config`.
- **FR-010**: La mejora MUST publicarse en `template-capabilities.json` según el
  mecanismo de capacidades versionadas, con una guía de adopción para
  productos derivados que incluya la verificación de runners ocupados antes de
  recrearlos y la reversión.
- **FR-011**: La documentación MUST explicar cuándo bajar la cantidad de
  réplicas y los topes, cómo medir y limpiar el store y por qué el acceso
  concurrente es seguro.

### Key Entities

- **Store compartido de dependencias**: almacenamiento persistente con nombre
  en la máquina, direccionado por contenido, compartido por las réplicas de
  uno o más repositorios.
- **Réplica de runner**: contenedor registrado en GitHub que ejecuta un job a
  la vez; su cantidad y su tope de memoria son configurables.
- **Capacidad versionada**: entrada del catálogo del template que los productos
  derivados adoptan de forma explícita.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En la segunda corrida del CI del PR con el mismo lockfile, cada
  instalación reporta 0 paquetes descargados del registro.
- **SC-002**: El tiempo de instalación de dependencias de la segunda corrida es
  menor que el de la primera corrida en frío.
- **SC-003**: Con el store compartido, la cantidad de descargas del mismo
  paquete por máquina pasa de una por réplica (3 por repositorio) a una.
- **SC-004**: El operador cambia la cantidad de réplicas o el tope de memoria
  sin editar archivos versionados.
- **SC-005**: El CI completo del PR pasa con los topes por defecto.

## Assumptions

- El runner corre en Docker sobre un único host (Docker Desktop o Linux
  nativo); el store es un volumen local de ese host, no un sistema de archivos
  de red ni una carpeta de Windows montada.
- Los repositorios que comparten el store son del mismo operador y ya
  comparten el socket de Docker del host, así que compartir el store no amplía
  la superficie de confianza.
- Los contenedores que lanzan los jobs (por ejemplo, el stack de Supabase del
  CI) corren fuera del contenedor runner y no cuentan para su tope de memoria.
- La descarga de otras herramientas en los jobs (por ejemplo, la CLI de
  Supabase) queda fuera de alcance.
