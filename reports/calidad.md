# Calidad determinista — 2026-10-27

| check | estado |
|---|---|
| gitleaks (secretos) | saltado |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |

> `gitleaks` queda **saltado** en esta sesión: el `gitleaks` que resuelve el script es el **paquete placeholder de
> npm** (publicado para evitar confusión de dependencias) — no escanea nada y sale con error, así que el check
> marcaría «hallazgos» sin haber mirado un archivo—, y el fallback a Docker falla con «permission denied» sobre el
> socket del daemon. **No es un hallazgo de secretos**: lo corre el CI.
