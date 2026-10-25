---
owner: producto
sources:
  - specs/011-backups-postgres
  - infra/kestra/flows
---

# Operación, copias y documentación (MSF-457)

**Épica:** MSF-457 · **Historias:** F-OPS-01 (copias de seguridad y restauración) y F-OPS-05
(documentación funcional y técnica).
**Spec:** `specs/20261018-120000-operacion-copias-y-documentacion/` (rama
`epic/MSF-457-plataforma-operacion-copias-y-documentac`; liberada a STG en el lote `release/stg-lote`,
pendiente de merge a `main` en este repositorio).

El sistema deja **copias diarias de la base y de las imágenes**, conserva un historial auditable, prueba
cada semana que la última copia de la base se puede restaurar, avisa por correo si algo falla y deja por
escrito cómo usar, operar y entregar el sistema. No hay pantalla: la operación se hace desde Kestra y SQL.

## Qué resuelve

- **No depender de la memoria.** Una copia completa de Postgres corre todos los días a las 03:00 y una de
  las imágenes de Storage a las 03:15, sin que nadie las dispare a mano. También se pueden ejecutar a demanda
  desde Kestra.
- **No llenar el disco.** La purga diaria conserva **30 copias diarias** y **la primera copia de cada uno de
  los 12 últimos meses**; nunca borra la última copia válida.
- **Saber que se puede volver.** Todos los lunes a las 05:00 se restaura la última copia de la base en un
  Postgres aislado y descartable, y se registra si terminó, cuánto tardó y cuántas filas tenían las tablas
  de control. Nunca toca el entorno operativo.
- **Enterarse de un fallo.** Si una copia, la purga o la verificación fallan, llega un correo al equipo de
  soporte con el flow, el motivo y el identificador de la ejecución de Kestra.
- **Poder entregar.** El equipo nuevo encuentra cómo **usar** el panel, cómo **operar** ambientes y copias y
  qué revisar antes de **entregar** el sistema, sin depender de quien lo construyó.

## Para quién

| Persona | Qué necesita saber |
|---|---|
| **Dueño/a del producto u operación** | Hay copia diaria de base e imágenes, retención definida y una prueba semanal de restauración. El objetivo propuesto es perder como máximo **24 h** de datos y volver a operar en **4 h** (a confirmar con el cliente). |
| **Soporte / guardia** | Ante un correo «[Copias] Falló …», seguir el procedimiento de [Copias y restauración](../tecnico/copias-y-restauracion.md#qué-hacer-ante-el-correo-de-fallo). |
| **Superadmin** | Es el único que puede leer los historiales de copias y verificaciones. Ningún rol de organización ni un visitante anónimo ve esos datos. |
| **Equipo que recibe el sistema** | Revisar la lista de entrega de esta página y la guía técnica antes de dar por cerrada la entrega. |

## Qué incluye esta entrega

| Capacidad | Qué hace |
|---|---|
| Copia de la base | `respaldo-postgres`: `pg_dump` completo, verificación estructural y archivo en el destino de respaldos. Registro en `public.respaldos`. |
| Copia de imágenes | `respaldo-imagenes`: copia todos los objetos de Storage a una «foto» con fecha. Registro en `public.respaldos_imagenes`. |
| Retención | `retencion-copias`: 30 diarias + 12 mensuales, configurable. Purga base e imágenes. |
| Verificación de restauración | `verificar-restauracion`: restaura la última copia de base en un Postgres efímero y aislado. Registro en `public.verificaciones_restauracion`. |
| Aviso de fallo | `aviso-fallo-copias`: correo SMTP al equipo de soporte desde los cuatro flows anteriores. |
| Procedimiento guiado | Restauración de base e imágenes, lectura del historial y respuesta a fallos en [Copias y restauración](../tecnico/copias-y-restauracion.md). |
| Documentación de uso, operación y entrega | Índice de esta página, [Operación](../tecnico/operacion.md) y la lista de entrega de abajo. |

## Límites y fuera de alcance

- **Las copias viven en el mismo servidor que la aplicación.** Es una decisión del propietario para esta
  etapa: un directorio dedicado fuera de los volúmenes de Supabase, accedido por un remoto `rclone`
  configurable. Si se pierde el servidor completo, se pierden también las copias. Pasarlas a S3/B2/SFTP es
  cambiar variables, no reescribir los flows; queda como seguimiento. El riesgo está asumido y documentado.
- **El simulacro completo en staging no se ejecutó** por falta de autorización para tocar staging. La
  verificación semanal automática prueba la restauración de la base en un entorno aislado, pero **no**
  reemplaza el simulacro de punta a punta ni mide el tiempo real de recuperación. Seguimiento **MSF-520**
  (dueño: propietario del producto).
- **Los objetivos de recuperación (24 h / 4 h) son una propuesta**, todavía no confirmada con el cliente.
- **No hay pantalla de copias** ni restauración automática hacia producción: el historial se consulta por
  SQL o desde Kestra, y restaurar es un procedimiento manual con aprobación.
- **No se copian Kestra, Superset ni el repositorio**; sólo Postgres y los objetos de Storage.
- **El proveedor de correo no está definido**: se usa SMTP genérico por variables. Mientras no se configure,
  el aviso de fallo puede perderse sin que nadie lo note; la puesta en marcha incluye probarlo a mano.
- El estado de las copias y la verificación es el de la rama de la épica. En `main`, por ahora, sólo está la
  copia diaria de Postgres de la [spec 011](../../specs/011-backups-postgres/spec.md).

## Usar, operar y entregar

| Quiero… | Empezá por |
|---|---|
| **Usar** el panel por rol y sección | [Qué es MSF](README.md) · [Capacidades](capacidades.md) · [Guía funcional](#guía-funcional-para-quien-usa-el-panel) |
| **Operar** ambientes, Kestra, Supabase y copias | [Operación](../tecnico/operacion.md) · [Copias y restauración](../tecnico/copias-y-restauracion.md) |
| **Entregar** el sistema a otro equipo o cliente | [Lista de entrega](#lista-de-entrega) |

### Guía funcional para quien usa el panel

Esta épica no agrega pantallas. Las funciones que se usan a diario están documentadas por módulo en
[Capacidades](capacidades.md) y en las guías de producto enlazadas desde ahí (acceso, organización,
catálogo, stock, ventas, consultas, service técnico, reportes). Lo que no figure en esas páginas no está
entregado.

### Lista de entrega

Marcar cada ítem con evidencia (comando, captura o enlace).

- [ ] Todo el trabajo está en git y mergeado a `main` con merge commit (`--no-ff`).
- [ ] `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test` y `pnpm docs:check` en verde.
- [ ] Cada variable nueva está en el `.env.example` correspondiente, sin valores reales ni secretos en Git.
- [ ] `dev`, `stg` y `prd` responden en sus URLs; migraciones y flows de Kestra aplicados por ambiente.
- [ ] Hay copia diaria de base e imágenes registrada durante al menos siete días seguidos.
- [ ] La verificación semanal de restauración está en `completado`.
- [ ] El simulacro de restauración en staging se ejecutó, se midió y quedó firmado por el propietario
      (hoy pendiente: MSF-520).
- [ ] El SMTP y `SOPORTE_CORREO` están configurados y se probó un aviso de fallo real.
- [ ] Existe al menos un superadmin del nuevo dueño y se revocaron los accesos del equipo anterior.
- [ ] El nuevo equipo recibió los accesos al repositorio, a los runners y al VPS por canal seguro.

Detalle técnico: [Copias de seguridad y restauración (técnico)](../tecnico/copias-y-restauracion.md).
