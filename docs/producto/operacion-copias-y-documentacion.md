---
owner: producto
sources:
  - specs/011-backups-postgres
  - specs/20261018-120000-operacion-copias-y-documentacion
  - infra/kestra/flows/respaldo-postgres.yml
  - infra/kestra/flows/respaldo-imagenes.yml
  - infra/kestra/flows/retencion-copias.yml
  - infra/kestra/flows/verificar-restauracion.yml
  - infra/kestra/flows/aviso-fallo-copias.yml
  - infra/kestra/flows/alerta-ausencia-respaldos.yml
---

# Plataforma · Operación, copias y documentación (MSF-457)

**Épica:** MSF-457 · **Historias:** F-OPS-01 «Copias de seguridad y restauración» y F-OPS-05
«Documentación funcional y técnica» · **Spec:** `specs/20261018-120000-operacion-copias-y-documentacion` (Hito 4,
P0). Detalle técnico: [Operación, copias y documentación (técnico)](../tecnico/operacion-copias-y-documentacion.md).

> **Estado al 2026-11-18:** las copias de la base y de las imágenes, la retención, la verificación semanal de
> restauración y el aviso por correo ante fallos **ya existen** (spec `20261018-120000-operacion-copias-y-documentacion`).
> Falta ejecutar y firmar el simulacro de restauración en staging. La referencia operativa vigente es
> [Copias de seguridad y restauración](../copias-y-restauracion.md); esta página resume el estado para producto.

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
| Copia diaria de imágenes de Storage (03:15), con historial `respaldos_imagenes` | **Existe** | `infra/kestra/flows/respaldo-imagenes.yml` |
| Retención por días con tope (por defecto 30 días y 12 mensuales para la base; 7 días, 2 mensuales y tope de 7 para las fotos de imágenes) y purga diaria (04:30) | **Existe** | `infra/kestra/flows/retencion-copias.yml` |
| Verificación semanal de restauración (lunes 05:00) en una base descartable, con historial `verificaciones_restauracion` | **Existe** | `infra/kestra/flows/verificar-restauracion.yml` |
| Aviso por correo al equipo de soporte ante un fallo y alerta si no corrió ninguna copia en las últimas 30 horas | **Existe** (requiere configurar el SMTP y `SOPORTE_CORREO`) | `aviso-fallo-copias.yml`, `alerta-ausencia-respaldos.yml` |
| Procedimiento guiado de restauración | **Existe** | [Copias y restauración](../copias-y-restauracion.md), [Restaurar base](../tecnico/runbooks/db-restore.md) |
| Las copias viven en el mismo servidor que la aplicación | **Riesgo asumido** por decisión del propietario; pasar a un destino externo se hace solo con variables | [Copias y restauración](../copias-y-restauracion.md) |
| Simulacro de restauración en staging, medido y firmado | **Pendiente** de ejecución (falta autorización sobre staging) | [Simulacro de restauración](../simulacro-restauracion.md) |
| Objetivo de recuperación (≤ 24 h de datos perdidos, volver a operar en ≤ 4 h) | **Propuesto**, a confirmar con el cliente | [Copias y restauración](../copias-y-restauracion.md) |

## Límites

Mientras el simulacro no se ejecute, el objetivo de recuperación sigue sin medirse. La documentación F-OPS-05 se cierra cuando estén las
funciones de todos los componentes (sin bloqueo formal).

## Cómo probarlo

Prueba a mano el respaldo de la base y su registro. La copia de imágenes y la verificación de restauración se prueban
igual desde Kestra (ver [Copias y restauración](../copias-y-restauracion.md)); el simulacro firmado en staging sigue pendiente.

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

- Respaldo: cubierto por pgTAP `supabase/tests/database/backups_postgres.test.sql` (modelo y RPC).
- Imágenes y verificaciones de restauración: pgTAP `supabase/tests/database/copias_imagenes_verificaciones.test.sql`; el contrato de los
  flows lo fija `pnpm test:kestra:copias`.
- Simulacro de restauración en staging: **pendiente de ejecutar**. Sin video: no hay pantalla.
