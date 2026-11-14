# Bug Assessment: La tienda pública no define su propia regla de inactividad de sesión (hereda la del panel)

- **Slug**: msf-740
- **Created**: 2026-11-14
- **Source**: pasted text (MSF-740, It's a Plan) — sin URL; no aplica la política de URLs (no hay enlace que traer)
- **Verdict**: valid
- **Severity**: low

## Report (verbatim)

> `[Seguimiento MSF-673] Decidir si la tienda pública quiere su propia regla de inactividad de sesión (It's a Plan MSF-740) slug=msf-740`

Contexto del tracker (no viene en el reporte, se reconstruyó del repo):

- Nació como `seguimiento` del cierre de MSF-673: `.specify/bugs/msf-673/fix.md` → «Tarea `seguimiento` MSF-740 (dueño: épica MSF-237 / F-CLI-06): decidir si la tienda quiere regla propia de inactividad».
- Re-parentado a **MSF-515** (épica de deuda) según `data/decisiones/MSF.jsonl`: «un `seguimiento` de review nunca cuelga de la épica origen (BUG-147)».
- La decisión de MSF-673 (`data/decisiones/MSF.jsonl`) quedó APROBADA con este alcance: «instalar el seguimiento de inactividad (`seguirActividad`) solo cuando el host NO es de tienda pública; en hosts de tienda no se redirige a `/login` ni se cierra la sesión del cliente por la lógica del panel (si hace falta cerrar sesión, usar el cierre local de la tienda)».
- Hay una nota de aprendizaje que quedó desactualizada respecto de la base actual: «una sesión de cliente de la tienda (épica MSF-673/MSF-237) no vence por inactividad» (`data/aprendizaje/MSF.jsonl`), pero la implementación vigente (MSF-700) sí cierra la sesión local a las 12 h. Ver «Open Questions».

## Symptom

La tienda pública hoy **no tiene regla propia**: hereda sin decidir la regla de inactividad del panel (12 h, constante única `INACTIVIDAD_MAXIMA_MS`) porque el control se instala en el arranque común (`main.tsx`) para todo host. Consecuencias observables: (a) cualquier visitante —incluido uno anónimo que nunca tuvo sesión— escribe la marca `sesion:ultima-actividad` en cada clic y, al volver tras más de 12 h, su primer clic dispara un cierre de sesión local y una navegación dura a `/`, descartando la página en la que estaba; (b) un cliente de la tienda con sesión abierta pierde su sesión local y vuelve a la portada **sin aviso**, y no tiene forma de evitarlo porque la casilla «Mantener la sesión» solo existe en el panel; (c) no existe ningún punto de configuración por tienda (ni columna en `dominio.tiendas` ni parámetro en el front público).

Esperado (lo que hay que decidir y dejar escrito): una regla explícita para la tienda —propia o heredada deliberadamente— con comportamiento verificable y documentado.

## Reproduction

1. Compilar el front con `VITE_PANEL_HOSTS` definido (si no, el host se sirve como panel y el caso no aplica) y abrir un host de tienda, por ejemplo `mundojc.localhost`.
2. Hacer un clic o pulsar una tecla → el arranque escribe `sesion:ultima-actividad` en el `localStorage` del dominio de la tienda (aunque el visitante sea anónimo).
3. Esperar más de 12 h (o adelantar esa clave 13 h con un init script, como hace el E2E existente).
4. Hacer el primer clic → se ejecuta `salirCliente()` (`signOut` con `scope: 'local'`) y `window.location.assign('/')`: el visitante anónimo vuelve a la portada de la tienda aunque estuviera en una ficha de producto; el cliente con sesión abierta queda deslogueado sin aviso.

Mecánica de reproducción tomada del E2E ya existente `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` (init script + primer clic); verificada por lectura de código, **sin ejecutar** en esta assessment.

- [NEEDS CLARIFICATION: qué debe pasar exactamente al vencer en la tienda: volver a `/`, quedarse en la misma página con un aviso, o no cerrar nada.]
- [NEEDS CLARIFICATION: si la tienda debe tener una ventana distinta de 12 h, si no debe tener regla propia, o si debe poder configurarse por tienda.]

## Suspected Code Paths

- `apps/web/src/main.tsx:28-42` — `seguirActividad(...)` se instala **para todo host**; la rama de tienda hace `salirCliente()` (scope local) y `window.location.assign('/')`. Es el único punto donde se decide qué hacer al vencer.
- `apps/web/src/lib/vencimientoSesion.ts:4` — `INACTIVIDAD_MAXIMA_MS = 12 h`: constante única, compartida entre panel y tienda, sin variantes por producto ni por tienda.
- `apps/web/src/lib/vencimientoSesion.ts:10-12,31-46` — `registrarActividad` escribe la marca en cada `pointerdown`/`keydown` aunque no haya sesión; `sesionVencidaPorInactividad` solo mira la marca (no sabe si existe una sesión) → en la tienda se dispara el vencimiento aunque nadie haya iniciado sesión.
- `apps/web/src/lib/tiendaCuenta.ts:34-38,75-77` — `salirCliente` → `cerrarSesion`: `olvidirEnlace()` + `supabaseClient.auth.signOut({ scope: 'local' })`. Con una sesión ausente, `signOut` devuelve error de «sesión ausente» y queda el `console.error` de `tiendaCuenta`.
- `apps/web/src/lib/tienda.ts:35-38` — `esHostDeTienda` es lo único que separa panel de tienda hoy.
- `apps/web/src/lib/supabase.ts:54-72` — la preferencia «mantener la sesión» (`sesion:mantener`) solo la fija el ingreso del panel (`authProvider.login`); en la tienda nunca se pone, así que la sesión vive en `sessionStorage` y además vence a las 12 h.
- `apps/web/src/pages/tienda-publica/rutas/ingresar.tsx:40-58` — el ingreso de la tienda no ofrece «Mantener la sesión»: el cliente no tiene forma de extender su sesión.
- `supabase/migrations/20261023100000_tiendas_dominio.sql:66-84` — `dominio.tiendas` no tiene columna de regla de sesión, y `publico.tienda_por_dominio` (`apps/web/src/lib/tienda.ts:51-56`) solo devuelve `tienda_id`, `empresa_nombre`, `estado` → no hay punto de configuración por tienda para el front público.
- `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts:56-68` — el E2E **fija hoy** el comportamiento vigente: no `/login`, sin revocación global, 404 ausente y destino `/`. Cualquier cambio de regla tiene que revisar esta aserción.
- `docs/tiendas-online.md:155-158` y `docs/acceso-ingreso.md:160` — el comportamiento vigente está documentado («las 12 h de inactividad rigen también en la tienda, pero sin ir a `/login`»), o sea: la tienda ya está atada a la regla del panel y el documento lo asume como decisión.
- Especificaciones: `specs/20261012-140000-acceso-y-organizacion/spec.md:35,134` (FR-009 / S4: 12 h — regla **del panel**) y `specs/20261022-084830-tienda-dominio-e-identidad/spec.md:70,153` (FR-007: front público «sin sesión») y `specs/20261024-051500-cuenta-web-del-cliente/spec.md:176-180` (F-CLI-06, FR-020…FR-025) — ninguna spec de tienda define una regla de inactividad: hoy la tienda la hereda por sideways, no por requisito.

## Root Cause Hypothesis

El vencimiento por inactividad se diseñó como una regla **del panel** (FR-009 de la épica de acceso, evaluada en el cliente porque GoTrue no tiene `inactivity_timeout` por plan) y su implementación quedó en el arranque común de la app (`main.tsx`) con una constante compartida (`vencimientoSesion.ts`), de modo que corre también en la tienda pública, que no la pidió en ninguna spec. MSF-673 cerró el síntoma (no `/login`, sin revocación global) y MSF-700 resolvió el caso en una sola de las dos lecturas queadmite la decisión aprobada: en la tienda el vencimiento cierra solo la sesión local y vuelve a `/`. La otra lectura aprobada («instalar `seguirActividad` solo cuando el host NO es de tienda pública») nunca se implementó. El resultado es que la tienda quedó atada a una regla del panel, con daños colaterales que nadie especificó: al visitante anónimo (sin sesión nunca) se le redirige a `/` y se le intenta cerrar una sesión que no existe, y al cliente con sesión se le desloguea en silencio sin opción de «mantener la sesión» (la casilla solo existe en el panel). Ése es exactamente el punto que MSF-740 debe decidir. Confianza: **alta** en la lectura del código (el recorrido está totalmente determinado por el código y reproducing el E2E existente; no ejecutado en esta assessment); **media** en la intención de producto (la decisión misma es lo que MSF-740 pide).

## Proposed Remediation

El ítem es una decisión de producto con una corrección de código que no depende de ella. Conviene separar las dos cosas.

**Preferred** — (1) *Decidir y registrar* la regla de la tienda, y (2) *corregir el daño colateral* que ninguna opción necesita conservar.

1. **Decisión recomendada**: la tienda **hereda la ventana de 12 h pero solo la aplica si hay sesión de cliente**; un visitante sin sesión nunca ve un cierre de sesión ni una redirección. Se mantiene la intención de seguridad de FR-009 (nadie queda con una sesión viva en un equipo compartido tras 12 h) sin penalizar a quien nunca tuvo sesión, y no requiere esquema ni configuración nueva. Queda escrito en el tracker (MSF-740/MSF-515), en la spec de la tienda y en `docs/`.
2. **Código (contingente a la decisión)**: en `apps/web/src/main.tsx` no instalar el seguimiento en host de tienda; en la tienda, al vencer, cerrar la sesión **solo si existe** (`supabaseClient.auth.getSession()`), con cierre local (`scope: 'local'`), y **navegar solo si había sesión**. El visitante anónimo no se redirige.

**Alternatives** (con su trade-off):

- **A · Sin regla propia en la tienda**: no instalar `seguirActividad` en hosts de tienda; la sesión del cliente muere con la pestaña (`sessionStorage`) y con el tope de 30 días del servidor (`[auth.sessions] timebox = 720h`). Trade-off: en un equipo compartido la sesión queda viva hasta que se cierra la pestaña (seguridad más floja que en el panel), y hay que corregir `docs/tiendas-online.md`, `docs/acceso-ingreso.md`, el E2E y la nota de aprendizaje que hoy dice lo contrario. Es la opción que más se acerca a la lectura literal de la decisión aprobada de MSF-673.
- **B · Regla configurable por tienda**: columna en `dominio.tiendas` (por ejemplo `minutos_inactividad_sesion`, `null` = hereda) expuesta al front público por `publico.tienda_por_dominio` (ejecutable por `anon`). Trade-off: es funcionalidad nueva (no un fix): exige spec de Spec Kit con DER + RLS + docs +, si se configura desde el panel, pantalla; superficie y costo muy por encima del problema, salvo que el negocio pida explicitamente que cada tienda elija su ventana.
- **C · No cambiar nada y solo documentar**: registrar la decisión «la tienda hereda 12 h» y corregir la nota de aprendizaje desactualizada. Trade-off: conserva el daño colateral (redirección del anónimo, cierre de sesión sin aviso, cliente sin «mantener sesión»).

**Files likely to change** (ruta preferida):

- `apps/web/src/main.tsx`
- `apps/web/src/lib/vencimientoSesion.ts` (si la decisión es no escribir la marca en la tienda o permitir otra ventana)
- `apps/web/src/lib/tiendaCuenta.ts` (si el cierre queda condicionado a que exista sesión)
- `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` (la aserción `pathname === '/'` refleja la regla vigente: hay que revisarla con la decisión)
- `docs/tiendas-online.md`, `docs/acceso-ingreso.md` (y `pnpm docs:check`)
- Opción B solamente: `supabase/migrations/<timestamp>_tiendas_regla_inactividad.sql`, `apps/web/src/lib/tienda.ts`, la RPC `publico.tienda_por_dominio` y su test pgTAP

**Tests to add or update**:

- Vitest: host de tienda + marca vencida + **sin** sesión → no se llama `signOut` ni `window.location.assign`.
- Vitest: host de tienda + marca vencida + **con** sesión → `signOut` con `scope: 'local'` (sin revocación global) y el destino que fije la decisión.
- Vitest `apps/web/src/lib/vencimientoSesion.test.ts`: si la decisión es no seguir la actividad en la tienda, la marca no se escribe en host de tienda.
- E2E `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts`: ajustar al comportamiento decidido (mantener las aserciones de MSF-673: sin `/login`, sin 404, sin revocación global).
- Opción B: pgTAP de la columna nueva y de su RLS, y Vitest de la lectura por RPC.

## Risks & Considerations

- **No debilitar el panel**: FR-009 / S4 (`specs/20261012-140000-acceso-y-organizacion/spec.md:35,134`) debe quedar idéntico en hosts de panel; el E2E `tienda-sesion-vencimiento` y los tests de `authProvider` cubren esa parte.
- **Cerrar vs. revocar**: el cierre de la tienda debe seguir siendo local (`scope: 'local'`); una revocación global desde la tienda cerraría la sesión de la misma cuenta en el panel (origen del defecto de MSF-673).
- **Ruido en consola**: con la opción preferida, `salirCliente()` sin sesión devuelve «sesión ausente» y deja `console.error('tiendaCuenta: no se pudo cerrar la sesión')`; conviene no llamar al cierre cuando no hay sesión.
- **Documentación**: `pnpm docs:check` exige que `docs/tiendas-online.md` y `docs/acceso-ingreso.md` reflejen la regla decidida; además hay que corregir la nota de `data/aprendizaje/MSF.jsonl` que afirma que la sesión de cliente de la tienda no vence por inactividad (hoy sí, a nivel local, por MSF-700).
- **Proceso**: si la decisión termina siendo «regla configurable por tienda» (opción B), deja de ser un bug y pasa a ser funcionalidad → requiere spec de Spec Kit (con `## Modelo de datos (DER)`, RLS y documentación), no un fix de bug. El ítem ya está re-parentado a MSF-515 (épica de deuda), que es donde corresponde registrar el acuerdo.
- **Tope del servidor**: el `timebox = 720h` de `[auth.sessions]` aplica a cualquier sesión de Auth, incluida la del cliente de la tienda; ninguna opción de MSF-740 lo cambia.

## Open Questions

- [NEEDS CLARIFICATION: ¿cuál es la regla de la tienda? (a) heredar 12 h solo con sesión abierta; (b) sin regla propia (la sesión muere con la pestaña + tope de 30 días); (c) configurable por tienda. Si es (c), ¿quién la fija —el panel, el equipo técnico— y con qué rango de valores?]
- [NEEDS CLARIFICATION: al vencer en la tienda, ¿a dónde va el visitante: a `/` (como fija hoy el E2E), a la misma página con un aviso de «tu sesión se cerró», o a otra pantalla?]
- [NEEDS CLARIFICATION: ¿la tienda debe ofrecer «Mantener la sesión iniciada» como el panel? Hoy no hay casilla en `/ingresar` y la preferencia solo la fija el ingreso del panel.]
- [NEEDS CLARIFICATION: la nota de aprendizaje afirma que la sesión de cliente de la tienda no vence por inactividad, pero el código y la documentación dicen que sí (cierre local a las 12 h, MSF-700). ¿Cuál de las dos es la intención vigente?]
- [NEEDS CLARIFICATION: ¿la tienda pública debe registrar el rastro de sesión (`sesion:ultima-actividad`) en el `localStorage` del dominio del visitante, aunque sea anónimo?]
