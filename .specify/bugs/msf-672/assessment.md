# Bug Assessment: guard de migraciones marca «versión REUSADA» en migraciones legítimas de ramas de épica

- **Slug**: msf-672
- **Created**: 2026-11-01
- **Source**: pasted text (MSF-672, sin URL)
- **Verdict**: valid
- **Severity**: medium

## Report (summarized)

El guard `scripts/verificar-migraciones.mjs` avisa «versión REUSADA: ya existe X o mayor en origin/dokploy» para migraciones legítimas de una rama de épica y obliga a renombrarlas en bucle.

## Symptom

`pnpm docs:check` (que corre el guard) falla con «versión N REUSADA» para migraciones nuevas de una épica cuya versión es menor o igual a la máxima de `origin/dokploy`. Esperado: no reportar falso positivo en migraciones nuevas y únicas de la épica; solo detectar colisiones reales.

## Reproduction

1. Rama de épica con migración nueva `2026XXXX..._x.sql` cuya versión no existe en `origin/dokploy` pero es menor que la máxima de `dokploy` (otras épicas mergearon después de que se reservó la banda).
2. `node scripts/verificar-migraciones.mjs` (base por defecto `origin/dokploy`, sin `GITHUB_BASE_REF`) o `pnpm docs:check` (`validate.yml:107`).
3. Falla con `versión N REUSADA: ya existe <max> o mayor en origin/dokploy`. Al renombrar por encima de `max`, `dokploy` avanza con el siguiente merge y vuelve a fallar (bucle). Evidencia del bucle: renumeraciones repetidas documentadas en `docs/tienda-contacto.md:112-121`, `docs/pagos-conciliacion.md:34-36`, `docs/stock-faltantes.md:12`, `docs/cobros-por-comprobante.md:29`, `docs/contrarreembolsos-transporte.md:27` y `specs/20261024-130000-ventas-despacho-y-faltantes/plan.md:21`.

[NEEDS CLARIFICATION: la épica concreta y el valor de `GITHUB_BASE_REF` del run que falló; no reproducido en vivo.]

## Suspected Code Paths

- `scripts/verificar-migraciones.mjs:48-53` — regla 3: `if (!previo) { if (v <= maxBase) problemas.push('... REUSADA ...') }`. Trata «menor que la máxima de la base» como «reusada», aunque la versión NO exista en la base (no hay colisión real). Es un orden estricto contra una base móvil.
- `scripts/verificar-migraciones.mjs:23-25` — la base por defecto es `origin/dokploy` salvo que exista `GITHUB_BASE_REF`; para una rama de épica fuera de PR (push, local, run del agente) siempre se compara contra `dokploy`, no contra la base real de la épica.
- `scripts/verificar-migraciones.mjs:41` — `maxBase` = máxima versión de la base (ordenada lexicográficamente), sin considerar el merge-base.
- `package.json:72` — `docs:check` ejecuta el guard.
- `.github/workflows/validate.yml:99-107` — contexto CI.

## Root Cause Hypothesis

La regla «VERSIÓN NUEVA» (cabecera, punto 3) exige que toda migración agregada sea mayor que la máxima de la base. Su intención es evitar que una migración quede por debajo de la cola ya aplicada en el entorno (el aplicador no ejecuta versiones anteriores a la última registrada). Pero se implementa como `v <= maxBase` sobre `origin/dokploy` móvil, sin distinguir (a) migraciones heredadas/propias de la épica que no colisionan con ninguna versión de `dokploy`, ni (b) la rama contra la que realmente se mergea. Como `dokploy` avanza con cada épica que mergea, la banda de una épica en curso queda perpetuamente «por debajo» y cada renombre se invalida con el siguiente merge: bucle. Confianza: alta (lectura directa del código y de la documentación del síntoma); sin reproducción ejecutada.

## Proposed Remediation

**Preferred**: separar colisión real de orden. Mantener como `problema` duro: versión duplicada y versión modificada (reglas 1 y 2) y una versión nueva que ya exista en la base con otro nombre. Para la regla 3, no fallar cuando `v` no existe en la base: degradar a `aviso` (o hacerla estricta solo cuando la base es el destino final del merge, es decir `GITHUB_BASE_REF` ∈ {`dokploy`, `main`}/`--estricto`), y comparar contra el `merge-base` solo en el modo estricto. En PR a rama de épica, el orden se verifica contra la épica; el orden definitivo se exige en el PR de la épica a `dokploy`, donde sí se renumera una sola vez. Mensaje del aviso: indicar el riesgo de que el aplicador no ejecute versiones por debajo de la cola aplicada y cómo renombrar al cerrar la épica.

**Alternatives**:
- Resolver la base con `git merge-base HEAD origin/dokploy` y calcular `maxBase` allí: elimina el bucle pero deja pasar migraciones bajo la cola de `dokploy` hasta el merge final (igual que arriba, sin aviso).
- Auto-renombrar al mergear `dokploy` en la épica: más invasivo y toca archivos versionados; descartado.

**Files likely to change**:
- `scripts/verificar-migraciones.mjs`
- `scripts/verificar-migraciones.test.mjs` (nuevo; hoy no existe prueba del guard)
- `docs/` pertinente (p. ej. nota en `docs/pagos-conciliacion.md` o doc de migraciones) y `AGENTS.md`/`CLAUDE.md` si cambia la regla (exigido por `pnpm docs:check`)

**Tests to add or update**:
- Repo git temporal: base con max `V9`; rama con migración nueva `V5` inexistente en base → no es `problema` en modo épica (aviso), sí en modo estricto.
- Versión nueva igual a una existente en base → sigue siendo problema (modificada/duplicada).
- Versión duplicada en el árbol → problema.
- `GITHUB_BASE_REF=epic/...` selecciona la base correcta.

## Risks & Considerations

- Aflojar la regla 3 reintroduce el riesgo original (incidente 2026-10-23): una migración bajo la cola aplicada en dokploy no se aplica nunca. Debe mantenerse la verificación estricta en el PR final hacia `dokploy`.
- Comparación lexicográfica de versiones de longitud variable: conservar la validación de 14 dígitos.
- Cambia el contrato de `docs:check`; documentar en el mismo cambio.

## Open Questions

- [NEEDS CLARIFICATION: ¿el gate estricto debe vivir en el PR de la épica a `dokploy` o en el despliegue (`gate-migraciones-stg-prd`)? Ver `.specify/bugs/gate-migraciones-stg-prd`.]
