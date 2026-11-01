# Plan: Analítica avanzada y resumen por correo (MSF-265)

**Spec**: [`spec.md`](./spec.md) · **Estado**: provisional hasta responder P1–P4.

## Enfoque

- **F-REP-07**: reutilizar `ReporteEmbebido` + `emitir-acceso-reporte` (spec 007) y las vistas `analitica`. Las vistas nuevas son aditivas (`select` solo al rol de Superset, `organizacion_id` en cada fila, como `analitica.margen_producto_canal`). Si P1 = «editar», se necesita una excepción documentada a 007 FR-013 (rol de Superset acotado, sin acceso al resto de Superset) y se decide P2 (persistencia; los tableros de equipo siguen exportándose a YAML en `infra/superset/dashboards/`). No se crea tabla hasta responder P2.
- **F-REP-08**: nuevo tipo `resumen_semanal` en `public.tipos_aviso` (migración aditiva) y un flow de Kestra `resumen-semanal.yml` que reclama destinatarios con una función `private` (`for update skip locked`, idempotente por destinatario y semana), arma el resumen desde vistas `analitica` y envía por el SMTP existente (`KESTRA_SMTP_*`), con reintentos como `enviar-avisos`. Rol: `kestra_orquestacion` con `EXECUTE` solo sobre sus funciones. Secciones de ventas/stock condicionadas a la existencia de sus vistas.

## Esquemas (Principio VII, re-verificado)

Sin tablas nuevas confirmadas. `tipos_aviso`: `public` (plataforma). Vistas: `analitica`. Cualquier tabla futura se declara aquí con su esquema antes de implementarla.

## Contratos / OpenAPI

Sin RPC ni Edge Function confirmadas todavía: se declararán en `contracts/resumen-semanal.md` (y `openapi/*.json` si hay Edge Function) al cerrar P1–P3. Nada existente cambia de firma.

## Documentación

`docs/analitica-avanzada.md` y `docs/resumen-semanal-correo.md`; actualizar `docs/operar-superset.md`, `docs/avisos-por-correo.md` y la fila correspondiente de `docs/roadmap-template.md` (#34) al cerrar.

## Riesgos

Excepción a la regla «el administrador no accede a Superset» (seguridad); correo duplicado por entrega «al menos una vez» (mitigado por idempotencia por semana); datos de otra organización en el correo (test pgTAP).
