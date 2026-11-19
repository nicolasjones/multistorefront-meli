# Bug Assessment: La tienda pública no define su propia regla de inactividad de sesión (hereda la del panel)

- **Slug**: msf-740
- **Created**: 2026-11-14
- **Source**: pasted text (MSF-740, It's a Plan) — sin URL; no aplica la política de URLs (no hay enlace que traer)
- **Verdict**: valid
- **Severity**: low

## Report (verbatim)

> `[Seguimiento MSF-673] Decidir si la tienda pública quiere su propia regla de inactividad de sesión (It's a Plan MSF-740) slug=msf-740`

Contexto del tracker (no viene en el reporte, se reconstruyó del repo):

- Nació como `seguimiento` del cierre de MSF-673: `.specify/bugs/msf-673/fix.md` → «Tarea `seguimiento` MSF-740: decidir si la tienda quiere regla propia de inactividad».
- Re-parentado a **MSF-515** (épica de deuda) por la decisión del tracker: «un `seguimiento` de review nunca cuelga de la épica origen (BUG-147)».
- La decisión de MSF-673 (tracker) quedó APROBADA con este alcance: «instalar el seguimiento de inactividad (`seguirActividad`) solo cuando el host NO es de tienda pública; en hosts de tienda no se redirige a `/login` ni se cierra la sesión del cliente por la lógica del panel (si hace falta cerrar sesión, usar el cierre local de la tienda)».
- Hay una nota de aprendizaje del tracker que quedó desactualizada respecto de la base actual: «una sesión de cliente de la tienda (épica MSF-673/MSF-237) no vence por inactividad», pero la implementación vigente (MSF-700) sí cierra la sesión local a las 12 h. Ver «Open Questions».

## Symptom

La tienda pública hoy **no tiene regla propia**: hereda sin decidir la regla de inactividad del panel (12 h, constante única `INACTIVIDAD_MAXIMA_MS`) porque el control se instala en el arranque común (`main.tsx`) para todo host. Consecuencias observables, tal como funcionan hoy:

(a) **El visitante anónimo escribe la marca `sesion:ultima-actividad` en cada clic** (aunque nunca tuvo sesión) y, al volver tras más de 12 h, su primer clic dispara el vencimiento: se intenta cerrar una sesión que no existe (el cierre local no tiene efecto ni error: `signOut` con `scope: 'local'` y sin sesión guardada resuelve sin error) y se hace una **navegación dura a `/`**, que descarta la página en la que estaba.

(b) **La tienda queda en un bucle de recargas.** La marca vencida no se renueva (`seguirActividad` avisa del vencimiento y vuelve sin registrar actividad) y el cierre de la tienda no la borra (`cerrarSesion` no llama a `limpiarRastroDeSesion`, que sí usa el cierre del panel): cada clic posterior vuelve a disparar el cierre y `window.location.assign('/')`. El visitante que vuelve tras 12 h no puede navegar por la tienda —cada clic lo devuelve a la portada— hasta que se borre la marca.

(c) **El cliente con sesión abierta pierde su sesión local y vuelve a la portada sin aviso**, y no tiene forma de evitarlo: la casilla «Mantener la sesión» solo existe en el panel.

(d) **No existe ningún punto de configuración por tienda** (ni columna en `dominio.tiendas` ni parámetro en el front público).

Esperado (lo que hay que decidir y dejar escrito): una regla explícita para la tienda —propia o heredada deliberadamente— con comportamiento verificable y documentado, que no deje al visitante en un bucle de recargas. **Decidido y aplicado (opción (c))**: la tienda no tiene regla propia; su sesión termina por salida explícita o por el tope de 30 días del servidor, y el visitante no ve cierre ni redirección.

## Reproduction

1. Compilar el front con `VITE_PANEL_HOSTS` definido (si no, el host se sirve como panel y el caso no aplica) y abrir un host de tienda, por ejemplo `mundojc.localhost`.
2. Hacer un clic o pulsar una tecla → el arranque escribe `sesion:ultima-actividad` en el `localStorage` del dominio de la tienda (aunque el visitante sea anónimo).
3. Esperar más de 12 h (o adelantar esa clave 13 h con un init script, como hace el E2E existente).
4. Hacer el primer clic → se ejecuta `salirCliente()` (`signOut` con `scope: 'local'`; sin sesión no hay error ni efecto) y `window.location.assign('/')`: el visitante anónimo vuelve a la portada de la tienda aunque estuviera en una ficha de producto; el cliente con sesión abierta queda deslogueado sin aviso.
5. Volver a hacer clic (en la portada, ya recargada) → la marca vencida sigue ahí → el mismo cierre y la misma recarga a `/`: el visitante queda en un bucle de recargas y no puede navegar por la tienda.

Mecánica de reproducción tomada del E2E ya existente `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` (init script + primer clic); verificada por lectura de código, **sin ejecutar** en esta assessment.

- Resuelta: al vencer no pasa nada en la tienda; no cierra la sesión ni redirige (ver `fix.md`, opción (c)).
- Resuelta: la tienda no tiene regla propia de inactividad ni ventana configurable (ver `fix.md`, opción (c)); la variante con regla propia queda como decisión de producto futura.

## Suspected Code Paths

- `apps/web/src/main.tsx:31-42` — `seguirActividad(...)` se instala **para todo host**; la rama de tienda hace `salirCliente()` (scope local) y `window.location.assign('/')`. Es el único punto donde se decide qué hacer al vencer.
- `apps/web/src/lib/vencimientoSesion.ts:4` — `INACTIVIDAD_MAXIMA_MS = 12 h`: constante única, compartida entre panel y tienda, sin variantes por producto ni por tienda.
- `apps/web/src/lib/vencimientoSesion.ts:10-12,31-46` — `registrarActividad` escribe la marca en cada `pointerdown`/`keydown` aunque no haya sesión; `sesionVencidaPorInactividad` solo mira la marca (no sabe si existe una sesión) → en la tienda se dispara el vencimiento aunque nadie haya iniciado sesión. Al vencer **no renueva la marca** (`:35-38`): de ahí el paso 5 de la reproducción.
- `apps/web/src/lib/tiendaCuenta.ts:34-38,75-77` — `salirCliente` → `cerrarSesion`: `olvidirEnlace()` + `supabaseClient.auth.signOut({ scope: 'local' })`. Con `@supabase/auth-js@2.115.0` (la versión que fija `@supabase/supabase-js@2.115.0`, `pnpm-lock.yaml`) **sin sesión guardada el cierre resuelve sin error**: `GoTrueClient.__loadSession` devuelve `{session: null, error: null}` y `_signOut` solo devuelve error cuando el error de sesión no es «session missing» (`node_modules/.pnpm/@supabase+auth-js@2.115.0/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`). El daño colateral, entonces, **no es un `console.error`**: es la navegación.
- `apps/web/src/providers/authProvider.ts:165-188` — el cierre del panel sí limpia la marca (`limpiarRastroDeSesion`), por eso el panel no entra en el bucle de recargas y la tienda sí.
- `apps/web/src/lib/tienda.ts:35-38` — `esHostDeTienda` es lo único que separa panel de tienda hoy.
- `apps/web/src/lib/supabase.ts:36-72` — la preferencia «mantener la sesión» (`sesion:mantener`) solo la fija el ingreso del panel (`authProvider.login`); en la tienda nunca se pone, así que la sesión vive en `sessionStorage` (muere con la pestaña) y además vence a las 12 h.
- `apps/web/src/pages/tienda-publica/rutas/ingresar.tsx:37-49` — el ingreso de la tienda no ofrece «Mantener la sesión»: el cliente no tiene forma de extender su sesión. (Y si se agregara: «mantener» exime de las 12 h y deja la sesión en `localStorage`, o sea viva en un equipo compartido hasta la salida explícita o el tope de 30 días.)
- `supabase/migrations/20261023100000_tiendas_dominio.sql:66-84` — `dominio.tiendas` no tiene columna de regla de sesión, y `publico.tienda_por_dominio` (`apps/web/src/lib/tienda.ts:47-57`) solo devuelve `tienda_id`, `empresa_nombre`, `estado` → no hay punto de configuración por tienda para el front público.
- `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts:57-70` — el E2E **fija hoy** el comportamiento vigente: no `/login`, sin revocación global, 404 ausente y destino `/`. Cualquier cambio de regla tiene que revisar esta aserción.
- `docs/tiendas-online.md:155-158` y `docs/acceso-ingreso.md:160` — el comportamiento vigente está documentado («las 12 h de inactividad rigen también en la tienda, pero sin ir a `/login`»), o sea: la tienda ya está atada a la regla del panel y el documento lo asume como decisión.
- Especificaciones: `specs/20261012-140000-acceso-y-organizacion/spec.md:35,134` (FR-009 / S4: 12 h — regla **del panel**) y `specs/20261022-084830-tienda-dominio-e-identidad/spec.md:70,153` (FR-007: front público «sin sesión») y `specs/20261024-051500-cuenta-web-del-cliente/spec.md:176-180` (F-CLI-06, FR-020…FR-025) — ninguna spec de tienda define una regla de inactividad: hoy la tienda la hereda por sideways, no por requisito.

## Root Cause Hypothesis

El vencimiento por inactividad se diseñó como una regla **del panel** (FR-009 de la épica de acceso, evaluada en el cliente porque GoTrue no tiene `inactivity_timeout` por plan) y su implementación quedó en el arranque común de la app (`main.tsx`) con una constante compartida (`vencimientoSesion.ts`), de modo que corre también en la tienda pública, que no la pidió en ninguna spec. MSF-673 cerró el síntoma (no `/login`, sin revocación global) y MSF-700 resolvió el caso en una sola de las dos lecturas que admite la decisión aprobada: en la tienda el vencimiento cierra solo la sesión local y vuelve a `/`. La otra lectura aprobada («instalar `seguirActividad` solo cuando el host NO es de tienda pública») nunca se implementó. El resultado es que la tienda quedó atada a una regla del panel, con daños colaterales que nadie especificó: al visitante anónimo (sin sesión nunca) se le manda a `/` con una recarga dura, y además la tienda entra en un bucle de recargas (la marca vencida no se renueva ni se borra) que le impide navegar; al cliente con sesión se le desloguea en silencio sin opción de «mantener la sesión» (la casilla solo existe en el panel). Ése es exactamente el punto que MSF-740 debe decidir. Confianza: **alta** en la lectura del código (el recorrido está totalmente determinado por el código y el E2E existente; no ejecutado en esta assessment); **media** en la intención de producto (la decisión misma es lo que MSF-740 pide).

## Proposed Remediation

El ítem es una decisión de producto con una corrección de código que no depende de ella. Conviene separar las dos cosas.

**Taxonomía de opciones** (la misma en `fix.md`):

| Opción | Regla de la tienda | A quién se aplica |
|---|---|---|
| **(a)** | Regla propia: 12 h como el panel y redirección a `/ingresar` | a quien tenga sesión |
| **(b)** | Regla propia con otro criterio (las horas que indique el decisor + si lleva «mantener sesión») | a quien tenga sesión |
| **(c)** | Sin regla propia: la sesión termina por salida explícita o por el tope de 30 días del servidor | — |
| **(d)** | Regla propia **condicionada a que haya sesión**: 12 h heredadas del panel, aplicadas solo si hay sesión de cliente | solo a quien tenga sesión |

**Decisión aplicada: opción (c) — la tienda NO tiene regla propia.** No es una decisión nueva: es la que ya está
escrita en el tracker. La evidencia, en el mismo tracker y en el repo:

1. El alcance **aprobado de MSF-673** (citado arriba, textual): «instalar el seguimiento de inactividad
   (`seguirActividad`) solo cuando el host NO es de tienda pública». La tienda pública quedó atada a la regla del
   panel por una implementación a medias (MSF-700), no por una decisión.
2. La **nota de aprendizaje** del tracker: «una sesión de cliente de la tienda (épica MSF-673/MSF-237) no vence
   por inactividad». Con MSF-700 esa nota quedó desactualizada; el código es el que se apartó de la decisión.
3. La **descripción de MSF-740** (el texto de este ítem): «la sesión de un cliente con cuenta web termina solo
   por salida explícita o por el tope de 30 días del servidor».

Las opciones (a), (b) y (d) sí serían una decisión **nueva** de producto (qué ventana, a dónde redirigir, si
«mantener sesión»): el CTO las reservó para Nicolás («Si no hay respuesta: la tarea queda en `Blocked`, no se
abre spec ni se implementa nada»), y la opción (b) con ventana por tienda deja de ser un fix y pasa a ser
funcionalidad (spec de Spec Kit con DER, RLS y documentación).

**Código (de la opción (c)):**

- `apps/web/src/main.tsx`: el control de vencimiento **no se instala en un host de tienda**. Con eso:
  - el visitante anónimo no ve cierre de sesión ni redirección (y no escribe la marca de actividad);
  - el cliente con sesión conserva su sesión (la corta el «Salir» de la tienda o el tope de 30 días del servidor);
  - desaparece el bucle de recargas a `/` (era consecuencia de la marca vencida que no se renueva ni se borra);
  - el panel queda **idéntico**: 12 h sin actividad → cierre global → `/login` (FR-009 / S4).
- La regla se mueve a `apps/web/src/lib/arranqueSesion.ts` para que quede **verificable** (antes vivía en
  `main.tsx`, que no se testea): el módulo decide si instala el control y es el que el Vitest ejercita.
- Documentación: `docs/tiendas-online.md`, `docs/acceso-ingreso.md`, `docs/e2e-app.md` y la decisión D-11 de la
  spec de la épica (`specs/20270323-100000-deuda-tecnica-lote-1-seguridad-tienda/spec.md`).

**Alternativas** (con su trade-off) — las que NO son la aplicada:

- **(a) · Regla propia como el panel** (12 h + redirección a `/ingresar`): cambia el destino de la tienda (hoy `/`) y necesita una ruta de reingreso propia (`/ingresar`, no `/login`). Trade-off: es la opción más estricta; si no se condiciona como en (d), también manda al visitante anónimo (que nunca tuvo sesión) a `/ingresar`.
- **(b) · Regla propia con otro criterio**: lo de (a) más las horas que indique el decisor y, si corresponde, la casilla «mantener sesión» en `ingresar.tsx` y `lib/supabase.ts` (`setMantenerSesion`). **Ojo con el significado de «mantener sesión»**: exime del vencimiento de 12 h y deja la sesión en `localStorage`, o sea que en un equipo compartido queda viva hasta la salida explícita o el tope de 30 días del servidor. Si además la ventana fuera **por tienda** (cada una elige la suya), eso ya no es un fix: exige columna en `dominio.tiendas`, RLS, lectura por `publico.tienda_por_dominio` y pgTAP → una spec de Spec Kit nueva (con `## Modelo de datos (DER)` + docs) y, si se configura desde el panel, una pantalla (y el prototipo del ingreso de la tienda tendría que mostrar la casilla: hoy no la tiene).
- **(d) · 12 h heredadas, solo si hay sesión**: conserva la intención de seguridad de FR-009 para el cliente con sesión (nadie queda con una sesión viva en un equipo compartido tras 12 h) y evita penalizar al anónimo. Trade-off: **es una decisión de producto nueva** (la tienda pasa a tener una ventana propia que el tracker nunca aprobó) y el cierre por inactividad del cliente necesita un aviso y un destino, que tampoco están decididos.

**Files likely to change** (ruta aplicada):

- `apps/web/src/lib/arranqueSesion.ts` (nuevo): la regla, en un módulo verificable.
- `apps/web/src/main.tsx`: el arranque delega la decisión.
- `apps/web/src/lib/arranqueSesion.test.ts` (nuevo): Vitest de las dos ramas.
- `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts`: el E2E afirmaba el destino `/` de la tienda; ahora afirma que no hay cierre ni redirección.
- `docs/tiendas-online.md`, `docs/acceso-ingreso.md`, `docs/e2e-app.md` y la decisión D-11 de la spec de la épica.
- Nada de base de datos: sin migración, sin RPC, sin cambio de esquema.

**Tests to add or update**:

- Vitest `apps/web/src/lib/arranqueSesion.test.ts`: en la tienda, tras 12 h, el clic **no** cierra la sesión ni navega, y la tienda **no** escribe la marca de actividad; en el panel, tras 12 h, el clic cierra la sesión y vuelve a `/login`, y la actividad reciente renueva la marca.
- E2E `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts`: el visitante que vuelve tras 13 h **no** sale de la página, no hay pedido a `/auth/v1/logout` (ni local ni global) y no aparece el 404 de `/login` (se conservan las garantías de MSF-673).

## Risks & Considerations

- **No debilitar el panel**: FR-009 / S4 (`specs/20261012-140000-acceso-y-organizacion/spec.md:35,134`) debe quedar idéntico en hosts de panel; el E2E `tienda-sesion-vencimiento` y los tests de `authProvider` cubren esa parte.
- **Cerrar vs. revocar**: el cierre de la tienda debe seguir siendo local (`scope: 'local'`); una revocación global desde la tienda cerraría la sesión de la misma cuenta en el panel (origen del defecto de MSF-673).
- **Bucle de recargas (disponibilidad)**: cualquier opción que mantenga la regla en la tienda tiene que evitar que la marca vencida sobreviva al vencimiento; hoy la tienda recarga a `/` en cada clic. Mientras no se decida, es el daño colateral más visible para quien vuelve a la tienda.
- **Ruido en consola**: no es un `console.error`: el cierre de la tienda sin sesión resuelve sin error con `@supabase/auth-js@2.115.0`. El ruido real es la recarga.
- **Documentación**: `pnpm docs:check` exige que `docs/tiendas-online.md` y `docs/acceso-ingreso.md` reflejen la regla decidida; además hay que corregir en el tracker la nota de aprendizaje que afirma que la sesión de cliente de la tienda no vence por inactividad (hoy sí, a nivel local, a las 12 h, por MSF-700).
- **Proceso**: si la decisión termina siendo «regla configurable por tienda» (variante de la opción (b)), deja de ser un bug y pasa a ser funcionalidad → requiere spec de Spec Kit (con `## Modelo de datos (DER)`, RLS y documentación), no un fix de bug. El ítem ya está re-parentado a MSF-515 (épica de deuda), que es donde corresponde registrar el acuerdo.
- **Tope del servidor**: el `timebox = 720h` de `[auth.sessions]` aplica a cualquier sesión de Auth, incluida la del cliente de la tienda; ninguna opción de MSF-740 lo cambia.

## Open Questions

- [RESUELTO — opción (c): la tienda NO tiene regla propia de inactividad. Es la decisión ya escrita en el tracker (alcance aprobado de MSF-673 y la nota «una sesión de cliente de la tienda no vence por inactividad»), y el código es el que se apartaba de ella.]
- [ABIERTO — si el producto quiere una regla propia para la tienda (otra ventana, redirección a `/ingresar`, casilla «Mantener la sesión»): es una decisión nueva y, si la ventana fuera por tienda, functionality nueva (spec de Spec Kit con DER y RLS). No lo implementa este ítem.]
- [ABIERTO — si la casilla «Mantener la sesión» llegara a la tienda, el prototipo del ingreso (`design/pantallas/`) tendría que mostrarla: hoy no la tiene y el panel sí (Principio: el prototipo manda la UI).]
