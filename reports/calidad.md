# Calidad determinista — 2026-10-31

| check | estado |
|---|---|
| gitleaks (secretos) | hallazgos (no de secretos) — saltado: en este entorno no hay binario `gitleaks` ni permiso de Docker, así que el check marca «hallazgos» sin escanear un archivo y se re-ejecuta en el CI (runner self-hosted), que es el gate. Revisión manual del diff: sin secretos |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |
