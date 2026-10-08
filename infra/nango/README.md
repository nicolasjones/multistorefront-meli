# Nango self-hosted

Motor de autenticación OAuth y proxy de API compartido por la plataforma
(spec [`20260930-153545-conexiones-oauth-nango`](../../specs/20260930-153545-conexiones-oauth-nango/spec.md)).
Es infraestructura de quien opera el producto derivado — nunca credenciales
de negocio de una organización/cliente (eso sigue siendo el mecanismo de
`public.conexiones` de la spec 013).

## Arrancar en local

```powershell
Copy-Item .env.example .env
Copy-Item .env.example infra/nango/.env
pnpm dev:nango
```

Dashboard de Nango en `http://localhost:3003` (puerto configurable con
`NANGO_PORT`), usuario/clave de `NANGO_DASHBOARD_USERNAME`/`NANGO_DASHBOARD_PASSWORD`.

Para detenerlo: `pnpm dev:down:nango`.

## Registrar una integración (proveedor OAuth)

1. En el dashboard de Nango, crear una "Integration" nueva eligiendo el
   proveedor (p. ej. Google), con el client id/secret de una app OAuth propia
   (Google Cloud Console u equivalente) — nunca los de un cliente/estudio.
   Durante desarrollo, esa app puede quedar en modo "Testing" con usuarios de
   prueba agregados a mano (trámite del producto derivado, fuera de esta
   spec).
2. Anotar la `provider_config_key` que le asignás (por convención, el mismo
   nombre corto del proveedor, p. ej. `google`).
3. Registrar esa misma clave en el catálogo de Supabase con
   `select registrar_integracion_oauth('google', 'Google');` (solo
   superadmin) — sin este paso, ninguna organización puede iniciar una
   conexión aunque la integración ya exista en Nango.

Ver `specs/20260930-153545-conexiones-oauth-nango/contracts/` para el
contrato completo (conectar una organización, y cómo un backend/worker pide
un access token vigente).

## Producción / staging

`NANGO_SERVER_URL`/`NANGO_PUBLIC_SERVER_URL` deben apuntar al dominio HTTPS
propio del producto derivado (reverse proxy ya existente, mismo patrón que
Kestra/Superset — ver `docs/deployment.md`). El template no provee ni asume
ese dominio.
