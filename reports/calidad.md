# Calidad determinista — 2026-10-21

| check | estado |
|---|---|
| gitleaks (secretos) | hallazgos |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |

**Nota gitleaks («hallazgos»):** el escáner no pudo correr en el entorno del
Desarrollador; el detalle archivo:línea y por qué son falsos positivos
(fixtures de test y `{{ envs.* }}` de Kestra) está en `docs/historial-ventas.md`
(sección «gitleaks en `reports/calidad.md`»). Sin credenciales en el diff de la historia.
