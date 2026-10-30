---
owner: producto
sources:
  - specs/011-backups-postgres
  - infra/kestra/flows
---

# Plataforma · Operación, copias y documentación (MSF-457)

**Épica:** MSF-457 · **Historias previstas:** F-OPS-01 «Copias de seguridad y restauración» y F-OPS-05
«Documentación funcional y técnica» · **Spec prevista:** `operacion-copias-y-documentacion` (Hito 4,
P0). Detalle técnico: [Operación, copias y documentación (técnico)](../tecnico/operacion-copias-y-documentacion.md).

> **Estado al 2026-10-30:** la épica **no tiene spec ni código propio en el repo**: no existe
> `specs/*operacion-copias-y-documentacion*`. Esta página documenta (a) lo que **ya existe** y la
> épica extiende (respaldo diario de Postgres, spec 011) y (b) lo que **falta** y se marca como pendiente.
> Nada de lo pendiente se da por hecho.

## Qué resuelve y para quién

Objetivo de la épica: copias diarias de la base y de las imágenes, un simulacro que pruebe que se pueden
restaurar, y documentación para usar, operar y entregar el sistema. Es para el **equipo de operación /
soporte** y la persona propietaria que firma el simulacro. No tiene pantallas (F-OPS-01 vive en la base y
en Kestra; F-OPS-05 en `docs/`).

## Qué hay hoy y qué falta

| Pieza | Estado | Referencia |
|---|---|---|
| Respaldo diario de la base (03:00) y a demanda, con historial `respaldos` | **Existe** (spec 011) | `infra/kestra/flows/respaldo-postgres.yml` |
| Verificación estructural del archivo (no vacío, cabecera `PGDMP`) | **Existe** | mismo flow, tarea `verificar_respaldo` |
| Procedimiento manual de restauración | **Existe** (runbook) | [Restaurar base](../tecnico/runbooks/db-restore.md) |
| Retención (30 diarias + 12 mensuales) | **Pendiente**: sólo es una propuesta de la épica | spec 011 la deja fuera de alcance |
| Copia de imágenes fuera del proyecto Supabase que las aloja | **Pendiente** | roadmap #43 (Backup de Storage) |
| Verificación periódica de restauración / simulacro firmado | **Pendiente** | roadmap #6 (Restauración) |
| Aviso por correo al equipo de soporte ante fallo | **Pendiente**; depende del proveedor de correo | TODO dueño: producto |
| Objetivo de recuperación (≤ 24 h de datos perdidos, volver a operar en ≤ 4 h) | **Propuesto**, a definir con el cliente | TODO dueño: producto |

## Límites / fuera de alcance de lo ya entregado

El respaldo de la spec 011 **no** restaura, **no** borra copias viejas y **no** avisa ante fallos; sólo
deja el estado auditable en la tabla `respaldos`. La documentación F-OPS-05 se cierra cuando estén las
funciones de todos los componentes (sin bloqueo formal).

## Cómo probarlo

Prueba a mano **lo que existe hoy** (respaldo y su registro). El simulacro de restauración y el respaldo
de imágenes aún no son probables: no hay implementación.

### Prerrequisitos

- Rol: superadmin / acceso operativo a Kestra y a la base del entorno (DEV o local con `pnpm dev:supabase`
  y Kestra levantado desde `infra/kestra/`).
- Variables `KESTRA_BACKUPS_DB_URL`, `KESTRA_BACKUPS_DB_PASSWORD` y `KESTRA_BACKUPS_PGDUMP_URL` configuradas
  en el `.env` de Kestra (ver `.env.example`).
- Flow `respaldo-postgres` (namespace `platform.backups`) desplegado.

### Pasos

1. En la UI de Kestra, abrir el flow `platform.backups / respaldo-postgres` y pulsar **Execute** sin tocar
   inputs. Se ve la ejecución avanzar por `iniciar_respaldo`, `pg_dump`, `verificar_respaldo` y
   `finalizar_respaldo_completado`.
2. Consultar la tabla: `select id, origen, estado, tamano_bytes, ubicacion from public.respaldos order by id desc limit 1;`.
   Se ve una fila `origen = 'manual'`, `estado = 'completado'`, tamaño > 0 y ubicación.
3. Volver a ejecutar mientras la primera sigue en curso: la segunda falla y no crea fila (sólo un respaldo
   `en_progreso` a la vez).
4. Al día siguiente (o tras las 03:00) revisar `respaldos`: hay una fila `origen = 'programado'`.
5. Restauración (manual, hoy): seguir [Restaurar base](../tecnico/runbooks/db-restore.md) sobre una base
   **temporal** y comparar conteos de tablas críticas.

### Resultado esperado

- **Given** el flow desplegado y la base accesible, **When** se ejecuta el respaldo (manual o a las 03:00),
  **Then** queda una fila en `respaldos` en `completado` con tamaño y ubicación, o en `error` con motivo.
- **Given** una copia completada, **When** se restaura en una base temporal, **Then** los conteos coinciden
  (esta parte es manual; el objetivo de la épica es que sea un simulacro medido y firmado).

### Cómo automatizarlo

- Respaldo: cubierto por pgTAP `supabase/tests/database/backups_postgres.test.sql` (modelo y RPC) y por los
  scripts E2E de Kestra en `infra/kestra/`; **sin rótulo `[MSF-457:T0yy]` todavía**.
- Simulacro de restauración, respaldo de imágenes y aviso por correo: **pendiente de automatizar** (sin spec
  ni `tasks.md`; los rótulos se asignan al crear la spec). Sin video: no hay pantalla.
