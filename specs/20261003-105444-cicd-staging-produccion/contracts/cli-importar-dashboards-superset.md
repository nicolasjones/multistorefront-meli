# Contrato CLI: `infra/superset/importar-dashboards.mjs`

## Invocación

```bash
node infra/superset/importar-dashboards.mjs --source <ruta-al-paquete.zip> --entorno staging|production
```

## Entradas

| Fuente | Nombre | Requerido | Descripción |
|---|---|---|---|
| `--source` | ruta a archivo | Sí | Paquete exportado de Superset (ZIP con el YAML del dashboard + datasets/bases que usa) |
| `--entorno` | `staging` \| `production` | Sí | Determina qué variables de entorno (`SUPERSET_URL`, `SUPERSET_USERNAME`, `SUPERSET_PASSWORD`) resuelve el GitHub Environment activo — igual patrón que `desplegar-flow.mjs` con Kestra |
| Variable de entorno | `SUPERSET_URL` | Sí | Base URL de la instancia de Superset de ese entorno |
| Variable de entorno | `SUPERSET_USERNAME` / `SUPERSET_PASSWORD` | Sí | Credenciales de una cuenta de servicio de Superset con permiso de import |

## Comportamiento

1. Valida que el archivo en `--source` exista y sea legible antes de autenticar contra Superset (falla rápido, mismo criterio que `desplegar-flow.mjs` con `readFile` del flow).
2. Autentica contra la API de Superset (login con usuario/password para obtener token de acceso, o Basic Auth si la versión de Superset en uso lo soporta sin ese paso — a confirmar durante implementación contra la versión real del `infra/superset/compose.yaml` del repo).
3. Envía el paquete al endpoint de import de dashboards de Superset (`POST /api/v1/dashboard/import/`, multipart con el ZIP).
4. Reporta el resultado (dashboard(s) importados) o el error de Superset, redactando credenciales del mensaje antes de propagarlo (mismo patrón `redactError`).

## Salida

- Éxito: código de salida 0, log con el/los dashboard(s) importados.
- Error: excepción con mensaje redactado, código de salida distinto de 0.

## Fuera de alcance de este contrato

- No se invoca desde ningún workflow automático de push (FR-011) — es invocación manual mientras no exista ningún paquete de dashboard versionado en el repositorio.
- No decide qué datasets/bases debe mapear el import a nivel de negocio — eso es trabajo del producto derivado cuando tenga su primer dashboard real, documentado como siguiente paso en `docs/adoptar-cicd-staging-produccion.md`.

## Extensión MSF-204 (F-REN-01, 2026-10-24)

La épica de Rentabilidad agregó un modo versionado y automático, sin romper este contrato:

- `--directorio <carpeta>` (además del `--source <paquete.zip>` original): empaqueta los YAML de
  `infra/superset/dashboards/<producto>/` con `infra/superset/empaquetar-dashboards.mjs`, sustituye
  el host de la base (`SUPERSET_ANALITICA_DB_HOST`) y excluye `reportes.json` del paquete.
- La contraseña de la conexión de solo lectura viaja en el campo `passwords` del import
  (`SUPERSET_ANALITICA_DB_PASSWORD`), nunca en Git.
- Si el directorio trae `reportes.json`, registra los reportes de forma idempotente en
  `public.reportes` con su `seccion` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` —solo server-side—
  y `SUPERSET_REPORTE_CREADO_POR`). Sin esas variables importa igual y avisa.
- El workflow `deploy-infraestructura-vps.yml` lo invoca con `--directorio` después de
  `pnpm deploy:vps` cuando el push toca `infra/superset/dashboards/**`.
