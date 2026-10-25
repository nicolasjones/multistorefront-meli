# Feature Specification: Plataforma · Operación, copias y documentación

**Feature Branch**: `epic/MSF-457-plataforma-operacion-copias-y-documentac`

**Jira Epic**: MSF-457 — Plataforma · Operación, copias y documentación (spec `operacion-copias-y-documentacion`)

**Created**: 2026-10-18

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de «A revisar» (objetivo de recuperación, retención, proveedor de correo) son supuestos propuestos y **no bloquean**: quedan parametrizados (ver *Decisiones abiertas*).

**Delivery scope**: `supabase` (migración aditiva + pgTAP), `kestra` (flows versionados) y `docs/` (documentación). Sin `refine`, `superset` ni `workers`. Sin pantallas.

**Prioridad / Hito**: P0 · Hito 4 (30 de noviembre al 11 de diciembre de 2026) · ~12 h · alcance diciembre. Ante conflicto de horas manda el roadmap.

**Dependencias**:
- Bloqueada por: MSF-455 (Plataforma · Actividad y ambientes, F-OPS-02): los ambientes de prueba y producción (ya en `main`, `docs/ambientes-verificacion.md`).
- Bloquea a: ninguna épica.
- Relacionada, sin bloqueo: la documentación (F-OPS-05) cubre a todos los componentes y se cierra cuando estén sus funciones; no se vincula como bloqueo.

**Input**: Epic MSF-457. Objetivo: «Al terminar, hay copias diarias de la base y de las imágenes, se comprobó en un simulacro que se pueden restaurar y el equipo cuenta con la documentación para usar, operar y entregar el sistema.»

**Regla de fuentes** (literal de la épica):
- Comportamiento y datos: mandan los requisitos y escenarios de esta historia.
- Qué se ve: el prototipo validado es referencia visual; los flujos aclaran estados y acciones.
- Cómo se construye: mandan el template y el sistema de diseño (MSF-117). No copiar HTML ni CSS del prototipo.
- El prototipo muestra más que esta historia: implementar solo lo que piden los requisitos.
- Si algo no se puede igualar con el template / sistema de diseño: usar lo más cercano, sin inventar, y anotar la diferencia en el PR.
- Si prototipo y requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y anotar la contradicción en el PR.

## Matriz pantalla↔criterios

Esta épica **no tiene pantallas** (prototipo «San Javucho y Mundo JC · Plataforma»): F-OPS-01 se resuelve en la base y en Kestra, y F-OPS-05 en `docs/`. Ningún `.dc.html` aplica; no hay tablas, campos, botones, tabs ni diálogos que mapear. Fuera de alcance: cualquier UI de copias (el historial se consulta por SQL/Kestra).

## Estado de partida (template)

- Spec 011 (`specs/011-backups-postgres`): ya hay copia automática diaria de Postgres (`infra/kestra/flows/respaldo-postgres.yml`, tabla `public.respaldos`, rol `kestra_backups`, verificación estructural «PGDMP»).
- Constitución VIII y `pnpm docs:check`: la documentación por cambio ya es obligatoria.
- **Faltan**: retención definida, respaldo de imágenes, verificación periódica de restauración, procedimiento guiado y aviso por correo; y la documentación funcional/técnica de conjunto.

## Modelo y supuestos

- **Objetivo de recuperación (propuesto, a definir con el cliente)**: perder como máximo 24 horas de datos (RPO) y volver a operar en 4 horas (RTO).
- **Retención (propuesta)**: 30 copias diarias y 12 mensuales.
- Las copias de imágenes se guardan **fuera del proyecto de Supabase que las aloja** (fuera de sus volúmenes y de su Storage).
- **Decisión de Nicolás (2026-10-17): todo queda dentro del mismo servidor (VPS)**, eligiendo un destino que se pueda mover rápido a otro lado más adelante. Destino elegido: un **directorio dedicado del host** (idealmente un disco o punto de montaje propio), separado de los volúmenes de Supabase, accedido siempre a través de un **remoto `rclone` con nombre estable** (`respaldos`). Mover las copias fuera del servidor luego es **solo cambiar variables de entorno** del remoto (tipo `s3`, `b2`, `sftp`…), sin tocar los flows. No se agrega infraestructura nueva (Principio V).
- Supabase es **self-hosted** (Constitución, Technology and Quality Gates): nada de Supabase Cloud ni su Management API.
- El destino se configura por variables de entorno (sin secretos en Git; solo `.env.example`). Hoy es local al servidor; el contrato (remoto `rclone` + prefijos `base/` e `imagenes/`) es el mismo cuando pase a un destino remoto.

### Esquema de datos (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `respaldos` (existente, spec 011) | `public` | Plataforma/transversal (backups). No se altera. | Sí (solo superadmin lee) |
| `respaldos_imagenes` (nueva) | **`public`** | Historial de copias de Storage: backups, transversal; no es entidad de negocio. | **Sí**: `select` solo superadmin (`private.is_superadmin()`); sin policies de escritura; sin privilegios `anon`. Escritura solo por funciones ejecutables por `kestra_backups`. |
| `verificaciones_restauracion` (nueva) | **`public`** | Resultado de restaurar una copia en un entorno aislado: backups, transversal. | **Sí**, igual que la anterior. |

Ninguna tabla en `dominio`. Migración **aditiva** (tablas, funciones, grants); reversión en `plan.md`. Se re-verifica el esquema en spec, plan, tareas, implementación y PR.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Copias de seguridad y restauración (F-OPS-01, P0, talla M)

Como responsable de operar el sistema, quiero copias diarias de la base y de las imágenes, con retención definida, y la certeza periódica de que se pueden restaurar, para recuperar el servicio ante una pérdida sin perder más de un día de datos.

**Why this priority**: sin copias probadas no se puede operar con datos reales; es el objetivo de la épica.

**Independent Test**: tras varios días de corrida, el historial tiene una copia de base y una de imágenes por día, la purga respeta 30 diarias + 12 mensuales, la verificación restaura la última copia en un entorno aislado y registra resultado y duración, y un fallo forzado envía el correo al equipo de soporte.

**Acceptance Scenarios**:
1. **Given** el horario diario, **When** corre la copia de la base, **Then** el archivo verificado queda además en el destino de respaldos (directorio dedicado del mismo servidor, fuera de los volúmenes de Supabase) y el registro de `respaldos` queda `completado` con tamaño y ubicación (FR-001).
2. **Given** el horario diario, **When** corre la copia de imágenes, **Then** los objetos de Storage quedan en el destino de respaldos, distinto del proyecto Supabase que los aloja y `respaldos_imagenes` registra estado, cantidad, tamaño y ubicación (FR-002).
3. **Given** más de 30 copias diarias y 12 mensuales, **When** corre la purga, **Then** solo se conservan las 30 diarias más recientes y la primera copia de cada uno de los 12 últimos meses; nunca se borra la última copia válida (FR-003).
4. **Given** la verificación periódica, **When** corre, **Then** restaura la última copia de la base en un Postgres aislado, comprueba que la restauración termina y que las tablas esperadas tienen datos, y registra resultado y duración en `verificaciones_restauracion` sin tocar el entorno operativo (FR-004).
5. **Given** un fallo de copia de base, de imágenes o de verificación, **When** termina con error, **Then** se registra el motivo y se avisa por correo al equipo de soporte (FR-005).
6. **Given** una pérdida de datos, **When** el equipo sigue el procedimiento guiado, **Then** puede restaurar base e imágenes paso a paso, con los tiempos objetivo a la vista (FR-006, FR-007).
7. **Given** un usuario de una organización (cualquier rol) o `anon`, **When** consulta las tablas de copias, **Then** no ve nada; solo el superadmin lee (FR-008).

### User Story 2 - Documentación funcional y técnica (F-OPS-05, P0, talla S)

Como integrante del equipo, quiero documentación para usar, operar y entregar el sistema, para no depender de quien lo construyó.

**Why this priority**: sin documentación el sistema no se puede entregar ni operar.

**Independent Test**: una persona nueva encuentra, desde un índice en `docs/`, cómo usar cada función entregada, cómo operar el sistema y cómo entregarlo, sin preguntar a nadie.

**Acceptance Scenarios**:
1. **Given** la carpeta `docs/`, **When** se abre el índice, **Then** hay tres entradas claras: **usar** (funcional), **operar** y **entregar**, con enlaces a las guías existentes (FR-010).
2. **Given** cada funcionalidad entregada por las demás épicas, **When** se busca su documentación, **Then** el índice la enlaza o la deuda queda trazada (FR-010).

## Requirements *(mandatory)*

- **FR-001** (US1): La copia diaria de la base (spec 011) se mantiene y su archivo verificado se guarda también en el destino de respaldos: directorio dedicado del mismo servidor, fuera de los volúmenes de Supabase, accedido vía remoto `rclone` configurable para migrarlo luego sin cambiar los flows.
- **FR-002** (US1): Copia diaria de las imágenes de Storage al destino de respaldos (fuera del proyecto Supabase que las aloja, dentro del mismo servidor), con registro auditable (`public.respaldos_imagenes`).
- **FR-003** (US1): Retención de 30 copias diarias y 12 mensuales (valores configurables), con purga automática que nunca borra la última copia válida.
- **FR-004** (US1): Verificación periódica de restauración en un entorno aislado, con resultado y duración registrados (`public.verificaciones_restauracion`).
- **FR-005** (US1): Aviso por correo al equipo de soporte ante fallo de copia o de verificación; el proveedor de correo es configurable (SMTP por variables).
- **FR-006** (US1): Procedimiento guiado de restauración (base e imágenes) en `docs/`.
- **FR-007** (US1): Objetivo de recuperación (24 h de datos / 4 h para operar) documentado como propuesta a confirmar con el cliente.
- **FR-008** (US1): Tablas nuevas en `public` con RLS; solo el superadmin lee; escritura solo por funciones de `kestra_backups`; `anon` sin privilegios; migración aditiva con reversión; secretos solo en `.env.example`.
- **FR-010** (US2): Índice y guías en `docs/` para usar (funcional), operar y entregar el sistema.
- **FR-011** (cierre): Simulacro de restauración en staging con tiempo medido y resultado firmado por el propietario; revisión de que cada funcionalidad entregada tiene documentación; cierre de la spec (roadmap, tareas sin `[ ]`).

## Success Criteria *(mandatory)*

- **SC-001**: durante 7 días seguidos hay una copia de base y una de imágenes por día, registradas (FR-001, FR-002).
- **SC-002**: el simulacro de restauración en staging se mide y se completa dentro de 4 h, con pérdida ≤ 24 h, y el resultado queda firmado por el propietario (FR-011; verificación de la épica).
- **SC-003**: un fallo forzado de cada flow llega por correo al equipo de soporte (FR-005).
- **SC-004**: el 100 % de las funcionalidades entregadas tiene documentación enlazada (FR-010, FR-011).
- **SC-005**: pgTAP verde: aislamiento y RLS en toda tabla de `public`, sin ejecución por `anon` (FR-008).

## Decisiones abiertas (no bloquean)

1. Objetivo de recuperación y retención: propuestos arriba; se confirman con el cliente. Quedan como parámetros, no en código.
2. Proveedor de correo para los avisos: se usa SMTP genérico por variables; el proveedor concreto se elige después.
3. Destino de las copias: **resuelto por Nicolás** — dentro del mismo servidor, directorio dedicado vía `rclone`, portable a S3/B2/SFTP cambiando variables. **Riesgo asumido**: mientras todo viva en el mismo servidor, la pérdida total del servidor (disco, VPS) se lleva también las copias; el simulacro y la guía lo dejan explícito y el traslado a un destino remoto queda como seguimiento trazado (listo para activarse por configuración).
4. Horas: 12 h del documento (el plan de la fuente dice 7); manda el roadmap.

## Fuera de alcance

Copias fuera del servidor (hoy; queda como seguimiento, activable por variables); pantallas o UI de copias; restauración automática hacia producción; copias de Kestra, Superset o repositorio; Supabase Cloud; reemplazar el flow de la spec 011.
