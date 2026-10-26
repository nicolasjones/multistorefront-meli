# Calidad determinista — 2026-10-26

| check | estado |
|---|---|
| gitleaks (secretos) | saltado |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |

`gitleaks` no se pudo correr en este entorno: el binario es un placeholder (publicado para
evitar la confusión de dependencias) y el fallback por Docker no alcanza el daemon («permission
denied while trying to connect to the Docker daemon socket»). El script marca cualquier salida
distinta de 0 como «hallazgos», pero acá no hay un hallazgo de secretos: el CI (`quality.yml`)
corre gitleaks con el binario nativo.
