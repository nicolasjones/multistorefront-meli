# Notas · Ventas avisos de faltantes (MSF-161)

Notas de cierre de la épica por los roles retroactivos (Especificador, CTO, Documentador, Release), 2026-11-13. No cambian requisitos: los requisitos viven en [`spec.md`](./spec.md). Entrega: #834 (feat) más las rondas #911, #922, #927 (ajeno), #931, #936 y #939 en `dokploy`; #916 (docs de producto y técnica) en `main`. Rondas cerradas sin mergear y superadas: #915, #918, #920, #926, #930.

## Cómo se aplicaron los roles

Los cuatro roles los corrió **un solo agente de Claude Code** leyendo el prompt real de cada uno (`/root/agenmatica-sdlc/prompts/{especificador,cto}.md`, `/root/ai-dev-orchestrator/prompts/documentador.md`) y el runner correspondiente (`documentador.js`, `release.js`, `cto.js`). **No** se invocaron por Paperclip ni el gateway, ni como agentes independientes entre sí: la independencia de criterio es menor que la de las épicas 373/450/145/363. Insumos: spec, plan, tasks y contrato; el código en `origin/dokploy` d78b2518; los informes de QA y Código/Seguridad de #834, #915, #918, #920, #922, #926, #930, #931, #936 y #939; las pruebas en dev `msf161-dev-e2e.md` y `msf161-dev-e2e-2.md` (la 3.ª vuelta, `-3.md`, **no existe**).

| Rol | Qué hizo | Qué encontró |
|---|---|---|
| Especificador | Contrastó spec/plan/tasks/contrato con lo mergeado y actualizó los puntos viejos (PR a `dokploy`) | La spec describía el estado inicial: «Avisado» al encolar, sin `en_cola` ni «Aviso fallido», sin topes de 24 h y 1.000/día, sin SMTP ni base64. El plan no listaba las migraciones `20270306120000/130000` ni `_shared/*`. Las tareas llegaban hasta T025 (faltaban #922–#939). |
| CTO | Lecciones (≤3) y decisiones para el gate | 11 PRs de corrección para una épica de ~12 h; la mayoría de los hallazgos eran de revisión de lo que acababa de arreglarse la ronda anterior. Ver *Lecciones*. |
| Documentador | Guía técnica del repo, `docs/deployment.md`, roadmap, ayuda y (PR a `main`) manual y técnico de producto | `docs/producto` y `docs/tecnico` de la épica (en `main` desde #916) estaban en el estado de #834: sin «En cola», «Aviso fallido», «Reintentar», topes, SMTP/base64. Un typo («verindo») en el manual. La ayuda de la pantalla apuntaba a la página de despacho y no a la de avisos. |
| Release | Checklist de abajo | Falta de secretos y flow en stg/prd; `docs/deployment.md` no decía nada de los secretos SMTP ni del token. |

## Lecciones

Propuestas para el gate de Nicolás (≤3, cada una con qué pasó, causa, cambio, dónde y evidencia). Ninguna se aplica sin su aprobación.

1. **Correr `pnpm test:db` completo en local antes de abrir un PR de migraciones.** *Qué pasó*: el job `database` del CI falló en dos corridas (runs 43423707034 y 43426564702) en el test 38 «service_role ejecuta toda función evaluada por defaults, CHECK, índices o disparadores de dominio»: `private.sanear_mensaje_aviso` la evalúa el CHECK de `faltantes_avisos.mensaje` y `service_role` no podía ejecutarla. *Causa*: el guard ya existía, pero solo se vio en CI (el pgTAP local corrió con un rol que no lo detectaba o no se corrió entero; no verificado cuál). *Cambio*: que el Desarrollador/Revisor incluya `pnpm test:db` completo (no solo el pgTAP del archivo nuevo) en su checklist previo a abrir el PR. *Dónde*: prompt del Desarrollador y skill `desarrollo-manual`. *Evidencia*: #922 (arreglo T026), runs citados.
2. **Todo cambio en `supabase/functions/_shared/` que toque correo exige correr el script Deno real y una prueba en dev con buzón de pruebas.** *Qué pasó*: los tests de node (126–135 casos verdes) no vieron dos bugs que sí vio el E2E en dev: el envío sin TLS que denomailer 1.6.0 rechaza siempre (H1) y el quoted-printable que corrompía «·» y tildes (H2). 587/STARTTLS tampoco funciona con esa librería. *Causa*: los tests de node ven el objeto armado, no el DATA SMTP; `smtp-real.deno.ts` (18 casos) no corre en CI; la configuración insegura estaba permitida por omisión. *Cambio*: (a) checklist: correr `smtp-real.deno.ts` si se toca `_shared/{correo,smtp}.ts`; (b) regla: lo inseguro es opt-in explícito y falla cerrado (`SMTP_PERMITIR_INSEGURO`), nunca por omisión; (c) a evaluar: correr el script Deno en el CI. *Dónde*: AGENTS.md del repo (sección Edge Functions) y revisor. *Evidencia*: `msf161-dev-e2e.md` H1, `msf161-dev-e2e-2.md` H2, `REVIEW-PR931.md`, `REVIEW-PR939.md`.
3. **Una ronda de revisión por PR, con un solo commit convencional, y cerrar las rondas superadas.** *Qué pasó*: 5 PRs de ronda (#915, #918, #920, #926, #930) se cerraron sin mergear porque la revisión siguiente encontró algo nuevo sobre el mismo diff, y hubo que reabrir en ramas `-v2`, `-v3`, `-v4`; antes, commitlint rechazaba merges no convencionales sin mostrar la causa. *Causa* (interpretación mía, no verificada): se arreglaban hallazgos menores en tandas sin separar bloqueantes de menores y sin esperar CI verde entre rondas. *Cambio*: el Revisor clasifica bloqueantes y menores en cada informe; los menores se agrupan en un único PR posterior; no se abre la ronda N+1 hasta el CI verde de la N; un PR = un commit (`git reset --soft` + commit convencional, push sin force-push cuando la rama es nueva). *Dónde*: prompt del Revisor y skill `desarrollo-manual`. *Evidencia*: PRs listados arriba (1 commit cada uno; 5 cerrados).

Otras notas no destinadas al gate: (a) el prompt del Documentador pide la clave de la épica en producto salvo en «Modo manual de usuario» (este repo lo es: `docs/producto/.manual-de-usuario`), por eso el manual no lleva claves; (b) una función `_shared` que usan varias Edge Functions multiplica el radio del cambio (aquí 4 funciones): probar todas.

## Decisiones tomadas (2026-11-13)

- `ayuda`: el destino `ventas-faltantes` abre ahora `ventas-avisos-de-faltantes` (antes `ventas-despacho-y-faltantes`). Esa página existe en `main` desde #916 y la de despacho explica cómo se registran los faltantes, no cómo se avisa. Reversible en una línea; no se verificó que el sitio publicado ya sirva la página (mismo reparo que en MSF-363).
- `docs/roadmap-template.md`: la fila de MSF-161 pasa de «En PR» a «Implementado en `dokploy`» con lo pendiente para stg/prd.

## Pendientes de Nicolás

Decisiones y verificaciones no hechas:

1. ~~**Prototipo `design/pantallas/VentasFaltantes.dc.html`**~~ **Resuelto (2026-11-14)**: decisión tomada por Claude por delegación de Nicolás: el prototipo refleja lo implementado (chips «En cola» y «Aviso fallido» con motivo, «Reintentar» y «Avisos en cola.»; inventario regenerado). El filtro «En cola» sigue solo en la RPC.
2. **Despliegue a STG y PROD** (lo hace Nicolás): secretos reales `SMTP_HOST/PORT=465/TLS=true/USER/PASS/FROM` y `AVISOS_FALTANTES_TOKEN` en Edge Functions, `AVISOS_FALTANTES_URL/APIKEY/SECRET_AVISOS_FALTANTES_TOKEN` (base64) en Kestra, y publicar el flow `avisos-faltantes`. Detalle y orden en `docs/deployment.md` › *Avisos de faltantes*. Hasta entonces los avisos quedan «En cola» sin salir.
3. **Proveedor SMTP y puerto**: con denomailer 1.6.0 solo funciona TLS implícito (465). Si el proveedor solo ofrece 587/STARTTLS hay que reemplazar la librería (p. ej. `npm:nodemailer` con `requireTLS`); es una decisión de alcance.
4. **Reintentar un `smtp_timeout` sin límite de 24 h ni tope diario** (el correo pudo haber salido; es la única vía de duplicado por acción humana): confirmar que se acepta.
5. **Valores de los topes** (24 h de reaviso, 1.000 líneas por organización por día móvil): fijados por la revisión M-3 sin confirmar con el cliente; hoy no son configurables.
6. **«Para avisar» no consume saldo de ingresos posteriores y anular un ingreso no desmarca** (QA M3, decisiones 5 y 6): ya aprobadas con «avanza con todo»; el QA pidió que producto lo confirme viendo el «Stock hoy» al lado.
7. **Hito**: la etiqueta `revisar-roadmap` (diciembre, P1) sigue pendiente de confirmación del cliente. No verificado en ItsAPlan.
8. **Seguimiento de correo real** (`verificacion-externa`, MSF-532 según el plan): no verificado si existe y qué cubre; la entrega contra un SMTP real de stg/prd no está probada.
9. Fuera de esta épica, detectado en el E2E: el rol `operador` (empresas = ninguno) no puede crear facturas («No pudimos calcular el precio»).
10. «Avisos de la tienda web» del prototipo (pedidos «avisame cuando vuelva» de visitantes) sigue fuera de alcance: es otra épica.

## Checklist de release (rol Release)

Estado al 2026-11-13, todo en `origin/dokploy` d78b2518.

- [x] Código en `dokploy`: #834, #911 (secretos de correo y avisos en el runtime de dev), #922, #931, #936, #939 mergeados con CI verde (según `gh pr view`: MERGED).
- [x] Spec, plan, tareas y contrato al día (este PR); todas las tareas `[x]`.
- [x] Verificado en dev con E2E real: #922 (70c36557) y #931 (1932e701): `msf161-dev-e2e.md` y `-2.md`. Limpieza de datos de prueba confirmada en ambas.
- [ ] **No verificado en dev**: #936 y #939 (solo revisión independiente, node 135/135 y Deno 18/18 en local). Falta una vuelta de E2E con el correo en base64 y la configuración validada.
- [ ] Orden de despliegue: migraciones (hasta `20270306130000`) **antes** de las Edge Functions.
- [ ] Secretos de Edge Functions y de Kestra en stg y prd (ver Pendientes 2).
- [ ] Flow `avisos-faltantes` publicado en stg (por push) y prd (por `workflow_dispatch`).
- [ ] Verificación posterior en stg: un faltante de prueba pasa «En cola» → «Avisado» y llega un solo correo con tildes y «·» correctos.
- [ ] Manual de usuario y técnico en `main` actualizados (PR a `main` de esta tarea) y sitio de documentación republicado.
- [x] Decisión sobre el prototipo (Pendientes 1): resuelta el 2026-11-14.

## No verificado

- Estado de gates, etiquetas y bloqueos en ItsAPlan.
- `pnpm test:db`, Vitest y E2E de Playwright no se corrieron en esta tarea (solo documentación y un mapeo de ayuda): se apoya en los informes citados.
- Que el job `database` fallara por la causa citada en la lección 1: confirmado el test que falló (38); por qué no se vio en local, no.
- Entrega real contra un SMTP de stg/prd, render en clientes de correo y la concurrencia real (deadlock, dos barridos) no están probados.
