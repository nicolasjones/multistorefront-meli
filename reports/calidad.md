# Calidad determinista — 2026-10-21

| check | estado |
|---|---|
| gitleaks (secretos) | saltado (herramienta no disponible) |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |

Nota: gitleaks quedó «saltado» porque ni el binario ni Docker estaban disponibles en la máquina del agente; lo valida el CI.
