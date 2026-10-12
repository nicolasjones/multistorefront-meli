# Arquitectura

```text
Usuario → Refine (Dokploy/Traefik) → Supabase Cloud
                          ↑        ↓
                    workers ← Kestra/VPS
                          ↓
                     Superset/VPS
```

El navegador autentica contra Supabase y opera sólo con permisos RLS. Kestra
coordina trabajos de larga duración y llama workers concretos. Superset consulta
vistas de lectura preparadas para analítica; no es la interfaz transaccional.

## Estructura del monorepo

```text
apps/web/                  Refine y configuración de despliegue (Dokploy)
supabase/                  configuración, migraciones, seed y funciones
infra/refine/              Docker local de Refine
infra/kestra/              Compose local y VPS de Kestra
infra/superset/            Compose local y VPS de Superset
workers/                   procesos aislados futuros
specs/                     especificaciones por funcionalidad
.specify/                  reglas y plantillas de Spec Kit
```

## Referencia del schema de Supabase

`docs/schema.html` es una referencia navegable (tablas, columnas, PK/FK,
funciones RPC) del schema `public` que expone PostgREST. Es generada, no se
edita a mano: `pnpm docs:schema` la regenera a partir del Supabase local
corriendo (`pnpm dev:supabase`), leyendo el OpenAPI que PostgREST arma solo.
Es una foto del momento — correlo de nuevo después de una migración que
cambie el schema, antes de commitear.

Compartir repositorio no significa desplegar todo junto. Un cambio sólo activa
el pipeline correspondiente a las rutas que modifica.

## Proyectos Docker locales

```text
multistorefront-meli-refine-dev      infra/refine/compose.yaml
multistorefront-meli-supabase-dev    supabase/config.toml (Supabase CLI)
multistorefront-meli-kestra-dev      infra/kestra/compose.yaml
multistorefront-meli-superset-dev    infra/superset/compose.yaml
multistorefront-meli-playwright-dev  infra/playwright/compose.yaml
multistorefront-meli-runner-dev      infra/runner/compose.yaml
```

Cada proyecto tiene red, contenedores y volúmenes propios. Se comunican por
interfaces explícitas (API, URL o credenciales configuradas), no porque Docker
los incluya dentro de un mismo Compose. Docker Desktop los muestra como seis
grupos planos; esa es la representación más granular que admite Compose.

## Playwright: servicio propio para automatización de navegador

`infra/playwright/compose.yaml` levanta un `playwright run-server` (imagen
`mcr.microsoft.com/playwright:v1.61.0-noble`), que expone un endpoint
WebSocket en `127.0.0.1:3103`. Se prende y apaga igual que cualquier otro
producto (`pnpm dev:playwright` / `pnpm dev:down:playwright`) — no corre
salvo que lo hayas levantado.

Los flows de Kestra que necesitan navegador no descargan la imagen pesada por
ejecución: un Script task liviano (solo el cliente de Playwright, sin
navegadores) se conecta a ese servidor remoto en vez de lanzar uno local. La
dirección exacta con la que un flow alcanza este servicio (`host.docker.internal`,
una red Docker compartida, o la IP del VPS) queda por resolver cuando se
escriba el primer flow real que lo use — es una decisión de ese flow, no de
esta pieza de infraestructura.
