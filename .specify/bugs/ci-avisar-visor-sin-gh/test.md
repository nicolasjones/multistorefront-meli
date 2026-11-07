# Test MSF-801

- YAML de `validate.yml` parsea y el step lleva `continue-on-error: true` (verificado local).
- `pnpm docs:check` local.
- Verificación real: el job `application` del PR queda verde (step en gris si `gh` aún no está en el runner). La imagen del runner debe reconstruirse para que `gh` exista.
