# Implementation Plan: Publicación segura de flows

**Branch**: `20260924-221340-publicacion-segura-flows` | **Date**: 2026-09-24 | **Spec**: [spec.md](./spec.md)

## Summary

Evitar actualizaciones contra flows ausentes: consultar primero su existencia y
crear o actualizar según corresponda. El renderizado de webhook existente sigue
siendo opcional y no se registran secretos ni respuestas operativas.

## Technical Context

**Language/Version**: Node.js 24, ECMAScript modules.
**Primary Dependencies**: Fetch nativo, Node test runner.
**Storage**: No aplica.
**Testing**: `node --test` con servidor HTTP local controlado.
**Target Platform**: Kestra local o VPS, Windows y Linux.
**Project Type**: Tooling de infraestructura.
**Constraints**: Sin secretos en salida; timeout de 60 s; no modificar flows de negocio.

## Constitution Check

- Aislamiento y secretos: pasa; las credenciales sólo se usan en memoria.
- Idempotencia/auditoría: pasa; crear y actualizar son rutas explícitas.
- Despliegues independientes: pasa; sólo toca tooling de Kestra.
- Documentación: pasa; spec, tareas y guía se actualizan en el mismo PR.

## Project Structure

```text
infra/kestra/desplegar-flow.mjs
infra/kestra/desplegar-flow.test.mjs
docs/adoptar-tooling-typescript.md
specs/20260924-221340-publicacion-segura-flows/
```

**Structure Decision**: se extiende el publicador existente y se prueba como
proceso aislado contra HTTP local, sin requerir credenciales reales ni Kestra.
