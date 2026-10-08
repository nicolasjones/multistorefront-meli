# Crear un producto derivado

Guía práctica para forkear este template a un producto nuevo. No es una spec
— es documentación de proceso (roadmap, ítem "Creador de productos
derivados"). Se convierte en script más adelante solo si, después de un
segundo o tercer fork real, aparecen pasos mecánicos que se repiten siempre
igual.

Principio de fondo (Constitución, "Un monorepo, despliegues independientes" y
"Simplicidad operativa"): un producto derivado es autónomo — su propio repo,
sus propios secretos, su propio Supabase, su propio ciclo de despliegue. El
template no participa en su operación diaria y no debe terminar con ningún
concepto de dominio del producto.

## 1. Elegir el nombre corto del producto

Se usa como prefijo en nombres de proyecto Compose, `project_id` de Supabase
y el nombre del runner. Ejemplo en este documento: `estudio-contable`.

## 2. Crear el repo

> **Actualización**: La fuente de versión y adopciones es ahora
> [`adoptar-capacidades-template.md`](./adoptar-capacidades-template.md) y el
> manifiesto `template-adoption.json`. Ese registro reemplaza la nota manual de
> commit/tag mencionada en el texto histórico de esta sección.

Fork o copia sin conservar el historial de Git, según convenga. De cualquier
forma, anotar en el README del fork nuevo de qué commit/tag del template
salió — hoy no hay automatización para esto (roadmap, ítem "Versión de
origen"), así que es una línea a mano.

## 3. Renombrar la identidad del producto

Estas son las únicas referencias literales al nombre `automation-platform-template`
que hoy existen en archivos de configuración activos (no en `specs/` viejas,
que son la bitácora del template y no se tocan):

| Archivo | Qué cambiar |
|---|---|
| `package.json` | campo `"name"` (línea 2) y el `--project-id` hardcodeado en el script `dev:down:supabase` |
| `infra/refine/compose.yaml` | `name:` (línea 1) |
| `infra/kestra/compose.yaml` | `name:` (línea 1) |
| `infra/superset/compose.yaml` | `name:` (línea 1) y el default de `SUPABASE_DOCKER_NETWORK` en `networks.supabase.name` (al final): `supabase_network_<project_id nuevo>` — si queda el del template, `pnpm dev:superset` falla porque esa red no existe (ver `docs/operar-superset.md`) |
| `infra/playwright/compose.yaml` | `name:` (línea 1) |
| `infra/runner/compose.yaml` | `name:` (línea 1), y además `RUNNER_REPO` / `RUNNER_NAME` en el bloque `environment:` — `RUNNER_REPO` es el repo de GitHub real contra el que se registra el self-hosted runner; si queda apuntando al del template, el runner de CI de este fork se registra en el repo equivocado. **No** renombrar el volumen `platform-runner-pnpm-store`: compartirlo con el template hace que cada dependencia se descargue una vez por máquina (ver `docs/adoptar-runners-locales.md`) |
| `supabase/config.toml` | `project_id` (línea 5) |
| `infra/runner/entrypoint.mjs` | no hace falta editarlo — `RUNNER_NAME` ya se puede sobreescribir por variable de entorno en vez de tocar el script |
| `docs/architecture.md` | la tabla de "Proyectos Docker locales" queda con los seis nombres nuevos |
| `.specify/memory/constitution.md` (la copia del fork) | Principio IV lista los mismos seis nombres literales — actualizarlos ahí también si el fork sigue usando Spec Kit |

Después de renombrar, `pnpm dev:down:supabase` deja de apuntar al proyecto
correcto si no se edita ese `--project-id` — es el único lugar donde el
nombre del proyecto de Supabase queda repetido fuera de `config.toml`,
junto con el nombre de red de `infra/superset/compose.yaml`.

## 4. Configurar `.env`

Copiar los tres `.env.example` (raíz, `apps/web/`, `supabase/functions/`) a
`.env` y completar valores propios del producto — nunca commitear secretos
reales. Gracias a la spec 015, los puertos de desarrollo local ya son
variables con default: si este fork va a correr en paralelo con el template
o con otro fork en la misma máquina, alcanza con cambiar esos valores (más
`supabase/config.toml`, la única excepción documentada en
`specs/015-puertos-configurables/contracts/variables-puerto.md`) — ya no
hace falta perseguir puertos sueltos por el resto de los archivos.

## 5. Crear los recursos externos reales

Esto no lo automatiza nada: crear el proyecto Supabase (local con
`supabase init`/`supabase start` alcanza para desarrollo; cloud para
staging/producción), el repo en GitHub, y cualquier credencial real
(SMTP, runner de CI, etc.) — cada uno solo en el `.env`/secretos del fork,
nunca en este template.

Configurar también el secreto Actions `TEMPLATE_READ_TOKEN` con un token
Fine-grained de `Contents: Read-only` limitado al repositorio del template. Si
se usa otro repositorio, declararlo como variable Actions `TEMPLATE_REPOSITORY`.
El procedimiento completo está en
[`adoptar-capacidades-template.md`](./adoptar-capacidades-template.md).

## 6. Verificar que el fork arranca igual que el template

```powershell
pnpm install
pnpm infra:config
pnpm lint
pnpm build
pnpm test          # requiere pnpm dev:supabase corriendo
```

Los cuatro deberían pasar sin tocar nada de dominio todavía — son la base
genérica, no el producto.

## 7. Recién ahora, abrir la primera spec de negocio

El template no define el dominio del producto (Constitución, Principio II y
"Límites explícitos" del roadmap). La primera funcionalidad real del fork —
lo que sea que resuelva para su negocio — se especifica con Spec Kit *en el
repo del fork*, no acá.

Si esa funcionalidad integra un sistema externo, usar también la guía
[`docs/disenar-conector.md`](./disenar-conector.md): mantiene las tablas y
reglas de negocio en `dominio` y evita convertir detalles de un proveedor en
una abstracción prematura del template.

## Qué no traer del template

- Nada de `specs/` del template (es su propia bitácora de decisiones, no la
  del producto nuevo).
- Ninguna tabla, regla o flujo de dominio — no existen en el template para
  empezar.
- Ningún secreto real del template (nunca los tuvo commiteados; tampoco el
  fork debería).

## Verificación final

Antes de dar el fork por terminado, confirmar que no quedó ninguna
referencia suelta al nombre del template:

```bash
grep -rn "automation-platform-template" . --exclude-dir=node_modules --exclude-dir=.git
```

Las únicas apariciones esperables después de renombrar son dentro de
`specs/` (la bitácora histórica del template, que el fork puede conservar
como referencia de por qué existe cada mecanismo, o borrar si prefiere
empezar su propia bitácora desde cero).
