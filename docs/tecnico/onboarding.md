---
owner: tecnico
sources:
  - package.json
  - apps/web/package.json
---

# Onboarding técnico

## 1. Levantar el proyecto

```bash
pnpm install
pnpm dev:supabase   # Postgres/Auth/Storage local
pnpm dev            # panel
```

Sin Docker/Supabase, el panel arranca pero las pantallas con datos no funcionan.

## 2. Entender el repo

- `apps/web` — panel (rutas, páginas, componentes, tests).
- `supabase` — migraciones, RLS, RPC, pgTAP.
- `workers` — procesos aislados.
- `specs` — la spec de cada épica (Spec Kit).
- `design/pantallas` — prototipo visual (fuente de UI).
- `docs` — esta documentación.

## 3. Convenciones que no se negocian

- Migraciones **aditivas** con reversión.
- RLS en toda tabla expuesta; la UI no es seguridad.
- Tests: Vitest para web/lógica, pgTAP para base, Playwright para e2e.
- **El prototipo manda la UI**; se implementa con el template y tokens del sistema de diseño.
- Commit en castellano, conventional commits; PR contra `main` (o rama de épica).
- Nada de secretos en el repo; `.env.example` es el contrato.

## 4. Tu primer cambio

1. Leé la spec de la épica (`specs/<slug>/spec.md`) y sus tasks.
2. Creá la rama `feat/story-<KEY>` (o `fix/bug-<KEY>`).
3. Implementá con tests; actualizá docs/DER si tocás datos o contratos.
4. Abrí el PR con evidencia (tests, capturas, diagramas).
5. El CI corre `docs:check`, lint, tests y e2e; el Revisor revisa QA + técnica. Para docs, `pnpm docs:wiki:check` valida inventario, `docs/manifest.json` y drift de fuentes antes de commitear. El drift compara contra `sourceAt` (el commit donde se calculó el hash de la página): sumar una spec nueva no marca como vieja a toda página que declara `specs` como fuente; editar o borrar un archivo que ya existía, sí.

## 6. Evidencia E2E (video por historia)

Todo test E2E que pruebe una historia deja su **video en 1920×1080** con cursor y rótulos grandes, y queda
atado a la historia:

- `apps/web/e2e/fixture.ts` — fixture de evidencia: reemplaza `page` por una página que **graba siempre a
  1920×1080** (el nativo de Playwright se reduce a 800×450) y adjunta el video al reporte. Los tests
  importan `test`/`expect` de ahí, **nunca** de `@playwright/test`.
- El **título** del test lleva `[EPICA:TASK]` (y opcionalmente `[F-XXX-NN#n]` para los criterios): con eso
  `pnpm cobertura:e2e` ata el video a la historia y a la épica.
- Comandos:
  ```bash
  pnpm test:e2e:evidencia                       # corre la suite en modo visible (cursor + rótulos)
  pnpm cobertura:e2e -- --report e2e-report.json --results apps/web/test-results \
      --specs specs --out cobertura-e2e.json --run-id local --modo on
  pnpm armar-video:e2e -- --manifiesto cobertura-e2e.json --videos apps/web/test-results --out videos [--epica MSF-136]
  ITSAPLAN_API_KEY=… pnpm armar-video:e2e -- … --publicar   # adjunta el MP4 a la historia en It's a Plan
  ```
- `apps/web/e2e/evidencia.e2e.ts` es el **test de referencia** (MSF-119: ingreso → recuperación → enlace
  vencido → ruta protegida) con `expect` en cada paso.
- Lo que no tiene pantalla (RLS, concurrencia, escritura directa) se prueba en **pgTAP** y no necesita video.

## 7. Dónde preguntar

- **Producto:** `docs/producto`.
- **Técnico:** esta sección.
- **Decisiones:** `docs/tecnico/adr.md`.
- **Documentos históricos:** `docs/tecnico/biblioteca.md`.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
