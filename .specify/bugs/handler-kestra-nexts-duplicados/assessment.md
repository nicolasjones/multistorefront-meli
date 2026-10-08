# Bug Assessment: handler Kestra con siguientes duplicados

- **Slug**: handler-kestra-nexts-duplicados
- **Created**: 2026-09-25
- **Source**: validación E2E local del template
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Tras recuperar la conexión JDBC, el escenario exitoso del harness genérico
terminó correctamente. El escenario de falla técnica quedó en estado fallido
y Kestra registró `Duplicate Nexts on execution ... despacho_ssh`.

## Symptom

Una falla de SSH en `plantilla-dedicado` no recorre de forma estable el
handler que clasifica y alerta; por lo tanto el E2E no puede terminar ni probar
la ausencia de secretos.

## Reproduction

1. Ejecutar `pnpm test:kestra:secretos:e2e` con JDBC local disponible.
2. El escenario `fixture-exito` termina `SUCCESS`.
3. El escenario `fixture-tecnica` falla en `despacho_ssh` y Kestra informa
   `Duplicate Nexts`.

## Suspected Code Paths

- `infra/kestra/flows/plantilla-dedicado.yml` — `errors` está adjunto al flow
  de nivel superior, después de tareas que pueden producir continuaciones.
- `infra/kestra/flows/plantilla-generico.yml` — usa el mismo patrón dentro de
  un `ForEach`.
- `infra/kestra/validar-secretos-e2e.mjs` — reproducción aislada real.

## Root Cause Hypothesis

Kestra 1.3.35 no resuelve de forma segura el handler de un SSH con reintentos
cuando está al mismo nivel que las tareas posteriores. Encapsular la secuencia
operativa en `Sequential` y adjuntar allí `errors` evita rutas siguientes
duplicadas, como el patrón ya validado en Sauger. Confianza media: requiere
confirmación E2E tras el cambio.

## Proposed Remediation

**Preferred**: mover la secuencia SSH + marcado de conexión a un `Sequential`
en ambos flows de plantilla y conservar allí el handler existente, sin cambiar
la clasificación ni transportar logs o secretos.

**Files likely to change**:

- `infra/kestra/flows/plantilla-generico.yml`
- `infra/kestra/flows/plantilla-dedicado.yml`
- `infra/kestra/validar-secretos-e2e.mjs` si requiere una aserción adicional

**Tests to add or update**:

- `pnpm infra:config:kestra`
- `pnpm test:kestra:secretos:e2e`

## Risks & Considerations

- Mantener `allowFailure` y alertas sin secretos.
- No aprobar el fix sin el recorrido E2E de éxito y ambos caminos de error.

## Open Questions

- Ninguna.
