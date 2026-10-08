# Research: Plantilla genérica de producto de automatización

No quedaron `NEEDS CLARIFICATION` en el Technical Context del plan — todas
las decisiones de nombre ya se tomaron en la conversación previa a esta
spec. Este archivo documenta esas decisiones en formato Decision/Rationale
para que queden trazables.

## Nombre del proyecto

- **Decision**: `automation-platform-template`.
- **Rationale**: describe qué es (base para productos de automatización) sin
  atarlo a una marca o vertical específico, a diferencia de nombres como
  `agenmatica-template` (atado a la organización) o `estudio-automation`
  (atado al vertical contable).
- **Alternatives considered**: `agenmatica-template` (descartado por atar el
  nombre a la organización dueña en vez de a qué es el repo).

## Repo de GitHub

- **Decision**: renombrar también `Agenmatica/estudio-automation` →
  `Agenmatica/automation-platform-template` (no solo el nombre interno).
- **Rationale**: coherencia de punta a punta entre lo documentado y dónde
  vive realmente el código; GitHub redirige automáticamente la URL vieja, así
  que el costo de romper enlaces existentes es bajo. Ya ejecutado antes de
  esta spec.
- **Alternatives considered**: dejar el repo con el nombre viejo y solo
  renombrar internamente — descartado porque perpetúa la inconsistencia que
  esta misma feature busca eliminar.

## Nombre del paquete del frontend

- **Decision**: `@platform/web` (reemplaza a `@estudio/web`).
- **Rationale**: scope corto y genérico, consistente con que
  `automation-platform-template` es largo para usarlo como scope de pnpm en
  cada comando (`--filter @platform/web`); "platform" es la palabra que
  mejor resume el propósito sin repetir "automation" ni "template".
- **Alternatives considered**: `@template/web` (descartado, "template" es
  ambiguo — podría confundirse con plantillas de UI); `@app/web` (descartado,
  demasiado genérico, no dice nada del proyecto).

## Convención de nombres de proyectos Docker

- **Decision**: dos prefijos distintos según el contexto — nombre completo
  del proyecto (`automation-platform-template-<producto>-dev`) para
  proyectos Docker **locales**; prefijo corto `platform-<entorno>-<producto>`
  para proyectos Docker de **VPS** (staging/producción).
- **Rationale**: preserva un patrón que el repo ya tenía antes de esta spec
  (`scripts/deploy-vps.sh` y `docs/deployment.md` ya usaban el prefijo corto
  `estudio-` para VPS, distinto del nombre completo `estudio-automation-`
  usado en desarrollo local) — se generaliza la misma convención, no se
  inventa una nueva.
- **Alternatives considered**: usar el nombre completo en los dos contextos
  — descartado por alejarse innecesariamente de la convención ya
  establecida en el repo.

## Alcance de "eliminar lenguaje contable"

- **Decision**: se reescribe el Principio I de la constitución y el
  primer párrafo del README; no se toca el historial de commits ni las
  specs ya cerradas (`001-separacion-local-por-producto`), que quedan como
  registro histórico.
- **Rationale**: el historial de Git es un registro de lo que pasó, no
  documentación viva — reescribirlo no aporta valor y sí agrega riesgo
  (reescribir historia compartida). La spec 001 documenta una decisión de
  arquitectura ya implementada (separar infra por producto), que sigue
  siendo válida independientemente del nombre del proyecto.
- **Alternatives considered**: purgar toda mención histórica — descartado
  por el motivo anterior.
