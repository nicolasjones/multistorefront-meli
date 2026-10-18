# Implementation Plan: Plataforma · Operación, copias y documentación

**Branch**: `epic/MSF-457-plataforma-operacion-copias-y-documentac` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

## Summary

Se extiende la spec 011: la copia de la base sale también a un destino externo; se agrega la copia de imágenes de Storage, la retención 30 diarias + 12 mensuales, la verificación periódica de restauración en un Postgres aislado y el aviso por correo, todo como flows de Kestra versionados con registro auditable en tablas nuevas de `public`. Aparte, F-OPS-05 ordena la documentación en `docs/` (usar, operar, entregar).

## Technical Context

**Language/Version**: SQL (`supabase/migrations`), YAML de Kestra (`infra/kestra/flows`), Markdown (`docs/`), Node (`.mjs`) para pruebas de flows

**Dependencies**: plugins de Kestra ya presentes (JDBC Postgres, scripts shell/Docker runner); correo vía plugin de Kestra (SMTP); sin dependencias nuevas en `apps/web`

**Storage**: Postgres self-hosted. Destino externo de copias: almacenamiento compatible con S3, por variables.

**Testing**: pgTAP (`supabase/tests/database/`), `node --test` de los flows, `pnpm infra:config`, simulacro en staging.

**Delivery scope**: `supabase`, `kestra`, docs. Sin `refine`.

**Constraints**: migración aditiva con reversión; `anon` sin privilegios; sin service-role en navegador; sin secretos en Git; Supabase self-hosted, sin Cloud; despliegue independiente de Kestra.

## Constitution Check

- **I / VII (esquemas)**: `respaldos_imagenes` y `verificaciones_restauracion` → **`public`** (backups, plataforma/transversal), con RLS (select solo superadmin). `respaldos` no se altera. Ninguna tabla en `dominio`. Re-verificado en spec, plan y tareas; se re-verifica en implementación y PR. ✔
- **III**: flows idempotentes; cada corrida registra origen, estado, timestamps y motivo de error. Reintento no duplica (una fila en progreso por tipo). ✔
- **IV**: solo cambia Kestra, Supabase y docs; despliegues independientes. ✔
- **V**: sin infraestructura nueva más allá del destino externo y el correo, ambos con caso de uso. ✔
- **VI**: no aplica (sin pantallas).
- **VIII**: docs en el mismo cambio. ✔

## Diseño

### F-OPS-01
- Migración aditiva `20261018120000_copias_imagenes_y_verificaciones.sql` (`public`): `respaldos_imagenes` (id, origen, estado `en_progreso|completado|error`, iniciado/finalizado, cantidad_objetos, tamano_bytes, ubicacion, motivo_error, check de consistencia como `respaldos`, índice único de un solo `en_progreso`) y `verificaciones_restauracion` (id, respaldo_id → `respaldos`, estado, duracion_segundos, detalle, motivo_error). Funciones `security definer`, `search_path=''`, `revoke … public, anon, authenticated` / `grant execute … kestra_backups`. RLS: `select` solo `private.is_superadmin()`.
- Flows (`infra/kestra/flows/`, namespace `platform.backups`): ampliar `respaldo-postgres.yml` (copia al destino externo); `respaldo-imagenes.yml`; `retencion-copias.yml`; `verificar-restauracion.yml` (contenedor Postgres efímero y aislado, nunca el entorno operativo); `aviso-fallo-copias.yml` (subflow de correo, invocado desde los `errors:` de los demás).
- Variables nuevas solo en `.env.example` / `infra/kestra/.env.example`: destino externo, SMTP, correo de soporte, retención diaria/mensual.
- Procedimiento guiado: `docs/copias-y-restauracion.md`.

### F-OPS-05
- `docs/README.md` como índice con tres entradas (usar / operar / entregar) y guías `docs/guia-funcional.md`, `docs/operar-sistema.md`, `docs/entregar-sistema.md`, enlazando las guías existentes y una tabla funcionalidad↔documento.

### Cierre
Simulacro en staging (`docs/simulacro-restauracion.md`, firmado por el propietario), revisión de cobertura documental, revisión de seguridad, roadmap.

## Reversión

Orden inverso: borrar las funciones de verificación y de copia de imágenes; `drop table verificaciones_restauracion; drop table respaldos_imagenes;`. Los flows nuevos se desactivan/borran de Kestra; `respaldo-postgres.yml` vuelve a su versión anterior en git. Nada se destruye en el mismo PR que lo crea.

## Seguridad y concurrencia

- Revisión `authz-security` de RLS y grants (`anon` sin acceso; ningún rol de organización lee copias) y `crypto-secrets` del manejo de credenciales del destino y SMTP.
- Una sola fila `en_progreso` por tipo; auto-sana de colgadas como en 011.
- Las copias contienen `auth.users` y datos de todas las organizaciones: el destino externo es de acceso restringido y, si el proveedor lo permite, cifrado en reposo.
- El entorno de verificación es efímero y sin acceso a producción.

## Pruebas

- pgTAP `copias_imagenes_verificaciones.test.sql`: RLS, solo superadmin lee, sin escritura directa, `anon` sin acceso, funciones solo ejecutables por `kestra_backups`, estados consistentes; `rls_en_toda_tabla` y el test de ejecutabilidad por `anon` siguen verdes.
- `node --test` de los flows (estructura, `errors:` con aviso, variables definidas).
- Simulacro en staging con tiempo medido.

## Documentación

`docs/copias-y-restauracion.md`, `docs/simulacro-restauracion.md`, índice y guías de F-OPS-05, `docs/roadmap-template.md` al cierre (paso manual), `.env.example`.
