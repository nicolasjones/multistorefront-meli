# Feature Specification: Aviso de cobertura E2E en el PR

**Feature Branch**: `feat/024-aviso-e2e` · **Estado**: implementada

## Problema

Hoy el video de un cambio queda en un artifact de GitHub que hay que ir a
descargar. Quien revisa no ve qué se rompió ni qué se cubrió sin salir del PR, y
el visor `/cobertura-e2e` existe pero nadie se entera de que la corrida lo
actualizó.

## Objetivo

Que cada PR grabe el recorrido público, publique la evidencia en el bucket y
deje **un solo comentario actualizado** con el link al visor, sin abrir GitHub
Actions ni descargar artifacts.

## Requisitos

- **FR-001** En `pull_request`, el job `application` graba video de los E2E
  públicos (hoy sólo graba lo que falla).
- **FR-002** Si existen `EVIDENCIAS_E2E_URL` y `EVIDENCIAS_E2E_SERVICE_ROLE_KEY`,
  la corrida sube manifiesto + videos al bucket (ya lo hace el job).
- **FR-003** Si además existe la variable `EVIDENCIAS_E2E_VIEWER_URL`, el job
  comenta en el PR el link al visor y el id de la corrida, editando su comentario
  anterior en vez de acumular uno por push.
- **FR-004** Sin secretos o sin variable, el paso no comenta y **no falla** la
  corrida (mismo criterio que la subida).
- **FR-005** El aviso no se publica en corridas manuales ni en `push` (sólo PR).

## Fuera de alcance

- Disparar E2E desde el visor (spec aparte).
- Retención de videos (los define el bucket).

## Criterios de aceptación

1. Un PR que toca `apps/web` produce videos de `acceso-publico` y
   `recorrido-publico` y un comentario con el link al visor.
2. Un push nuevo al mismo PR **actualiza** ese comentario, no agrega otro.
3. Sin `EVIDENCIAS_E2E_VIEWER_URL` el PR sigue en verde y sin comentario.

## Alcance de entrega

CI (`refine`/`docs`); sin cambios de esquema.
