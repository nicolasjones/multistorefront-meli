---
owner: producto
sources: [specs]
---
# Simulacro de restauración (cierre de MSF-457)

Spec `specs/20261018-120000-operacion-copias-y-documentacion` · FR-011 · SC-002.
Procedimiento de restauración: [copias-y-restauracion.md](copias-y-restauracion.md#procedimiento-guiado-de-restauración).

## Estado

**Pendiente de ejecución en staging.** Esta entrega no tuvo autorización para tocar staging, así que
el simulacro **no se corrió** y **no hay tiempos medidos ni firma**. No se inventa ningún resultado:
la tabla de abajo queda vacía hasta que el propietario autorice y firme.

`Desvío:` T018 se cierra sin simulacro por falta de autorización sobre staging. Seguimiento
trazado: Tarea `seguimiento` en Jira «Ejecutar y firmar el simulacro de restauración en staging»
(**MSF-520**, dueño: propietario del producto). Mientras tanto, la restauración sí se comprueba cada semana de
forma automática en un Postgres efímero con el flow `verificar-restauracion`
(historial en `public.verificaciones_restauracion`), pero eso **no reemplaza** el simulacro
completo ni mide el tiempo de punta a punta.

## Objetivos a verificar

| Objetivo | Valor | Cómo se mide |
|---|---|---|
| Pérdida máxima de datos | ≤ 24 h | Hora de la última fila en la base restaurada frente a la hora de la caída simulada |
| Tiempo de recuperación | ≤ 4 h | Desde «se decide restaurar» hasta «el panel responde con datos» |

## Protocolo

1. Anotar la hora de inicio y quién ejecuta. Usar **solo staging**, nunca producción.
2. Elegir la última copia de base y de imágenes del historial (`public.respaldos`,
   `public.respaldos_imagenes`).
3. Restaurar la base (sección A de la guía) y las imágenes (sección B).
4. Comprobar: el panel inicia sesión, una organización conocida lista sus datos y una imagen del
   catálogo se ve.
5. Anotar la hora de fin y completar el registro.

## Registro del simulacro

| Campo | Valor |
|---|---|
| Fecha | _pendiente_ |
| Ejecutó | _pendiente_ |
| Copia de base usada (fecha) | _pendiente_ |
| Copia de imágenes usada (fecha) | _pendiente_ |
| Pérdida de datos medida | _pendiente_ (objetivo ≤ 24 h) |
| Tiempo total medido | _pendiente_ (objetivo ≤ 4 h) |
| Problemas encontrados | _pendiente_ |
| Resultado | _pendiente_ |
| Firma del propietario | _pendiente_ |

## Riesgo conocido

Las copias viven en el **mismo servidor** que el sistema: perder el servidor completo se lleva
también las copias. Trasladar el destino a S3/B2/SFTP se hace cambiando variables (ver la guía de
copias) y queda como seguimiento aparte.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
