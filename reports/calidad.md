# Calidad determinista — 2026-10-27

| check | estado |
|---|---|
| gitleaks (secretos) | saltado |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |

> `gitleaks` queda **saltado** en esta sesión: el binario no está instalado y el fallback a Docker falla con
> «permission denied» sobre el socket del daemon (no es un hallazgo de secretos). Lo corre el CI.
