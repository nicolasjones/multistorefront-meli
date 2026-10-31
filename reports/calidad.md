# Calidad determinista — 2026-10-31

| check | estado |
|---|---|
| gitleaks (secretos) | saltado — sin binario `gitleaks` ni permiso de Docker en este entorno: el check **no corrió** (no es un hallazgo de secretos) y lo re-ejecuta el CI (runner self-hosted), que es el gate. Revisión manual del diff: sin secretos |
| oxlint (SAST) | ok |
| knip (código muerto) | ok |
| jscpd (duplicación) | ok |
| dependency-cruiser (arquitectura) | ok |
| syncpack (versiones) | ok |

> `gitleaks` queda **saltado** en esta sesión: no hay binario `gitleaks` y el fallback a Docker falla con
> «permission denied» sobre el socket del daemon. **No es un hallazgo de secretos**: no se escaneó ningún
> archivo. Lo corre el CI, que instala el binario nativo antes de `pnpm calidad`.
>
> `dependency-cruiser` figura «ok» pero el wrapper `pnpm dlx depcruise` de `scripts/calidad.mjs` resuelve al
> paquete placeholder de npm (no escanea nada): es un «ok» de confianza, no una verificación efectiva. Queda
> para el CI/una historia de tooling; no bloquea esta entrega.
