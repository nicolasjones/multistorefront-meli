# Data Model: Orquestación de Workers Multi-Organización

Todas las tablas nuevas viven en el esquema `public` (plataforma) — son
mecanismo del template, no datos de dominio de un producto derivado (ver
`plan.md`, Structure Decision). Todas llevan `organizacion_id` y RLS
(Principio I), salvo donde se indica que es intencional que no lo lleven
(`alertas` técnicas sin organización puntual).

## Entidad: `servidores_organizacion`

Un servidor por organización (Assumptions de `spec.md`).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `organizacion_id` | `uuid` | FK a `organizaciones`, `unique` — un servidor por organización |
| `host` | `text` | dirección del servidor (no secreta) |
| `puerto_ssh` | `integer` | default `22` |
| `usuario_ssh` | `text` | usuario del acceso remoto (no secreto en sí) |
| `credencial_ssh_vault_id` | `uuid` | referencia a `vault.secrets` — clave privada o password SSH, nunca en texto plano en esta tabla |
| `rol_db` | `text` | nombre del rol de Postgres dedicado a esta organización (R5), único por fila |
| `credencial_db_vault_id` | `uuid` | referencia a `vault.secrets` — password de `rol_db` |
| `created_at` / `updated_at` | `timestamptz` | auditoría (Principio III) |

**RLS**: solo `private.is_superadmin()` puede insertar/actualizar (el
aprovisionamiento es una acción de plataforma, US5, no de una organización
individual gestionándose a sí misma). Lectura: superadmin, o administrador
de esa organización (para ver que su servidor existe y su estado — nunca
las columnas `*_vault_id`, que no tienen sentido fuera de las funciones de
R4).

## Entidad: `conexiones`

Vínculo entre una organización y un sistema externo (Key Entities de
`spec.md`).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `organizacion_id` | `uuid` | FK a `organizaciones` |
| `sistema_externo` | `text` | slug del sistema (sin marca/dominio de negocio en esta spec — lo define cada implementación puntual) |
| `estado` | `text` | `activa` \| `error` \| `credencial_invalida` (check constraint) |
| `credencial_vault_id` | `uuid` | referencia a `vault.secrets` — credencial de negocio cifrada |
| `created_at` / `updated_at` | `timestamptz` | auditoría |
| `created_by` | `uuid` | quién la creó (`auth.uid()`) |

**Sin índice único** sobre `(organizacion_id, sistema_externo)` — una
organización puede tener más de una conexión al mismo sistema externo
(R10, FR-021).

**Transiciones de estado** (FR-013, R9):
- `activa → credencial_invalida`: cuando una ejecución falla por
  autenticación/credencial contra esa conexión.
- `credencial_invalida → activa`: automático, en la próxima ejecución que
  complete sin error de credencial — sin acción del administrador.
- `activa → error`: falla técnica genérica (no de credencial); no bloquea
  que una ejecución posterior vuelva a `activa` del mismo modo.

Cómo se llega a esa "próxima ejecución" (bug `conexion-invalida-trabada`,
migración `20260925210000_destrabar_conexion_invalida.sql`; desde la
spec 016 ningún camino la producía):
- `error` no bloquea: `iniciar_ejecucion_worker` la acepta en cualquier
  origen y el flow genérico la recorre.
- `credencial_invalida` no se reintenta sola (el programado repetiría un
  login rechazado): el genérico la saltea y `iniciar_ejecucion_worker`
  la rechaza con `CONEXION_CREDENCIAL_INVALIDA` salvo en un disparo
  `manual` de un administrador autenticado. Actualizar la credencial
  (`actualizar_credencial_conexion`) la devuelve a `activa`, como una
  conexión recién creada, para que la próxima ejecución la pruebe. Cada
  camino es un único intento: el flow no reintenta una falla de credencial
  (`workers/CONTRATO.md`, "Códigos de salida y reintentos").

**RLS**: solo administradores de esa organización o superadmin pueden
`select`/`insert`/`update`/`delete` (FR-009) — nunca `credencial_vault_id`
en texto descifrado; el valor descifrado solo sale a través de
`private.obtener_credencial_conexion()` (R4), no de una lectura directa de
la tabla. La lectura de los **datos ya importados** por una conexión
(FR-010, abierta a cualquier miembro) vive en las tablas de dominio de
cada implementación futura (esquema `dominio`, spec del chore previo), no
en esta tabla — esta tabla es solo la configuración/estado de la conexión.

## Entidad: `excepciones_flow_generico`

Registra qué organización queda excluida del flow genérico de un conector
porque tiene un flow dedicado (FR-005).

| Columna | Tipo | Notas |
|---|---|---|
| `organizacion_id` | `uuid` | FK a `organizaciones` |
| `conector_id` | `text` | slug del conector/flow (definido por cada implementación) |
| `created_at` | `timestamptz` | auditoría |

PK compuesta `(organizacion_id, conector_id)`. La presencia de una fila
significa "excluida del flow genérico para este conector, la atiende un
flow dedicado".

**RLS**: solo superadmin (es una decisión de operación de plataforma, no
de la organización).

## Entidad: `alertas`

Registro auditable de cada alerta disparada (Principio III), independiente
del canal de notificación real (email/webhook, configurable — Assumptions
de `spec.md`).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK, `generated always as identity` |
| `tipo` | `text` | `tecnica` \| `credencial` (check constraint) |
| `organizacion_id` | `uuid` | nullable — una falla técnica puede no estar atada a una organización puntual (por ejemplo, el propio Kestra) |
| `conexion_id` | `uuid` | nullable, FK a `conexiones` — presente cuando `tipo = credencial` |
| `motivo` | `text` | mensaje/causa de la falla |
| `created_at` | `timestamptz` | auditoría |

**RLS**: superadmin ve todas; un administrador de organización ve solo las
de `tipo = credencial` de su propia organización (FR-012: la audiencia de
una falla técnica genérica es únicamente quien opera la plataforma).

## Roles de Postgres nuevos

- `kestra_orquestacion` (R2): `LOGIN`, sin privilegios generales, `EXECUTE`
  acotado a las funciones `SECURITY DEFINER` de esta spec. Análogo a
  `kestra_backups` (spec 011).
- Un rol por organización, `worker_<organizacion_id sin guiones>` (R5),
  creado al aprovisionar su servidor (`servidores_organizacion.rol_db`),
  con permiso de escritura únicamente sobre las tablas de dominio que RLS
  resuelva vía `private.organizacion_del_rol_actual()` — no sobre las
  tablas de esta spec (`servidores_organizacion`, `conexiones`, etc.).

## Funciones `SECURITY DEFINER` nuevas (resumen — contratos completos en `contracts/`)

| Función | Quién puede ejecutarla | Qué hace |
|---|---|---|
| `private.es_administrador_de(organizacion_id)` | `authenticated` | `true` si quien llama es administrador de esa organización o superadmin |
| `private.organizacion_del_rol_actual()` | cualquier rol `worker_*` | resuelve la organización dueña del rol de Postgres actual, vía `servidores_organizacion.rol_db` |
| `private.obtener_credencial_conexion(conexion_id)` | `authenticated`, `kestra_orquestacion` | descifra y devuelve la credencial de negocio, solo si quien llama tiene permiso (R4) |
| `private.obtener_credencial_servidor(organizacion_id)` | `authenticated`, `kestra_orquestacion` | ídem, credencial de infraestructura |
| `private.crear_conexion(organizacion_id, sistema_externo, credencial)` | `authenticated` (chequea `es_administrador_de` internamente) | guarda `credencial` en Vault (`vault.create_secret`) e inserta la fila en `conexiones` con `estado = 'activa'` — la app nunca inserta la fila directo con el valor plano |
| `private.actualizar_credencial_conexion(conexion_id, nueva_credencial)` | `authenticated` (chequea `es_administrador_de` internamente) | rota el secreto de Vault de una conexión existente (`vault.update_secret`), sin cambiar su `id` ni su `estado` |
| `private.marcar_conexion_activa(conexion_id)` | `kestra_orquestacion` | limpia el estado inválido/error tras una ejecución exitosa (R9) |
| `private.marcar_conexion_credencial_invalida(conexion_id, motivo)` | `kestra_orquestacion` | marca el estado y es el disparador de la alerta de tipo `credencial` |
| `private.registrar_alerta(tipo, organizacion_id, conexion_id, motivo)` | `kestra_orquestacion` | inserta en `alertas` (R8) |
| `private.aprovisionar_servidor_organizacion(organizacion_id, host, puerto, usuario, credencial_ssh)` | superadmin | crea el rol `worker_*`, genera su credencial, guarda todo en Vault, inserta la fila en `servidores_organizacion` (FR-014) |

## Relación con el esquema `dominio`

Ninguna tabla de esta spec vive en `dominio` — son todas de plataforma. El
esquema `dominio` (habilitado en un chore previo, sin tablas todavía) sigue
esperando la primera tabla de dominio real de un producto derivado; esta
spec no la crea.
