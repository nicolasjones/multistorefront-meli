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
5. El CI corre `docs:check`, lint, tests y e2e; el Revisor revisa QA + técnica. Para docs, `pnpm docs:wiki:check` valida inventario, `docs/manifest.json` y drift de fuentes antes de commitear.

## 5. Dónde preguntar

- **Producto:** `docs/producto`.
- **Técnico:** esta sección.
- **Decisiones:** `docs/tecnico/adr.md`.
- **Documentos históricos:** `docs/tecnico/biblioteca.md`.
