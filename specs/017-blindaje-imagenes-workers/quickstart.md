# Quickstart de validación

Esta guía valida la spec sin credenciales reales ni despliegue a proveedores externos. Las pruebas reales de Kestra usan fixtures, servidores SSH locales y datos aislados.

## Prerrequisitos

- Docker Desktop con contenedores Linux o Docker Engine en Linux.
- Node.js 24 y pnpm 11.19.0.
- checkout limpio en la rama de la spec.
- Kestra y fixtures locales solo para las pruebas de contrato.

## Validación estática y de workspace

```powershell
pnpm lint
pnpm build
pnpm infra:config
```

Resultado esperado: el workspace compila, lint pasa con sus warnings conocidos, y los Compose son válidos.

## Build de una imagen

Desde la raíz del repositorio, con `<worker>` el nombre real del primer worker que adopte el mecanismo (por ejemplo `fixture` durante la validación de esta spec):

```powershell
docker build --file workers/Dockerfile --build-arg WORKER=<worker> --tag local/worker-<worker>:test .
docker image inspect local/worker-<worker>:test
```

No se deben incluir `.env`, `.git` ni `node_modules` en el contexto.

## Smoke test

Usar un archivo de entorno local con valores ficticios y ejecutar:

```powershell
docker run --rm --read-only --tmpfs /tmp local/worker-<worker>:test
```

El worker debe terminar con un resultado controlado. Una prueba que requiera proveedor externo debe usar sandbox y credenciales efímeras fuera del repositorio.

## Publicación y rollback

En CI se verifican build, SBOM, provenance y escaneo. La referencia a probar es el digest, no `latest`:

```text
ghcr.io/<owner>/<repository>-worker-<worker>@sha256:<digest>
```

Publicar dos versiones en un registry de prueba, lanzar la segunda desde un flow controlado y volver al digest anterior. El rollback debe modificar solo ese worker.

## Contrato Kestra

1. Levantar Kestra local según `pnpm dev:kestra`.
2. Cargar un flow fixture que use el digest local o un registry de prueba.
3. Verificar parámetros, timeout, cancelación, código de salida y alerta sanitizada.
4. Ejecutar dos veces el mismo `EJECUCION_ID` y comprobar que no duplica resultados.

Validaciones reproducibles sin infraestructura externa, ni siquiera con un worker real ya declarado:

```powershell
pnpm test:workers:discover
pnpm test:workers:idempotency
pnpm test:workers:audit
node infra/kestra/validar-workers-runtime.mjs
```

`pnpm workers:discover` sí requiere al menos un worker real bajo `workers/` — falla intencionalmente si no encuentra ninguno, mismo criterio que documenta `.github/workflows/worker-images.yml` para el job de publicación.

El build Docker local puede requerir salida a `registry.npmjs.org` para
descargar dependencias; si el registry no está disponible, el bloqueo es de
red y no una validación funcional del Dockerfile.

## Validación de seguridad

- inspeccionar usuario y capabilities del contenedor;
- escanear la imagen y bloquear críticas/altas;
- revisar que ningún log contenga secretos de fixtures;
- confirmar que el worker no tiene acceso al Docker socket;
- comprobar que una conexión fuera de la allowlist por worker falla y que los destinos permitidos funcionan;
- comprobar que el registry permite publicar solo al job protegido y extraer a los servidores autorizados.

## Origen y evidencia

Este mecanismo (descubrimiento por contrato, `workers/Dockerfile` parametrizado, workflow de build/scan/publish, runtime endurecido en los flows genérico y dedicado, y los scripts de validación) es un port-back de un patrón ya validado en producción en un producto derivado real: build reproducible, publicación con SBOM/provenance/escaneo bloqueante, ejecución aislada desde Kestra sin fugas de secretos en 100 ejecuciones de fixture, y rollback por digest — todos verificados ahí antes de traer el patrón acá (ver Origen en `spec.md`).

Como el template todavía no declara ningún worker real bajo `workers/`, la validación acá se corrió sin build/publicación de imagen real (no hay `workers/<worker>/package.json` que construir) y sin el recorrido E2E de Kestra con SSH (requiere un worker real y un servidor). El primer producto derivado que declare un worker real completa la validación de build/publicación/Kestra E2E como parte de su propia spec de integración, no de esta.

### Evidencia local al 2026-09-22

Pasaron, contra este checkout:

- `pnpm lint` — sin errores (warnings preexistentes del mismo patrón que el resto del código).
- `pnpm build` — OK.
- `pnpm infra:config` — los 5 Compose válidos.
- `pnpm test:workers:discover` — 3/3 (descubre, rechaza scripts incompletos, rechaza nombre no portable).
- `pnpm test:workers:scan` — 3/3 (bloquea sin excepción, acepta excepción vigente, bloquea excepción vencida).
- `pnpm test:workers:idempotency` — OK, segundo intento marcado `duplicate: true`.
- `pnpm test:workers:egress` — OK, `0 worker(s)` validados (el objeto `workers` de `egress-allowlists.json` arranca vacío en el template).
- `pnpm test:workers:audit` — OK, 2 eventos del fixture de rollback.
- `infra/kestra/validar-workers-runtime.mjs` — OK para los 4 flows bajo `infra/kestra/flows/` (genérico, dedicado y sus variantes).
- `pnpm workers:discover` (sin `--json`) falla con "No se encontraron workers válidos" — comportamiento esperado y documentado, no un bug: el template no tiene ningún worker real todavía.
