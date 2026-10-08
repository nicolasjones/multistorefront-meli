# Quickstart: validar el rename a `automation-platform-template`

No hay `contracts/` para esta feature — no expone ninguna interfaz externa
(API, CLI, etc.), es un rename de proyecto.

## Prerrequisitos

- Docker Desktop corriendo.
- `pnpm install` ya corrido.
- `gh` autenticado (para verificar el repo y el runner).

## 1. Cero referencias al nombre viejo (SC-001)

```powershell
git grep -i "estudio-automation\|estudio contable\|estudio/web" -- . ":(exclude).git"
```

**Resultado esperado**: sin coincidencias (fuera del historial de commits,
que `git grep` sobre el working tree no incluye).

## 2. Los gates de validación siguen pasando (SC-002)

```powershell
pnpm lint
pnpm build
pnpm test
pnpm infra:config
```

**Resultado esperado**: los 4 comandos terminan sin error.

## 3. Los proyectos Docker locales usan el nombre nuevo (US1)

```powershell
pnpm dev:refine; pnpm dev:kestra; pnpm dev:superset; pnpm dev:playwright; pnpm dev:runner
docker ps --format "{{.Names}}"
```

**Resultado esperado**: todos los contenedores muestran el prefijo
`automation-platform-template-*-dev`, ninguno `estudio-automation-*`.

## 4. CI corre en el runner self-hosted renombrado (US3, SC-003)

```powershell
git push origin main
gh run watch --repo Agenmatica/automation-platform-template --exit-status
gh api repos/Agenmatica/automation-platform-template/actions/runners --jq '.runners[] | "\(.name): \(.status)"'
```

**Resultado esperado**: el workflow termina en éxito (los 3 jobs en verde,
menos de 5 minutos), y los 3 runners aparecen `online` sin ningún registro
huérfano bajo el nombre viejo.

## 5. La constitución y CLAUDE.md/AGENTS.md quedan genéricos (US2)

```powershell
git grep -i "contable" .specify/memory/constitution.md
diff <(tail -n +2 CLAUDE.md) <(tail -n +2 AGENTS.md)
```

**Resultado esperado**: el primer comando no devuelve nada; el segundo
muestra que el contenido (salvo el título) es idéntico entre `CLAUDE.md` y
`AGENTS.md`.
