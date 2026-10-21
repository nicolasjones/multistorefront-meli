# Calidad determinista — 2026-10-21

| check | estado |
|---|---|
| gitleaks (secretos) | hallazgos |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |

Nota: gitleaks figura en «hallazgos» porque ni el binario ni Docker estaban disponibles en la máquina del agente (el script devuelve `missing`); no es un secreto detectado. Lo valida el CI.
