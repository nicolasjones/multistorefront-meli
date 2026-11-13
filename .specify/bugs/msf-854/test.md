# Bug Test: Pasos manuales de infraestructura pendientes (MSF-854)

- **Slug**: msf-854
- **Tested**: 2026-11-13 (devolución del Revisor sobre el PR #913: 2026-11-13)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified (parcial en lo que no se puede ejecutar desde el repo)

## Summary

Los cuatro pasos de MSF-854 quedan escritos en `docs/pasos-manuales-vps2.md` con su
respaldo, su verificación y su reversión, y un test fijo los comandos para que la
página no se desvíe. Lo que **no** se puede verificar desde el repo es la ejecución en
el VPS2 (sin clave SSH) ni el estado de los ambientes: eso queda con las verificaciones
que la página le da a Nicolás.

La devolución del Revisor sobre el PR #913 añadió tres comprobaciones al test: que los
enlaces internos de la página existan **también en `main`** (el origen del sitio: un
enlace que no exista ahí rompe `mkdocs build --strict` y el paso 1 no se puede
ejecutar), que el *drop-in* del paso 2 declare `TimeoutStartSec` (sin eso systemd corta
la espera a los 90 s) y que el paso 3 diga cómo se recrea el stack.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Test nuevo de la historia | `pnpm test:docs:pasos-manuales` | pass | 11/11. Además queda en el job `application` del CI (`validate.yml`), que no llama a `pnpm test` entero. |
| El test nuevo falla con el enlace roto | se volvió a poner `[ayuda-en-panel.md](ayuda-en-panel.md)` y se corrió el test | fail (esperado) | `AssertionError: enlace roto en main: rompe el build estricto del sitio (ayuda-en-panel.md)`; con el enlace fuera, 11/11. |
| Tests de documentación vecinos | `pnpm test:docs:check` · `pnpm test:docs:importaciones` | pass | 4/4 y 3/3. |
| Documentación del cambio | `pnpm docs:check` | pass | «Documentación de cambios: OK»; «Migraciones OK» (0 migraciones nuevas). |
| Lint | `pnpm lint` | pass | exit 0; los warnings son preexistentes de `apps/web` (no tocado). |
| Build | `pnpm build` | pass | exit 0. |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack en ok; gitleaks no corrió (sin socket de Docker en esta máquina): lo corre el job `quality` del CI. |
| Pasos del runbook contra el ambiente | `curl https://supabase-{dev,stg,prd}.212-90-120-53.sslip.io/functions/v1/…` | pass | dev: `api-v1/v1/openapi.json` → 200, `entregar-webhook` y `cotizacion-sugerida` → 401; stg y prd → `Function not found`. Es el estado que la página documenta. |
| Publicación del sitio de docs | `curl -I https://docs.212-90-120-53.sslip.io/producto/` | pass | 401 (`basicAuth`): el sitio sigue con las credenciales, como espera la página. |
| Build del sitio desde `main` | `git ls-tree origin/main docs/` | pass | `docs/ayuda-en-panel.md` **no existe en `main`** (allí es `docs/producto/ayuda.md`): por eso el enlace se quitó. `docs/deployment.md`, el único enlace que queda, sí existe en `main`. |
| Ejecución de los pasos en el VPS2 | `ssh root@212.90.120.53 true` | not-run | `Permission denied (publickey,password)`: sin acceso remoto, los cuatro pasos quedan para Nicolás. |
| Revocación de la clave de prueba | — | not-run | Requiere la sesión de un administrador de la organización; no hay credenciales. La verificación queda escrita en la página. |

## Output Excerpts

```
$ pnpm test:docs:pasos-manuales
ℹ tests 11
ℹ pass 11
ℹ fail 0

$ pnpm docs:check
Documentación de cambios: OK (65 archivos comparados contra HEAD~1).
Migraciones OK: 638 archivo(s), 0 nuevo(s) contra origin/dokploy.

$ ssh root@212.90.120.53 true
root@212.90.120.53: Permission denied (publickey,password).

$ curl -sS https://supabase-dev.212-90-120-53.sslip.io/functions/v1/api-v1/v1/openapi.json | head -c 60
{"openapi":"3.1.0","info":{"title":"API pública de la plataforma"...
$ curl -sS https://supabase-stg.212-90-120-53.sslip.io/functions/v1/api-v1/v1/openapi.json
Function not found
```

## Residual Risks

- Los cuatro pasos **siguen pendientes**: esta entrega deja el procedimiento y su
  verificación, no la ejecución. Nadie debe leer el merge como «ya se hizo».
- El *workdir* del ambiente de dev hay que confirmarlo en el VPS2 (`ls -d /root/supabase-*`):
  el runbook da el patrón que usan `/root/supabase-stg` y `/root/supabase-prd`, no el
  nombre exacto del de dev.
- La página se arma desde `main`: hasta que llegue a `main` y se agregue al `nav` de
  `mkdocs.yml`, no aparece en el sitio publicado (y el sitio publicado es justamente el
  paso 1).
- El estado de stg y prd (`Function not found`) no se arregla con esta historia.

## Recommendation

Cerrar la historia **con la salvedad explícita**: lo que se entrega es el runbook y su
verificación (test en verde); los cuatro pasos quedan para Nicolás y se cierran cuando
cada verificación de la página dé lo esperado. Si se quiere que el PR espere a esa
ejecución, que se marque como pendiente en el tracker en lugar de dar la historia por
terminada.
