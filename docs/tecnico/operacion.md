---
owner: operacion
sources:
  - .github/workflows/validate.yml
  - .github/workflows/quality.yml
  - .github/workflows/docs.yml
  - .github/workflows/nightly.yml
  - infra/kestra/flows/enviar-avisos.yml
  - infra/kestra/flows-retirados.txt
  - infra/kestra/compose.yaml
  - supabase/functions/_shared/smtp.ts
  - scripts/verificar-salida-correo.mjs
---

# Operación

## Deploy

- **DEV:** merge a la rama de deploy del producto (en MSF, `dokploy`); Dokploy reconstruye.
- **STG/PRD:** promoción con aprobación humana; el flujo actualiza `Deployment Status`.
- **Panel de control:** el orquestador corre en VPS1 (Dokploy, proyecto SDLC).
- Referencia: **[Deployment](../deployment.md)** y **[Ambientes](../ambientes-verificacion.md)**.

## CI

- `Validate`: docs, lint, tests, pgTAP, build, e2e público; el job manual `e2e-visible-sesion` graba el recorrido con sesión y adjunta el video (ver [E2E de la app](../e2e-app.md)).
- `quality`: secretos, SAST, dead code, duplicación, arquitectura, versiones, commitlint. El job falla ante hallazgos pero **no bloquea el merge por sí solo**: el ruleset exige únicamente `validacion` (`.github/workflows/quality.yml`, cabecera; ver [Calidad](../calidad.md)).
- `docs` (publicación de la wiki): corre solo en PR hacia `main`, push a `main` o a mano (`.github/workflows/docs.yml:6-9`); no corre en PR a `dokploy` porque el drift de fuentes de directorio entero saltaría siempre.
- `nightly`: Lighthouse (performance) y axe (accesibilidad) sobre el build; no bloquea PRs, pero falla en rojo si encuentra algo (`.github/workflows/nightly.yml`). El E2E nocturno con sesión corre aparte en `e2e-nocturno.yml`.
- **Regla:** no se mergea con un check **requerido** en rojo; los no requeridos no frenan el merge pero se miran.

## Backups y recuperación

- Copia diaria de la base (03:00) y de las imágenes de Storage (03:15), retención por días con tope, verificación de restauración
  semanal (lunes 05:00, en una base descartable) y alertas por correo ante fallo o ausencia de copias. **Las copias viven en el mismo
  servidor que la aplicación** (riesgo asumido; el destino externo se activa solo con variables).
- Referencia: **[Copias de seguridad y restauración](../copias-y-restauracion.md)** y **[Operar el sistema](../operar-sistema.md)**
  (purgas y retenciones programadas de Kestra).

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

## Avisos de consultas

El camino directo anterior (flow `avisos-consultas`, Edge Function `enviar-aviso-consulta` y la cola `dominio.consultas_avisos` con sus tres
RPC) **se retiró**: la migración `20270306140000_avisos_consulta_camino_directo.sql` elimina la cola y el flow figura en
`infra/kestra/flows-retirados.txt`. Las consultas nuevas emiten por `private.emitir_aviso` y las envía `enviar-avisos` (ver «Avisos por correo y
listas»). Detalle: [Consultas](consultas.md#aviso-por-correo).

## Migración inicial de datos (MSF-142)

- Los datos reales se cargan **solo en producción** con el asistente, por un Administrador. El repo,
  los tests y el PR usan únicamente fixtures inventados.
- El ensayo reproducible es pgTAP: `pnpm dev:supabase` y luego
  `supabase test db --local supabase/tests/database/migracion_ensayo.test.sql` (dos corridas y
  `migracion_conciliacion.test.sql`). La evidencia son las líneas `# EVIDENCIA corrida 1/2: {...}`;
  el CI las corre con `pnpm test:db`.
- Antes del corte: Catálogo cargado, stock inicial por F-STK-07, export CSV UTF-8 del panel anterior,
  copia de seguridad verificada y ensayo en verde. Orden: clientes → proveedores → vínculos →
  archivo de ingresos; se lee el informe de conciliación después de cada carga.
- Reintentar la misma carga no duplica (idempotencia por `(carga, fila)` e identificador externo). La
  vuelta atrás completa es restaurar la copia previa.
- Detalle: [Migración inicial de datos](migracion-inicial-de-datos.md) y
  [plan de corte](../producto/migracion-inicial-de-datos.md).
## Solicitud de acceso (MSF-148)

- El aviso por correo de «Solicitar acceso» sale por el **mismo SMTP que Supabase Auth**, no por un
  proveedor nuevo: Mailpit en local (`supabase_inbucket_<project_id>`, puerto 1025 dentro de la red Docker;
  interfaz en `SUPABASE_MAILPIT_PORT`, 4302) y el relay `GOTRUE_SMTP_*` en STG/PROD.
- Variables de la Edge Function: `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS` y
  `SMTP_FROM`, con los nombres en `supabase/functions/.env.example` y los valores reales como secretos de la
  función (`supabase secrets set`). Sin `SMTP_HOST`/`SMTP_FROM` la función falla de forma visible, pero el
  pedido ya quedó guardado en `public.solicitudes_acceso`.
- Si no hay administrador activo en la organización, el pedido se conserva y la pantalla avisa que no hay a
  quién notificar; el reclamo de envío se libera para un reintento posterior.
- **Verificación de salida:** `pnpm correo:verificar-salida` (`scripts/verificar-salida-correo.mjs`) es
  manual y opt-in; no corre en `pnpm test` ni en el CI (la **suite** que lo prueba sí corre en el CI:
  `pnpm test:correo:verificar-salida`). En local comprueba la API de Mailpit con
  `MAILPIT_URL`; contra el servidor self-hosted se confirma a mano que el mensaje llega a `CORREO_PRUEBA`,
  que es obligatoria en ese modo. Los códigos de salida (`0` verificado por Mailpit, `1` esta corrida no
  envió nada, `2` falta una variable, `3` el aviso salió y la entrega queda por confirmar a mano) y su
  registro están en [Verificación de salida del correo](../verificacion-salida-correo.md); en el servidor el
  guion **nunca** devuelve `0`, así que nunca es «verificado a mano».
- **Pendiente:** relay SMTP real y entregabilidad (SPF/DKIM) en el VPS. Dueño: infraestructura/Nicolás.
  La corrida contra el SMTP real **no se ejecutó** y no hay evidencia: queda trazada como **MSF-532**
  (Tarea `seguimiento` a crear en el tracker) y registrada en
  [Verificación de salida del correo](../verificacion-salida-correo.md).
  Detalle: [Perfil y permisos avanzados](perfil-y-permisos.md) · [Solicitar acceso](../solicitar-acceso.md).

## E2E y evidencia

- Playwright graba **video + traza**; en el visor → **Grabaciones** se abre el reporte HTML.
- Los recorridos con sesión requieren Supabase local o DEV con credenciales.
- Referencia: **[E2E de la app](../e2e-app.md)**.

## Documentación y diagramas

- `pnpm docs:wiki:check` valida el sitio y el inventario; `pnpm docs:manifest` y `pnpm docs:drift` verifican que cada página no quedó vieja respecto de sus fuentes.
- Los diagramas Archify se sirven en el visor → **Diagramas**.
- Un cambio de código/datos que no actualice su doc debe fallar el check (o quedar como deuda con dueño).

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).

> **CI (2026-10-27):** los `.md` de raíz (`CLAUDE.md`, `AGENTS.md`) ya no cuentan como cambio de la app web. Antes, un PR sólo de docs encendía el e2e sin `build` y moría con *"Falta apps/web/dist"*; ahora, si el e2e corre, el `build` corre antes.

> **CI (2026-11-12):** el paso «avisar el link del visor en el PR» de `validate.yml` ya no falla si el runner no trae `gh` (la imagen de `infra/runner/Dockerfile` no lo instala): avisa en el log y sigue. Antes salía con 127 y dejaba rojo el job `application` aunque sus tests pasaran.
