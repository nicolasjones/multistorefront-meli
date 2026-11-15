# Plan: Analítica avanzada y resumen por correo (MSF-265)

**Spec**: [`spec.md`](./spec.md) · **Estado**: F-REP-08 cerrado (P3 resuelto en `docs/resumen-semanal-correo.md`); F-REP-07 sigue provisional hasta responder P1–P2.

## Enfoque

- **F-REP-07**: reutilizar `ReporteEmbebido` + `emitir-acceso-reporte` (spec 007) y las vistas `analitica`. Las vistas nuevas son aditivas (`select` solo al rol de Superset, `organizacion_id` en cada fila, como `analitica.margen_producto_canal`). Si P1 = «editar», se necesita una excepción documentada a 007 FR-013 (rol de Superset acotado, sin acceso al resto de Superset) y se decide P2 (persistencia; los tableros de equipo siguen exportándose a YAML en `infra/superset/dashboards/`). No se crea tabla hasta responder P2.
- **F-REP-08**: nuevo tipo `resumen_semanal` en `public.tipos_aviso` (migración aditiva) y un flow de Kestra `resumen-semanal.yml` que reclama destinatarios con una función `private` (`for update skip locked`, idempotente por destinatario y semana), arma el resumen desde vistas `analitica` y envía por el SMTP existente (`KESTRA_SMTP_*`), con reintentos como `enviar-avisos`. Rol: `kestra_orquestacion` con `EXECUTE` solo sobre sus funciones y con el guardia `private.exigir_llamante_kestra()` en las tres. Secciones de ventas/stock condicionadas a la existencia de sus vistas.

## Esquemas (Principio VII, re-verificado)

| Objeto | Esquema | Historia | Justificación | RLS / acceso |
|---|---|---|---|---|
| `dominio.resumen_semanal_envios` | `dominio` | F-REP-08 | Es el dato del producto: una fila por (organización, destinatario, semana) con el resumen que se envió, su estado, los intentos y el error útil. Es también la clave de idempotencia del envío → dominio del producto, no plataforma | RLS por organización + lectura de `rentabilidad`; escriben solo las funciones `private` (Kestra) y la app no la lee (no hay pantalla que la consuma) |
| `public.tipos_aviso` (fila `resumen_semanal`) | `public` | F-REP-08 | Catálogo de plataforma de MSF-189: se registra el tipo, no se crea tabla | RLS vigente de `tipos_aviso` |
| Vistas de lectura de los tableros | `analitica` (solo vistas) | F-REP-07 | Contrato de lectura para Superset; no almacenan datos; cada fila lleva `organizacion_id` | Sin acceso para `anon`/`authenticated`; `select` solo al rol de Superset |

`dominio.resumen_semanal_envios` (creada en `20270324101000_resumen_semanal_tabla.sql`): `id uuid`
(primaria), `organizacion_id uuid` (→ `public.organizaciones`), `destinatario_id uuid` (→
`auth.users`), `semana text` (AAAA-Wnn, clave de idempotencia), `destinatario_correo text`,
`resumen jsonb not null` (el resumen tal como se encoló, con al menos una sección),
`estado text` (`pendiente`/`enviando`/`enviado`/`fallido`), `intentos integer`, `origen text`,
`creado_en`/`actualizado_en`/`enviado_en` `timestamptz`, `reclamado_hasta timestamptz` y
`ultimo_error text`. Restricción única `(organizacion_id, destinatario_id, semana)`.

El tope `RESUMEN_SEMANAL_LIMITE` es el **tamaño de la tanda** del reclamo, no un recorte: la función
encola a todos los destinatarios con datos y reclama la cola en tandas hasta vaciarla, así que con
más destinatarios que el tope ninguno queda sin correo. La cola vive en la misma tabla (estado
`pendiente`), como el resto de las colas del repo.

## Contratos / OpenAPI

F-REP-08 no agrega RPC ni Edge Function: el contrato son las funciones `private` del resumen y el
flow `infra/kestra/flows/resumen-semanal.yml`, documentados en `docs/resumen-semanal-correo.md`.
Nada existente cambia de firma. F-REP-07 sigue sin contrato cerrado hasta responder P1–P2.

## Documentación

`docs/analitica-avanzada.md` y `docs/resumen-semanal-correo.md`; actualizar `docs/operar-superset.md`, `docs/avisos-por-correo.md` y la fila correspondiente de `docs/roadmap-template.md` (#34) al cerrar.

## Riesgos

Excepción a la regla «el administrador no accede a Superset» (seguridad); correo duplicado por entrega «al menos una vez» (mitigado por idempotencia por semana); datos de otra organización en el correo (test pgTAP); destinatarios que quedan fuera del tope de la tanda (mitigado: la cola se reclama en tandas hasta vaciarla y la fila `pendiente` queda registrada).
