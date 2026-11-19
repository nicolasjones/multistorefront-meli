# Bug Assessment: Verificación externa del correo saliente por SMTP self-hosted (FR-012b de MSF-148)

- **Slug**: msf-532 (provisto por el usuario)
- **Created**: 2026-11-14
- **Source**: pasted text — «Verificación externa: correo saliente real por SMTP self-hosted (FR-012b de MSF-148) (It's a Plan MSF-532) slug=msf-532». Sin URL.
- **Verdict**: valid (brecha de cierre/evidencia, no una regresión de código)
- **Severity**: medium

## Report (verbatim or summarized)

«Verificación externa: correo saliente real por SMTP self-hosted (FR-012b de MSF-148) (It's a Plan MSF-532) slug=msf-532».

Es la parte **(b)** del requisito **FR-012** de la spec `specs/20261016-130000-perfil-y-permisos-avanzados` (épica MSF-148, historia F-ROL-05 / MSF-302): probar que el aviso de «Solicitar acceso» **sale realmente hacia afuera** desde el servidor self-hosted y **llega a una casilla externa de prueba** (`CORREO_PRUEBA` = `nicolas.m.jones@gmail.com`), con evidencia en el PR, sin correr en `pnpm test` ni en el CI.

El BRAIN la lista junto a **MSF-520** (simulacro de restauración) y **MSF-533** (hosted) como **verificaciones externas vigentes**: las tres son comprobaciones contra el sistema real, no automatizables en el CI, y por eso dependen de un cierre honesto.

## Symptom

La verificación externa **nunca se ejecutó** y **no hay evidencia**: la tarea que la exige está cerrada como `[x]` sin prueba ni seguimiento trazado, mientras la propia documentación declara el relay SMTP real y la entregabilidad (SPF/DKIM) como **pendientes** en el VPS. En consecuencia, el estado del repositorio afirma una verificación que no ocurrió («un estado *Done* no miente»).

Secundario: el guion opt-in que debería producir la evidencia **puede dar un verde falso** (sale con código 0 aunque no se haya enviado ningún correo nuevo), así que ni siquiera una ejecución manual garantiza prueba.

## Reproduction

1. `specs/20261016-130000-perfil-y-permisos-avanzados/tasks.md:38` → T013 está `[x]`: «Guion opt-in de verificación de salida: envía por el flujo real a `CORREO_PRUEBA` … dejar evidencia en el PR **o** documentar el hallazgo y trazar seguimiento si el relay SMTP no sale (FR-012b, SC-004)».
2. `git log -1 --format=%b 2717cc34` (commit «MSF-148: el correo de solicitar acceso sale por el SMTP de Supabase y se verifica su salida») → cuerpo **vacío**: no hay evidencia ni desviación anotada en el mensaje del commit.
3. Buscar la evidencia: no existe página de registro de la corrida, ni captura, ni entrada en el PR equivalente a la de `docs/simulacro-restauracion.md` (el precedente de la verificación externa MSF-520).
4. En cambio, el estado real está escrito en la documentación, en cuatro lugares:
   - `docs/tecnico/operacion.md:114` → «**Pendiente:** relay SMTP real y entregabilidad (SPF/DKIM) en el VPS. Dueño: infraestructura/Nicolás».
   - `docs/tecnico/perfil-y-permisos.md:164-165` → «La entregabilidad (SPF/DKIM del remitente) es infraestructura; si el relay del servidor no está configurado, se documenta el hallazgo y se traza como seguimiento».
   - `docs/solicitar-acceso.md:76-78` → «Si el servidor no tiene un SMTP real configurado, el correo no sale; es infraestructura a cargo de Nicolás».
   - `specs/20261016-130000-perfil-y-permisos-avanzados/spec.md:133` → «Relay SMTP externo del servidor self-hosted: … Si hoy no lo tiene, la verificación FR-012(b) **fallará** y esa configuración es infraestructura a cargo de Nicolás».
5. `specs/20261110-100000-ventas-avisos-de-faltantes/notas.md:42` → «**Seguimiento de correo real** (`verificacion-externa`, MSF-532 según el plan): **no verificado** si existe y qué cubre; la entrega contra un SMTP real de stg/prd **no está probada**».
6. Comparar con el precedente: `docs/README.md:64` traza la verificación externa MSF-520 («documentado pero **no ejecutado** … Seguimiento: **MSF-520** (Tarea `seguimiento` en el tracker)») y `docs/simulacro-restauracion.md:12-14` cierra T018 con `Desvío:` + seguimiento. **MSF-532 no tiene nada de eso**: T013 quedó `[x]` sin desviación ni seguimiento.

Comprobación del guion (verde falso, sin tocar el servidor): con `MAILPIT_URL` ausente, `scripts/verificar-salida-correo.mjs:56-59` imprime «confirmá a mano que el aviso llegó a …» y **sale con código 0**; y si el pedido de ese día ya se notificó, la función responde `{resultado:'solicitud_enviada', nuevo:false}` **sin enviar nada** (`supabase/migrations/20261017100001_rpc_solicitar_acceso.sql:45-63` → `supabase/functions/solicitar-acceso/handler.ts:57`) y el guion también sale con 0.

## Suspected Code Paths

- `specs/20261016-130000-perfil-y-permisos-avanzados/spec.md:103` (FR-012), `:125` (SC-004), `:133` (decisión abierta «Relay SMTP externo») — el requisito, su criterio de éxito y el riesgo ya anticipados.
- `specs/20261016-130000-perfil-y-permisos-avanzados/tasks.md:38` (T013 `[x]`) — el estado que «miente»; el propio texto de la tarea contemplaba las dos salidas legítimas (evidencia **o** hallazgo documentado + seguimiento trazado) y no se hizo ninguna.
- `specs/20261016-130000-perfil-y-permisos-avanzados/plan.md:47` — plan de verificación (a) local por API de Mailpit y (b) servidor con `CORREO_PRUEBA`, fuera de `pnpm test`/CI.
- `scripts/verificar-salida-correo.mjs:43-59` — guion opt-in (`pnpm correo:verificar-salida`, `package.json:39`): sin `MAILPIT_URL` no comprueba nada y sale con 0; no distingue «envió ahora» de «ya enviado hoy»; `CORREO_PRUEBA` es solo un recordatorio, no el destinatario real.
- `supabase/migrations/20261017100001_rpc_solicitar_acceso.sql:45-63` — idempotencia por `(organizacion_id, usuario_id, seccion, dia)` y bandera `correo_enviado` que hace que la segunda invocación del día **no envíe**.
- `supabase/functions/solicitar-acceso/handler.ts:57` (retorno temprano si ya se notificó) y `:62-74` (los destinatarios son los administradores activos de la organización, **no** `CORREO_PRUEBA`) — precondición manual: el administrador de la organización de prueba debe tener ese correo.
- `supabase/functions/_shared/correo.ts:1-22` y `supabase/functions/_shared/smtp.ts:150-166` — transporte: reutiliza el SMTP de Auth; sin `SMTP_HOST`/`SMTP_FROM` (o `SMTP_TLS` inválida) falla cerrado antes de enviar.
- `supabase/functions/.env.example:44-60` y `docs/deployment.md:55-63` — nombres y valores esperados de los secretos `SMTP_*` en stg/prd («datos reales del relay»); no hay en el repo ningún valor ni verificación de que estén fijados.
- `docs/entregar-sistema.md:28` — el checklist de entrega ya exige «Correo de soporte y SMTP configurados», otra señal de que la configuración real está fuera del repo y sin verificar.
- `docs/tecnico/operacion.md:109-114`, `docs/tecnico/perfil-y-permisos.md:146-165`, `docs/solicitar-acceso.md:76-78` — documentación que ya declara el relay como pendiente (el hallazgo está escrito; lo que falta es el cierre coherente y la evidencia).
- `docs/simulacro-restauracion.md:6-17` y `docs/README.md:61-65` — **precedente exacto** a imitar (MSF-520): página de registro con valores «pendiente», `Desvío:` y Tarea `seguimiento` en el tracker.

## Root Cause Hypothesis

La causa raíz es **de proceso, no de código**: FR-012(b) es una verificación externa cuyo requisito previo (un relay SMTP real con credenciales, más SPF/DKIM, en el VPS self-hosted) está **fuera del repositorio y a cargo de infraestructura**; sin ese previo la verificación no puede ejecutarse. Sobre ese bloqueo, la tarea T013 se cerró como `[x]` **sin evidencia y sin desvío ni seguimiento trazado**, mientras la documentación declaraba el relay pendiente: eso es exactamente la incoherencia de cierre que el repo prohíbe («un estado *Done* no miente») y que ya tiene precedente resuelto para MSF-520 (página de registro + `Desvío:` + Tarea `seguimiento`).

Contribuye un defecto menor pero real del instrumental: `scripts/verificar-salida-correo.mjs` no puede producir evidencia verificable por máquina —sin `MAILPIT_URL` sale con código 0 sin comprobar nada, y por la idempotencia por día de `solicitar_acceso` una segunda corrida devuelve `nuevo:false` **sin enviar** y aun así sale con 0—, de modo que una ejecución manual «verde» tampoco sería prueba de que un mensaje salió. A esto se suma que el destinatario real son los administradores de la organización, así que `CORREO_PRUEBA` exige una precondición manual (que el admin de la organización de prueba tenga ese correo) que el guion no verifica.

Confianza: **alta** en que la verificación no se ejecutó y no hay evidencia (consta en el repo: tareas, plan, spec, docs y notas); **media** en que el relay no está configurado en el VPS (no es inspeccionable desde el worktree; lo afirma la documentación vigente).

## Proposed Remediation

**Preferred** — cerrar el MSF-532 con la coherencia de cierre de MSF-520 y dejar la verificación trazada, en dos partes:

1. **Cierre honesto de la tarea (repo, doable ahora).** En `specs/20261016-130000-perfil-y-permisos-avanzados/tasks.md`, T013 queda `[x]` con nota corta `Desvío: <motivo>` + referencia `ver commit <hash>` (regla de AGENTS.md), y se traza la Tarea `seguimiento` «Ejecutar la verificación de salida de correo contra el SMTP real del servidor self-hosted (FR-012b)» con dueño infraestructura/Nicolás. Crear una página de registro de la verificación (modelo `docs/simulacro-restauracion.md`) con la tabla de campos (fecha, entorno, remitente, destinatario, resultado, evidencia) **en «pendiente»** —sin inventar resultados— y enlazarla desde `docs/README.md` (sección «Deuda trazada»), `docs/tecnico/operacion.md` y `docs/tecnico/perfil-y-permisos.md`, sustituyendo el «Pendiente» difuso por un estado con dueño y seguimiento (MSF-532).
2. **Endurecer el guion para que no pueda dar un verde falso.** En `scripts/verificar-salida-correo.mjs`: (a) en modo servidor exigir `CORREO_PRUEBA` y (b) fallar con código ≠ 0 y mensaje explícito cuando la respuesta sea `{resultado:'solicitud_enviada', nuevo:false}` (no se envió nada: el pedido del día ya estaba notificado → indicar cambiar `SECCION`/usuario o esperar al día siguiente), (c) imprimir un marcador de «no es evidencia» en la salida sin `MAILPIT_URL` y exigir confirmación explícita, (d) documentar que el destinatario real es el administrador activo de la organización y que su correo debe ser `CORREO_PRUEBA`. Agregar `scripts/verificar-salida-correo.test.mjs` (`node --test`) cubriendo esos casos.
3. **Verificación real (infraestructura, dueño Nicolás, fuera del repo).** Configurar en el VPS el relay real (Auth `GOTRUE_SMTP_*` y secretos de la Edge Function `SMTP_HOST`/`SMTP_PORT=465`/`SMTP_TLS=true`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`, más DNS SPF/DKIM del remitente), y entonces correr `pnpm correo:verificar-salida` contra stg con el administrador de la organización de prueba usando `CORREO_PRUEBA`; volcar la evidencia (salida del guion + confirmación de recepción) en la página de registro y en el PR. Recién ahí FR-012(b)/SC-004 quedan verificados de verdad.

**Alternatives**:
- *Cerrarlo solo como administrativo* (marcar desvío y no ejecutar nunca): lo más barato, pero deja el producto con un aviso que nunca llega a probarse; es el estado actual y el que este bug denuncia.
- *Mover la verificación al CI con un relay real en el runner*: contradice FR-012 (manual/opt-in, fuera del CI) y mete una casilla real en el runner; no se recomienda.

**Files likely to change**:
- `specs/20261016-130000-perfil-y-permisos-avanzados/tasks.md` (T013: nota `Desvío:` + referencia del seguimiento)
- `docs/verificacion-salida-correo.md` (nuevo; registro de la corrida, valores «pendiente»)
- `docs/README.md` (deuda trazada: entrada MSF-532), `docs/tecnico/operacion.md`, `docs/tecnico/perfil-y-permisos.md`, `docs/solicitar-acceso.md` (estado y enlace al registro)
- `scripts/verificar-salida-correo.mjs` (sin verde falso; precondición `CORREO_PRUEBA`)
- `scripts/verificar-salida-correo.test.mjs` (nuevo; `node --test`)
- `docs/deployment.md` (checklist de relay + SPF/DKIM en stg/prd, con estado)

**Tests to add or update**:
- `scripts/verificar-salida-correo.test.mjs`: (a) respuesta `nuevo:false` → salida ≠ 0 y mensaje de «no se envió nada»; (b) modo servidor sin `CORREO_PRUEBA` → error; (c) modo local sin `MAILPIT_URL` → error explícito, nunca «OK»; (d) camino feliz con Mailpit (mensaje encontrado) → 0. No se toca `pnpm test`/`pnpm test:web` (la verificación es opt-in por requisito), pero sí puede entrar en `pnpm test` como suite de script si el repo lo acepta.
- No se requieren cambios en `supabase/functions/solicitar-acceso/handler.test.ts` (el transporte simulado ya cubre el envío); si el guion queda acoplado al formato de la respuesta, documentar el contrato `{resultado, nuevo}` como parte del test del guion.

## Risks & Considerations

- **No inventar evidencia**: el registro debe quedar «pendiente»; un resultado simulado invalidaría FR-012(b) y la coherencia de cierre que el bug denuncia.
- **Bloqueo externo**: la parte 3 depende de acceso al VPS y de un proveedor SMTP (decisión de Nicolás: `465`/TLS implícito, porque 587/STARTTLS no funciona con denomailer 1.6.0). Sin eso, la historia queda con deuda trazada, no resuelta.
- **Alcance del blast radius**: el mismo relay alimenta otras funciones (avisos de faltantes, resúmenes de reposición, correo a proveedor, invitaciones); que no esté configurado no es sólo un problema de F-ROL-05.
- **Regresión a evitar**: endurecer el guion no debe convertir la verificación en un paso obligatorio de `pnpm test`/CI (FR-012 lo prohíbe) ni enviar correos de prueba a casillas ajenas: el destinatario es siempre el administrador de la organización de prueba.
- **Seguridad**: `SMTP_USER`/`SMTP_PASS` y el dominio del remitente son secretos de infraestructura; ningún valor real entra al repo (sólo `.env.example`).
- **Reglas del repo**: el cambio es documental + script de verificación, sin migración ni API nueva; `pnpm docs:check` debe quedar verde y el PR se abre contra `main` al crear la rama (ya hecho en este worktree).

## Open Questions

- [NEEDS CLARIFICATION: ¿el relay SMTP real ya está configurado en el VPS de stg/prd (y sólo falta SPF/DKIM), o no hay proveedor SMTP elegido todavía? Cambia si la deuda es «configurar» o «comprar/elegir proveedor».]
- [NEEDS CLARIFICATION: ¿la Tarea `seguimiento` de MSF-532 ya existe en el tracker? La nota de `specs/20261110-100000-ventas-avisos-de-faltantes/notas.md:42` dice «no verificado si existe y qué cubre».]
- [NEEDS CLARIFICATION: ¿la evidencia de FR-012(b) debe quedar en el PR de este bug o en el de la historia F-ROL-05? El spec dice «evidencia en el PR».]
- [NEEDS CLARIFICATION: ¿qué casilla externa se usa como destino de la prueba (`nicolas.m.jones@gmail.com` es la de la spec) y quién revisa la recepción: Nicolás u otra persona de la organización de prueba?]
- [NEEDS CLARIFICATION: ¿MSF-533 («hosted») cubre el mismo relay desde el lado de Supabase Cloud/hosted o es otro ámbito (p. ej. despliegue en Dokploy)? Conviene no solapar los tres seguimientos.]
