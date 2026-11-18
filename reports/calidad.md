# Calidad determinista — 2026-11-18

| check | estado |
|---|---|
| gitleaks (secretos) | hallazgos |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |

## gitleaks (secretos)

```
docker: permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Head "http://%2Fvar%2Frun%2Fdocker.sock/_ping": dial unix /var/run/docker.sock: connect: permission denied

Run 'docker run --help' for more information
```

Salida completa de cada herramienta: `reports/calidad.log` (artifact `calidad-reporte`).
