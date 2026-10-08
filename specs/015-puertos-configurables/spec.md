# Feature Specification: Puertos de Desarrollo Local Configurables

**Feature Branch**: `015-puertos-configurables`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "Centralizar los puertos de desarrollo local del template (Refine, Supabase API/DB/Studio/Mailpit, Kestra, Superset, Playwright, webhook de alertas) en una única fuente de verdad por variables de entorno, en vez de tenerlos hardcodeados de forma repetida en infra/*/compose.yaml, apps/web/vite.config.ts, infra/superset/superset_config.py, infra/refine/Dockerfile y los .env.example. Motivo concreto: al crear el primer producto derivado (fork del template para un estudio contable) hubo que editar a mano puertos repetidos en más de 10 archivos para poder correr el template y el producto derivado en paralelo en la misma máquina sin choque de puertos, y en la primera pasada se pasaron por alto 3 referencias (Dockerfile EXPOSE, CORS de Superset, redirect URLs de Supabase Auth) que solo aparecieron en un segundo barrido con grep — un riesgo real de que un fork manual quede con Auth o CORS rotos silenciosamente. Excepción conocida a documentar: supabase/config.toml no soporta la función env() en campos de tipo entero (puertos), es una limitación confirmada del CLI de Supabase (ver issue supabase/cli#1551), así que ese archivo queda como la única fuente de puertos que se edita literalmente y debe quedar señalada con un comentario explícito, no oculta."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Correr el template y un producto derivado en paralelo (Priority: P1)

Quien mantiene el template necesita crear un producto derivado (fork) y levantar su stack de desarrollo local al mismo tiempo que el stack del template, en la misma máquina, sin que los contenedores de uno choquen por puerto ocupado con los del otro.

**Why this priority**: Es el caso que expuso el problema — sin esto, cada fork nuevo repite una edición manual de más de diez archivos, propensa a dejar algo a medio cambiar.

**Independent Test**: Se puede probar copiando el template a un segundo directorio, cambiando solo las variables de puerto documentadas (más el archivo de excepción) y ejecutando `pnpm infra:config` y `pnpm dev:supabase` en ambos directorios a la vez sin error de puerto ocupado.

**Acceptance Scenarios**:

1. **Given** el template recién clonado sin ningún archivo `.env` creado, **When** se ejecuta cualquier `pnpm dev:<producto>`, **Then** cada servicio arranca en exactamente el mismo puerto que usa hoy (sin regresión).
2. **Given** dos copias del repositorio (template y un fork) con valores de puerto distintos en sus respectivos `.env`, **When** se levantan ambos stacks completos a la vez, **Then** ningún contenedor falla por conflicto de puerto y cada stack es alcanzable en el puerto que su `.env` declara.

---

### User Story 2 - Cambiar el puerto de un servicio sin perseguir referencias sueltas (Priority: P2)

Quien mantiene el template (o un producto derivado) necesita cambiar el puerto de un servicio (por ejemplo, porque colisiona con otra herramienta ya corriendo en su máquina) editando un único lugar, sin tener que revisar archivo por archivo si quedó una referencia vieja.

**Why this priority**: Es la causa raíz del riesgo detectado — hoy cambiar un puerto exige encontrar cada lugar donde está repetido a mano, y es fácil que alguno quede desalineado (pasó con el CORS de Superset y los redirects de Auth en el primer fork real).

**Independent Test**: Se puede probar cambiando el valor de una variable de puerto en `.env` y confirmando, con una búsqueda de texto en el repositorio, que ningún otro archivo (fuera de la excepción documentada) sigue teniendo el valor anterior como literal.

**Acceptance Scenarios**:

1. **Given** una variable de puerto definida en `.env`, **When** se le cambia el valor y se reconstruye el stack correspondiente, **Then** el servicio, su mapeo de Docker Compose y cualquier configuración de CORS/redirect que dependa de ese puerto quedan consistentes entre sí sin editar ningún otro archivo.
2. **Given** el archivo de excepción (`supabase/config.toml`), **When** alguien lo abre, **Then** encuentra un comentario explícito que indica que sus puertos y URLs de redirect de Auth se editan a mano ahí, por qué, y qué otros valores del `.env` deben coincidir con ellos.

---

### User Story 3 - Detectar puertos hardcodeados que se hayan vuelto a colar (Priority: P3)

Quien revisa un cambio futuro en el template necesita poder confirmar que ningún puerto nuevo se agregó como literal fuera del mecanismo centralizado, sin depender de acordarse de memoria de la lista completa de archivos afectados.

**Why this priority**: Es la protección a largo plazo del problema — sin esto, el defecto original (puertos repetidos a mano) puede volver a aparecer la próxima vez que se agregue un servicio nuevo al stack.

**Independent Test**: Se puede probar documentando la lista de variables de puerto vigentes y verificando por búsqueda de texto que sus valores numéricos no aparecen hardcodeados fuera de sus propias variables y del archivo de excepción.

**Acceptance Scenarios**:

1. **Given** la documentación de las variables de puerto vigentes, **When** se busca en el repositorio cada valor numérico de puerto fuera de su variable, **Then** las únicas apariciones literales restantes están dentro del archivo de excepción documentado.

---

### Edge Cases

- ¿Qué pasa si alguien no copia `.env.example` a `.env`? El stack debe arrancar igual, con los mismos valores por defecto que usa el template hoy (sin exigir configuración previa para el caso de un solo stack corriendo).
- ¿Qué pasa si dos productos derivados distintos (no el template y un fork, sino dos forks entre sí) eligen por accidente el mismo valor de puerto en sus `.env`? El mecanismo no puede prevenir esa colisión automáticamente entre repositorios independientes; alcanza con dejar documentada una convención de rangos sugerida para minimizarla.
- ¿Qué pasa con el puerto interno de un contenedor (el lado derecho del mapeo, p. ej. `8080` en Kestra) cuando cambia el puerto externo? El puerto interno no necesita variar — solo el mapeo hacia el host debe ser configurable.
- ¿Qué pasa si el CLI de Supabase agrega en el futuro soporte de `env()` para campos enteros? Queda fuera de este alcance; el comentario de excepción en `supabase/config.toml` deja constancia del motivo para que se pueda revisar más adelante.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST definir el puerto de cada servicio de desarrollo local (Refine, API de Supabase, base de datos de Supabase, base sombra de Supabase, pooler de Supabase, Studio de Supabase, servidor de pruebas de correo de Supabase, inspector de Edge Functions, analítica de Supabase, Kestra, Superset, Playwright, webhook local de alertas de orquestación) como una variable de entorno independiente, cada una con un valor por defecto igual al puerto que usa el template hoy.
- **FR-002**: Cada `infra/*/compose.yaml` (y su variante `.vps.yaml` cuando exista un puerto expuesto en desarrollo local) MUST tomar el mapeo de puerto hacia el host desde la variable de entorno correspondiente en vez de tener el número fijo escrito en el archivo.
- **FR-003**: `apps/web/vite.config.ts` MUST tomar el puerto del servidor de desarrollo y de previsualización desde variable de entorno.
- **FR-004**: `infra/superset/superset_config.py` MUST tomar los orígenes permitidos de CORS desde variable de entorno, sin dejar ningún origen local como literal fijo además del que ya toma de `REFINE_ORIGIN`.
- **FR-005**: `infra/refine/Dockerfile` MUST declarar el puerto expuesto de forma consistente con la variable usada por el resto del stack para ese mismo servicio (sin quedar como un literal independiente que pueda desalinearse).
- **FR-006**: `supabase/config.toml` MUST llevar un comentario explícito, junto a cada puerto y cada URL de redirect de Auth, que indique que ese valor se edita a mano por limitación del CLI de Supabase (campos enteros no soportan `env()`), y qué variable de entorno del resto del stack debe mantenerse alineada con él.
- **FR-007**: `.env.example` (raíz) y `apps/web/.env.example` MUST listar cada variable de puerto nueva con su valor por defecto y una descripción breve de a qué servicio corresponde.
- **FR-008**: Un producto derivado del template MUST poder correr su stack de desarrollo local en paralelo con el stack del template en la misma máquina cambiando únicamente las variables de puerto de su `.env` y los valores del archivo de excepción — sin editar ningún otro archivo del repositorio.
- **FR-009**: El comportamiento del template MUST ser idéntico al actual (mismos puertos, mismo funcionamiento) para quien no define ningún override de las variables nuevas, de modo que esta funcionalidad no introduce una regresión para el uso existente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Crear un producto derivado nuevo y tenerlo corriendo en paralelo con el template, en la misma máquina, sin conflicto de puertos, requiere editar valores en un único lugar por servicio (su variable de entorno) más, cuando corresponda, el único archivo de excepción documentado — cero archivos adicionales.
- **SC-002**: Una búsqueda de texto de cada valor de puerto en todo el repositorio no encuentra ninguna aparición fuera de su variable de entorno y del archivo de excepción documentado.
- **SC-003**: Un checkout nuevo del template, sin ningún archivo `.env` creado, arranca con exactamente los mismos puertos que usa el template antes de esta funcionalidad — cero regresiones reportadas por uso existente.
- **SC-004**: Cambiar el puerto de un servicio para evitar una colisión (fuera del archivo de excepción) se resuelve editando una sola variable, verificable porque ningún otro archivo necesita tocarse para que el stack completo quede consistente.

## Assumptions

- El alcance es desarrollo local (Docker Compose y CLI de Supabase corriendo en la máquina de quien desarrolla); los despliegues a VPS de cada producto ya son aislados entre sí por diseño (cada producto derivado tiene su propio VPS) y no comparten máquina, así que no son el disparador de esta funcionalidad — se alinean por consistencia donde ya existe un mapeo de puerto local (caso de Playwright en `compose.vps.yaml`).
- Los valores por defecto de las variables nuevas son exactamente los puertos que usa el template hoy, para que ningún uso existente del template se vea afectado por esta funcionalidad.
- `supabase/config.toml` es la única excepción conocida a la centralización, por una limitación confirmada del CLI de Supabase (no soporta `env()` en campos de tipo entero). Si esa limitación se levanta en una versión futura del CLI, revisarla queda fuera de este alcance.
- No se requiere un mecanismo que detecte o prevenga automáticamente que dos productos derivados distintos (no relacionados entre sí) elijan el mismo valor de puerto en sus propios `.env` — alcanza con dejar una convención de rangos sugerida documentada.
- Esta funcionalidad es infraestructura de desarrollo local del propio template (mecanismo, no dominio de negocio) — no introduce ni depende de ningún concepto del primer producto derivado (estudio contable) que la motivó.
