# Feature Specification: la cobertura E2E se ve en el panel SDLC

**Feature Branch**: `feat/026-e2e-en-sdlc` · **Estado**: implementada

## Problema

El visor de cobertura E2E (specs 022, 023 y 025) quedó dentro del panel de MSF:
una ruta `/cobertura-e2e`, páginas, tests y hasta un bucket en el Supabase del
producto. Eso es herramienta de desarrollo: no debe existir en MSF.

## Objetivo

Que la cobertura y los videos se vean en el **panel SDLC** (el visor de
operación), y que MSF sólo produzca el manifiesto como artefacto del CI.

## Requisitos

- **FR-001** MSF deja de exponer `/cobertura-e2e` y elimina sus páginas, tests y
  la subida al bucket; no usa secretos ni Storage para evidencia.
- **FR-002** El CI sigue generando `cobertura-e2e.json` + videos como artefactos
  (`playwright-report`, `playwright-report-sesion`).
- **FR-003** El panel SDLC muestra Componente → Épica → Historia con progreso,
  buscador, filtro, checklist y video, importando la última corrida exitosa.
- **FR-004** Desde la ficha se puede lanzar el recorrido (`e2e_grep`) y el video
  aparece al terminar.
- **FR-005** El comentario del PR enlaza al panel SDLC (variable
  `EVIDENCIAS_E2E_VIEWER_URL`), no a una ruta de MSF.

## Fuera de alcance

- Borrar el bucket `evidencias-e2e` o su migración (queda sin uso; las
  migraciones no se destruyen en el mismo PR que las crea).
- Autenticación del panel SDLC: corre en el tailnet, como el resto del panel.

## Criterios de aceptación

1. En MSF, `/cobertura-e2e` ya no existe y el build no incluye esas páginas.
2. En el panel SDLC, `?v=e2e` lista la última corrida con sus videos y permite
   correr una épica.
3. Un PR de MSF comenta el link al panel SDLC.

## Matriz pantalla↔criterios

MSF no agrega pantallas; **quita** la ruta. El visor destino es el panel SDLC y
se especifica en su repo (`docs/panel-web.md`).

## Alcance de entrega

`refine` (remoción) y CI; sin cambios de esquema.
