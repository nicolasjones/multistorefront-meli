# Bug Assessment: credencial local de Kestra no reproducible

- **Slug**: credencial-kestra-local
- **Created**: 2026-09-25
- **Source**: validación E2E local del template
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

`pnpm test:kestra:secretos:e2e` termina en `FAILED` durante su escenario de
éxito. Kestra informa que PostgreSQL rechazó la autenticación del rol
`kestra_orquestacion`.

## Symptom

Los flows genéricos no pueden abrir su conexión JDBC local aunque el rol exista
y tenga sus grants. El harness E2E no llega a validar workers ni secretos.

## Reproduction

1. Levantar Supabase y Kestra locales con `infra/kestra/.env`.
2. Ejecutar `pnpm test:kestra:secretos:e2e`.
3. Observar `FATAL: password authentication failed for user "kestra_orquestacion"` en la tarea `organizaciones_activas`.

## Suspected Code Paths

- `supabase/migrations/20260914150000_orquestacion_multi_organizacion.sql:118` crea el rol con una contraseña inicial distinta.
- `infra/kestra/compose.yaml` inyecta `KESTRA_ORQUESTACION_DB_PASSWORD` al flow.
- `infra/kestra/validar-secretos-e2e.mjs` prueba la conexión real que revela la divergencia.

## Root Cause Hypothesis

La migración crea el rol con un valor inicial y no existe un paso local
versionado que lo reconcilie con la contraseña configurada para Kestra. El
archivo `.env` local puede cambiar sin actualizar la contraseña del rol.
Confianza: alta; la misma contraseña autentica desde localhost (hba `trust`),
pero falla desde la ruta Docker que usa Kestra.

## Proposed Remediation

**Preferred**: agregar un comando Node local, explícito y sin imprimir la
contraseña, que reconcilie la contraseña de `kestra_orquestacion` desde
`KESTRA_ORQUESTACION_DB_PASSWORD` antes de levantar/validar el E2E. Documentar
el paso y usarlo sólo para desarrollo local; no codificar una contraseña ni
editar una migración histórica.

**Files likely to change**:

- `infra/kestra/*.mjs`
- `package.json`
- `docs/` y esta evaluación de bug

**Tests to add or update**:

- prueba del comando que rechace entorno incompleto sin revelar valores.
- `pnpm test:kestra:secretos:e2e` con la ruta JDBC real.

## Risks & Considerations

- No registrar ni devolver contraseñas en salida, logs o artefactos.
- No convertir el valor de entorno local en una migración o secreto versionado.

## Open Questions

- Ninguna para el entorno local: el valor está entregado únicamente por el
  archivo ignorado de Kestra.
