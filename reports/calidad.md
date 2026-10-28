# Calidad determinista — 2026-10-27

| check | estado |
|---|---|
| gitleaks (secretos) | la base `dokploy` dejó «hallazgos» en este check; en este entorno se saltó (sin binario `gitleaks` ni permiso de Docker) y se re-ejecuta en el CI (runner self-hosted), que es el gate. Revisión manual del diff: sin secretos |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |
