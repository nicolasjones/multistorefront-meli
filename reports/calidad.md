# Calidad determinista — 2026-10-27

| check | estado |
|---|---|
| gitleaks (secretos) | saltado en este entorno (sin binario `gitleaks` ni permiso de Docker); se re-ejecuta en el CI (runner self-hosted). Revisión manual del diff: sin secretos |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |
