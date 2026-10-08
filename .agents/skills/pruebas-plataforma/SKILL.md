---
name: pruebas-plataforma
description: Diseña, revisa o ejecuta pruebas de esta plataforma. Úsala al cambiar comportamiento en web, workers, Supabase, Kestra o Playwright; enruta a Vitest, pgTAP, E2E o validación real según el alcance.
---

# Pruebas de la plataforma

Elige la evidencia mínima que realmente prueba el cambio; no declares una funcionalidad validada por un lint, un mock o una prueba de otra capa.

- Web y workers TypeScript: escribe o ajusta pruebas Vitest cerca del comportamiento. Para componentes Refine/MUI usa React Testing Library; para proveedores externos, prueba contratos sanitizados y casos de error sin introducir credenciales en fixtures.
- Supabase: todo cambio de migración, RPC, RLS o aislamiento debe tener una prueba pgTAP en `supabase/tests/database/`. Ejecuta `pnpm test:db` con Supabase local; en CI, la variante es `pnpm test:db:ci` desde el runner.
- E2E de interfaz: el servicio `infra/playwright` sirve a los workers y no equivale a una suite `@playwright/test`. Si una spec requiere un flujo de navegador versionado, define su infraestructura, datos aislados y evidencia antes de agregar dependencias. Para escribir o depurar esa suite, carga `playwright-best-practices`; para accesibilidad, `accessibility-testing`.
- Kestra y workers: validar YAML/Compose no prueba el flujo. Para cambios de automatización, ejecuta el worker o flow real que corresponda con datos de prueba y confirma idempotencia, estados, errores sanitizados y ausencia de secretos.
- Ejecuta el subconjunto afectado durante el trabajo y, al cerrar una entrega, las validaciones de `AGENTS.md` que correspondan. No agregues cobertura o E2E masivo fuera del alcance de la spec.
- La cobertura de CI de un worker depende de lo que declare su propio pipeline (`.github/workflows/worker-images.yml` y sus scripts de validación); para un worker todavía sin esa cobertura, ejecuta su script local y trata ampliar CI como una mejora de proceso separada y especificada.
