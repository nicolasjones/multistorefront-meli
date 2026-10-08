# Implementation Plan: Blindaje y publicación de imágenes de workers

**Branch**: `017-blindaje-imagenes-workers` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-blindaje-imagenes-workers/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Estandarizar el ciclo de build, publicación, ejecución y recuperación de los workers sin fusionarlos en una imagen monolítica. Se usará un Dockerfile reutilizable con un argumento de worker, un contexto de build en la raíz del monorepo, una matriz de publicación a GHCR y referencias inmutables por digest. Kestra seguirá despachando jobs puntuales por SSH; los flows recibirán imágenes versionadas y el comando de ejecución agregará las restricciones de runtime compatibles con cada servidor.

## Technical Context

**Language/Version**: Node.js 24, TypeScript 6.0, pnpm 11.19.0; Dockerfile Linux `amd64`

**Primary Dependencies**: Docker BuildKit/buildx, GHCR, GitHub Actions, Kestra, workers que declare cada producto derivado

**Storage**: Registry de imágenes GHCR y almacenamiento local de imágenes en los servidores de workers; no agrega tablas ni migraciones

**Testing**: `pnpm` build/lint/test por worker, smoke tests de imagen, scanner de vulnerabilidades, `docker image inspect`, pruebas de contrato Kestra y validación de idempotencia con fixtures

**Target Platform**: Contenedores Linux `amd64`, ejecutables en hosts Linux o Windows con runtime de contenedores Linux; Linux es el destino de producción

**Project Type**: Monorepo de plataforma con workers batch aislados y orquestación SSH desde Kestra

**Performance Goals**: Build y smoke test de todos los workers en un único job de CI; rollback de un worker en menos de 10 minutos; el runtime debe iniciar sin un servicio HTTP residente

**Constraints**: No secretos en imágenes ni logs; no imagen monolítica; no cambio de contrato funcional de Kestra; bloquear vulnerabilidades críticas y altas salvo excepción aprobada y con vencimiento; conservar al menos una versión anterior; no ejecutar como root por defecto

**Scale/Scope**: El template todavía no tiene ningún worker real; esta spec entrega el mecanismo (descubrimiento por contrato, imagen parametrizada, política de release, runtime endurecido) para que cualquier worker futuro de cualquier producto derivado lo adopte sin construir nada de esto por su cuenta; no incluye ningún conector de negocio ni despliegue automático a servidores

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Aislamiento multi-tenant**: PASS. Los cambios no relajan RLS ni exponen secretos; la organización continúa llegando al worker por variables de runtime ya existentes.
- **II. Especificar antes de implementar**: PASS. Esta spec y este plan preceden a los cambios de Docker/CI.
- **III. Automatizaciones idempotentes y auditables**: PASS. El contrato de ejecución conserva códigos de salida, evidencia, versión, organización e idempotencia.
- **IV. Un monorepo, despliegues independientes**: PASS. Cada worker conserva su imagen y ciclo; no se agrega Compose raíz ni se fusionan productos.
- **V. Simplicidad operativa**: PASS CONDICIONADO. Se reutiliza el workflow existente y se evita infraestructura nueva; el detalle de límites se valida en smoke tests.
- **Quality gates**: PASS CONDICIONADO. Antes del merge se ejecutan build, lint, tests, `infra:config` y validación de workers; no hay migraciones.

## Project Structure

### Documentation (this feature)

```text
specs/017-blindaje-imagenes-workers/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── worker-image.md
│   └── worker-runtime.md
└── tasks.md
```

### Source Code (repository root)

```text
workers/Dockerfile                         # plantilla parametrizada por WORKER
workers/<worker>/package.json              # dependencias y build de cada worker (cuando exista uno)
workers/<worker>/src/                       # código de cada worker, no se fusiona
.dockerignore                               # contexto mínimo y sin secretos
.github/workflows/worker-images.yml         # matriz build, scan y publicación
infra/kestra/flows/plantilla-generico.yml   # restricciones y referencia de imagen
infra/kestra/flows/plantilla-dedicado.yml
workers/README.md                           # comandos locales y operación
```

**Structure Decision**: Mantener una imagen por worker y centralizar el patrón de build en `workers/Dockerfile`. El workflow descubre carpetas de workers que cumplan el contrato, recibe el nombre de cada una, construye desde la raíz del monorepo y publica una imagen independiente. Los flows siguen recibiendo una referencia inmutable y lanzan jobs puntuales, sin convertir workers en servicios HTTP. Como el template todavía no tiene ningún worker real, el mecanismo queda listo y verificado con fixtures — el primer worker real de un producto derivado lo adopta sin cambios en el pipeline.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Imagen parametrizada compartida | Evita duplicar un Dockerfile por worker sin mezclar dependencias en runtime | Una imagen monolítica aumentaría el blast radius, el tamaño y el acoplamiento de releases |
