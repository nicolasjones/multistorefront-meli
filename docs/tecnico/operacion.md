---
owner: operacion
sources:
  - .github/workflows
  - infra
---

# Operación

## Deploy

- **DEV:** merge a la rama de deploy del producto (en MSF, `dokploy`); Dokploy reconstruye.
- **STG/PRD:** promoción con aprobación humana; el flujo actualiza `Deployment Status`.
- **Panel de control:** el orquestador corre en VPS1 (Dokploy, proyecto SDLC).
- Referencia: **[Deployment](../deployment.md)** y **[Ambientes](../ambientes-verificacion.md)**.

## CI

- `Validate`: docs, lint, tests, pgTAP, build, e2e público; el job manual `e2e-visible-sesion` graba el recorrido con sesión y adjunta el video (ver [E2E de la app](../e2e-app.md)).
- `quality`: secretos, SAST, dead code, duplicación, arquitectura, versiones, commitlint.
- `nightly`: regresiones y chequeos programados.
- **Regla:** no se mergea con un check **requerido** en rojo; los no requeridos no frenan el merge pero se miran.

## Backups y recuperación

- Backups de Postgres/volúmenes y copia offsite; ensayo de restauración mensual.
- Referencia: **[CI self-hosted y storage](../ci-self-hosted-storage.md)** y la documentación de infra.

## Cotización del dólar (MSF-116)

- El historial `dominio.cotizaciones` es **append-only**: triggers `ENABLE ALWAYS` rechazan `UPDATE`,
  `DELETE` y `TRUNCATE` también para el dueño y `service_role`.
- Consecuencia para restauración: un `pg_restore` de datos sobre una tabla ya poblada (o un
  `TRUNCATE … CASCADE` que la alcance) **falla**; hay que restaurar sobre una base vacía, donde los
  `INSERT` no se bloquean. Borrar una organización sigue funcionando por cascada.
- No hay barrido ni worker: la pendiente vence a las 24 h y se resuelve al consultar. No requiere cron de
  Kestra.
- Detalle del modelo y la reversión: [Dólar y recálculo](dolar-y-recalculo.md).

## Analítica

- Superset para dashboards; los dashboards se exportan a YAML y se versionan.
- Referencia: **[Operar Superset](../operar-superset.md)**.

## Avisos por correo y listas (MSF-189)

- El flow `enviar-avisos` (`infra/kestra/flows/enviar-avisos.yml`, namespace `platform.avisos`) corre **cada
  minuto**: reclama grupos vencidos con `private.reclamar_avisos_listos(50)`, envía **un correo por grupo** y
  registra el resultado. Reintenta con espera de 1, 2, 4 y 8 minutos; al quinto intento queda `fallido` con
  el error (máximo 500 caracteres).
- Rol de base: `kestra_orquestacion`, con `EXECUTE` solo sobre reclamar, marcar enviado y registrar fallo; no
  puede leer ni escribir las tablas.
- Variables: `KESTRA_SMTP_HOST`, `KESTRA_SMTP_PORT`, `KESTRA_SMTP_TRANSPORTE`, `KESTRA_SMTP_USERNAME`,
  `KESTRA_SMTP_PASSWORD` y `KESTRA_SMTP_FROM` en `infra/kestra/.env.example` y `infra/kestra/compose.yaml`;
  `KESTRA_ORQUESTACION_DB_URL` y `KESTRA_ORQUESTACION_DB_PASSWORD` para el rol. Sin secretos en Git. El
  proveedor concreto sigue sin definir.
- Revisar la cola (como superusuario): `select estado, count(*) from public.avisos_pendientes group by 1;`;
  los fallidos, `select grupo_id, tipo_aviso, intentos, error from public.avisos_pendientes where estado =
  'fallido' order by creado_en desc;`.
- La ventana de agrupación (15 min) se cambia reemplazando `private.ventana_agrupacion_aviso()` en una
  migración; el tope de intentos, `private.max_intentos_aviso()`. Un reclamo vencido vuelve a `pendiente` en
  la siguiente corrida. No hay reenvío manual desde la UI.
- Listas: `dominio.estados_consulta` se administra en `/configuracion/listas`; `dominio.motivos_movimiento`
  es la misma tabla de `/stock/motivos`. La pantalla no borra: desactiva.
- **Pendiente:** conectar `estados_consulta` con la bandeja de Consultas (hoy usa tres estados fijos) y elegir
  proveedor/remitente de correo (SPF/DKIM). Detalle: [Avisos y listas](avisos-y-listas.md).

## Avisos de consultas (MSF-122)

> **Desde MSF-189 (MSF-562)** las consultas nuevas **no** encolan en `dominio.consultas_avisos`: el
> disparador emite por `private.emitir_aviso` y las envía `enviar-avisos` (ver arriba). Este flow y la Edge
> Function quedan solo para **drenar** lo que ya estaba encolado por el camino anterior.

- El flow `avisos-consultas` (`infra/kestra/flows/avisos-consultas.yml`) corre **cada minuto**, barre
  `dominio.consultas_avisos` y llama a la Edge Function `enviar-aviso-consulta` con `{"barrer": true}`.
- Variables: `SMTP_*`, `PANEL_URL` y `AVISOS_CONSULTAS_TOKEN` en `supabase/functions/.env.example`; el token y
  la URL/clave del barrido en `infra/kestra/.env.example`. Sin secretos en Git.
- Reintentos: tope de 5 intentos y reserva de 2 minutos; un aviso `enviado` no se reenvía. Un fallo de
  correo **no** revierte la consulta.
- En local, el correo se lee en **Mailpit**. Para reprocesar a mano, invocá la función con
  `{"barrer": true}` y el header `x-aviso-token`. Detalle: [Consultas](consultas.md#aviso-por-correo).

## E2E y evidencia

- Playwright graba **video + traza**; en el visor → **Grabaciones** se abre el reporte HTML.
- Los recorridos con sesión requieren Supabase local o DEV con credenciales.
- Referencia: **[E2E de la app](../e2e-app.md)**.

## Documentación y diagramas

- `pnpm docs:wiki:check` valida el sitio y el inventario; `pnpm docs:manifest` y `pnpm docs:drift` verifican que cada página no quedó vieja respecto de sus fuentes.
- Los diagramas Archify se sirven en el visor → **Diagramas**.
- Un cambio de código/datos que no actualice su doc debe fallar el check (o quedar como deuda con dueño).

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).
