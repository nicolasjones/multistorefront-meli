# Plan: Documentación obligatoria

## Decisiones

1. Un script Node sin dependencias externas compara `base...HEAD`.
2. Se consideran relevantes las rutas de plataforma y tooling mantenido.
3. La evidencia puede vivir en specs, `docs/` o reglas permanentes.
4. CI usa `fetch-depth: 0` para resolver correctamente la base del PR.

## Validación

Se ejecuta `pnpm docs:check`; además se revisa el workflow y se mantienen los
comandos existentes de lint, build, test e infraestructura sin cambios.
