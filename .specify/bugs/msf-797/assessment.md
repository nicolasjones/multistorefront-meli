# Bug Assessment: Verificación de dominio — validar `ip_publica` y cerrar el socket TLS al vencer

- **Slug**: msf-797
- **Created**: 2026-11-14T19:03:29+01:00
- **Source**: pasted text (sin URL; no aplica la política de confianza de URLs)
- **Verdict**: valid
- **Severity**: medium (el repo lo califica P3 en `docs/tiendas-online.md:996-997`)

## Report (verbatim or summarized)

Entrada del usuario (verbatim):

> `[seguimiento MSF-133] Verificación de dominio: validar ip_publica y cerrar socket TLS al vencer (It's a Plan MSF-797) slug=msf-797`

Contexto en el repo (seguimiento de la revisión de seguridad SC-002 de MSF-133, re-parentado a la épica de deuda MSF-515):

- `docs/tiendas-online.md:996` — «P3 · `tienda_dns_plataforma.ip_publica` solo valida el formato (admite loopback/privadas/octetos > 255). La carga el equipo técnico por SQL.»
- `docs/tiendas-online.md:997` — «P3 · El timeout de 5 s de la comprobación TLS no cierra el socket colgado (acotado por 1 verificación cada 10 s).»
- `specs/20270323-100000-deuda-tecnica-lote-1-seguridad-tienda/spec.md:10` — «**MSF-797** — La IP del registro A que se le muestra a la clienta y a la que la Edge Function abre una conexión TLS debe ser una IPv4 pública; y esa conexión se cierra siempre, también al vencer el timeout.» (FR-005 a FR-009; D-3 a D-5).

## Symptom

Dos defectos en la verificación de dominio de la tienda (`verificar-dominio-tienda`):

1. **`ip_publica` sin validación de rango.** `public.tienda_dns_plataforma.ip_publica` solo tenía un CHECK de *formato* (`^[0-9]{1,3}(\.[0-9]{1,3}){3}$`), así que admitía `127.0.0.1`, `10.0.0.5`, `192.168.1.10`, `300.1.1.1`, etc. Ese valor es a la vez el registro A que se le muestra a la clienta y el **host al que la Edge Function abre la conexión TLS** (`Deno.connect` a esa IP, puerto 443): con una IP no pública, la función apunta a una red interna/loopback del runtime y el panel muestra un A que no sirve.
2. **Socket TLS colgado al vencer el timeout.** El límite de 5 s solo rechazaba la promesa de una carrera (`Promise.race` contra `AbortSignal.timeout`); el `Conn` TCP/TLS se cerraba únicamente en el camino de éxito. Si el servidor TLS no respondía, al vencer el plazo la conexión seguía abierta hasta que el runtime la soltaba.

Lo esperado: una IPv4 **pública** o nada (y el flujo se detiene sin abrir conexiones), y **toda** conexión abierta por la comprobación TLS cerrada, también la que llega después del vencimiento y la que quedó colgada en el handshake.

## Reproduction

Sobre el código **anterior** a `93fd00e3` (estado previo en la historia del repo; el árbol actual ya incluye la corrección, ver «Estado actual»):

1. Con la fila de plataforma cargada por SQL, `update public.tienda_dns_plataforma set ip_publica = '127.0.0.1';` — la base lo acepta (solo hay CHECK de formato) y «Verificar ahora» muestra el A `127.0.0.1`; la Edge Function conecta a `127.0.0.1:443` del runtime. Igual con `10.0.0.5` o `999.1.1.1`.
2. Con un dominio ya verificado (A y TXT correctos) y un servidor TLS que acepta la conexión pero no completa el handshake: al pasar 5 s la función responde «pendiente», pero el socket TCP/TLS queda abierto (no hay `close()` en esa rama) y se mantiene hasta que el runtime lo suelta.
3. Variante: el `Deno.connect`本身 cuelga (no resuelve nunca) — el temporizador aborta solo el temporizador, no la conexión, que queda pendiente y sin cerrar.

En el árbol actual (rama `fix/bug-MSF-797`, HEAD `f5d8f4a5`) los pasos 1 y 2 **no se reproducen**: la base rechaza la IP no pública y la comprobación TLS cierra siempre lo que abre. Verificar con `pnpm test:edge:verificar-dominio-tienda` y el pgTAP `tienda_dns_ip_publica_msf797.test.sql`.

## Suspected Code Paths

Código afectado (antes del fix, en `93fd00e3^`):

- `supabase/functions/verificar-dominio-tienda/index.ts` (versión previa) — `comprobarTls` local: `Promise.race([Deno.connect(...).then((tcp) => Deno.startTls(tcp, ...)), promesa_de_timeout])` y `conexion.close()` **solo** en la rama de éxito; `AbortSignal.timeout` no cancela `Deno.connect`/`Deno.startTls`. Es el punto exacto de la fuga de sockets.
- `supabase/migrations/20270205110000_tienda_dominio_verificacion.sql:130` — `constraint tienda_dns_plataforma_ip_formato check (ip_publica ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$')`: valida forma, no enrutabilidad.
- `supabase/migrations/20270205110000_tienda_dominio_verificacion.sql:399-400` — `obtener_dominio_tienda` filtra el A solo con `where v_p.ip_publica is not null`: muestra una IP no pública a la clienta.
- `supabase/migrations/20270205110000_tienda_dominio_verificacion.sql:434-473` — `preparar_verificacion_tienda` no tiene ninguna guarda sobre la IP: devuelve la IP a la Edge Function sin verificar que sea pública.

Código donde vive hoy la corrección (rama actual):

- `supabase/migrations/20270323100100_tienda_dns_ip_publica_publica.sql:30-53` — `private.ip_publica_valida(text)` (inmutable, `search_path` vacío, sin `execute` para `anon`).
- `supabase/migrations/20270323100100_tienda_dns_ip_publica_publica.sql:56-69` — CHECK `tienda_dns_plataforma_ip_publica` creado `NOT VALID` + validación con `raise warning` si una fila existente lo viola.
- `supabase/migrations/20270323100100_tienda_dns_ip_publica_publica.sql:118-119` — `obtener_dominio_tienda` omite el registro A cuando la IP no es válida.
- `supabase/migrations/20270323100100_tienda_dns_ip_publica_publica.sql:164-166` — `preparar_verificacion_tienda` lanza `plataforma_no_configurada` (22023) **antes** de consumir el límite de 10 s.
- `supabase/functions/verificar-dominio-tienda/tls.ts:40-88` — `comprobarTls` con operaciones inyectadas: cierra la TLS si se negoció, intenta cerrar la TCP si no, y cierra la conexión que llegue después del vencimiento; `cerrarSinFallar` tolera conexiones ya cerradas.
- `supabase/functions/verificar-dominio-tienda/index.ts:10-14` — cableado de `Deno.connect`/`Deno.startTls` hacia `tls.ts` (sin dependencias de Deno en el módulo probado).
- `supabase/functions/verificar-dominio-tienda/handler.ts:69-73` — 503 `{ error: 'plataforma_no_configurada' }`; `handler.ts:127` — llamada a `tls.comprobar` solo con el dominio verificado.
- `openapi/verificar-dominio-tienda.json:61` — 503 documentado en el contrato.
- `apps/web/src/lib/tiendaDominio.ts:111,136` — motivo `plataforma_no_configurada` mapeado a un mensaje propio en el panel.

## Root Cause Hypothesis

Dos causas independientes, confianza **alta** en ambas:

1. **La configuración de plataforma validaba forma y no destino.** El CHECK de `20270205110000` era una regex de formato; ningún punto del camino comprobaba que el valor fuera una IPv4 enrutable antes de (i) mostrarlo a la clienta y (ii) usarlo como host de `Deno.connect`. La invariante «la IP de la plataforma es pública» era una convención del equipo técnico, no una garantía de la base. La defensa correcta es doble: CHECK en la tabla (defensa en profundidad para las escrituras) **más** guarda en la RPC que entrega la IP al servidor (defensa en profundidad para las filas que quedaron sin validar), porque el `CHECK` con `NOT VALID` no cubre las filas preexistentes.
2. **El timeout estaba modelado como «rechazar la promesa» y no como «poseer el recurso y cerrarlo».** En la implementación anterior, `conexion.close()` estaba en la rama de éxito de un `Promise.race`; al vencer el plazo, la rama de error devolvía sin cerrar nada, y `AbortSignal.timeout` solo dispara un evento: no cancela `Deno.connect` ni `Deno.startTls`. Con un handshake colgado, el socket quedaba vivo y el `Conn` se perdía. La forma correcta es que quien abre el recurso sea su dueño: cierre en todos los caminos de salida (éxito, error, vencimiento) y cierre de la conexión que llegue tarde, porque la promesa de conexión no es cancelable.

## Estado actual en esta rama

**El defecto ya está corregido en el historial de la rama `fix/bug-MSF-797`** (HEAD `f5d8f4a5`):

- `93fd00e3` — «fix(tienda): exige IP pública en el DNS de la plataforma y cierra el socket TLS al vencer (MSF-797)»: migración `20270323100100`, módulo `tls.ts` + `tls.test.ts`, 503 en `handler.ts` + caso en `handler.test.ts`, OpenAPI.
- `f5d8f4a5` — correcciones de la revisión del Lote 1 (M4: limitación documentada y test renombrado a «intenta cerrar»; M5: motivo propio en el panel).
- `488800f2` — documentación (`docs/tiendas-online.md:996-997`, `docs/tecnico/tienda-dominio-y-publicacion.md:359-362`).
- Artefactos: `specs/20270323-100000-deuda-tecnica-lote-1-seguridad-tienda/` (FR-005 a FR-009, D-3 a D-5; tareas T004 a T007 y T014, todas `[x]`).

Consecuencia para el flujo: el paso de **fix** no debe duplicar el parche; lo que queda es **verificación** (`speckit-bug-test`): correr `pnpm test:edge:verificar-dominio-tienda` (node --test de `tls.test.ts` + `handler.test.ts`) y el pgTAP `supabase/tests/database/tienda_dns_ip_publica_msf797.test.sql` contra una base con Supabase local, más `node scripts/verificar-openapi.mjs`. Si el tracker espera un cambio de código nuevo, hay que confirmar antes con el equipo técnico si lo que se busca es cerrar la limitación D-5 (el socket TLS en vuelo durante un handshake colgado no se puede abortar).

## Proposed Remediation

**Preferred** (ya materializado en `93fd00e3`, parafraseado como especificación de la forma del cambio):

1. **Base** — migración aditiva e idempotente `supabase/migrations/20270323100100_tienda_dns_ip_publica_publica.sql`:
   - `private.ip_publica_valida(text) → boolean` (`immutable`, `search_path = ''`, `revoke` a `public`/`anon`, `grant` a `authenticated`): cuatro octetos 0–255 sin ceros a la izquierda, fuera de `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`; se admiten TEST-NET-2/3 (D-3).
   - CHECK `tienda_dns_plataforma_ip_publica` creado `NOT VALID` y validado en la misma migración; si una fila existente lo viola, `raise warning` con el comando de corrección y **no** se corta la cola (D-4).
   - `preparar_verificacion_tienda` y `obtener_dominio_tienda` reemplazadas con la misma firma y grants: la primera lanza `plataforma_no_configurada` (22023) antes de consumir el límite de 10 s; la segunda omite el registro A cuando la IP no es válida.
2. **Edge Function** — nuevo módulo puro `supabase/functions/verificar-dominio-tienda/tls.ts` (sin Deno) con `conexiar`/`iniciarTls` inyectadas: el dueño de la conexión la cierra en éxito, error y vencimiento, y cierra la conexión que llegue tarde; `index.ts` solo cablea `Deno.connect`/`Deno.startTls`. `handler.ts` responde 503 `plataforma_no_configurada` y `openapi/verificar-dominio-tienda.json` documenta el código.
3. **Front** — `apps/web/src/lib/tiendaDominio.ts` mapea `plataforma_no_configurada` a un motivo propio («La plataforma todavía no tiene configurada su IP pública para verificar dominios. Avisá a soporte.») en el aviso existente, sin pantallas nuevas.

**Alternatives** (descartadas, con su trade-off):

- **Validar la IP solo en la Edge Function** (rechazar si no es pública antes de conectar): evita la migración y el pgTAP, pero deja la fila inválida en la base y **no** evita que el panel muestre un A que no sirve ni que la configuración apunte a una red interna; no cubre el requisito de «la IP es pública» en la fuente.
- **Quitar el `CHECK` y dejar solo la guarda en la RPC**: más simple, pero la tabla seguiría aceptando IPs no públicas y la fila inválida no se detectaría hasta usarla; además se pierde la validación de las escrituras.
- **Para el socket: `AbortSignal`/`Deno.Conn` con cancelación nativa** en vez del cierre best-effort: cerraría el handshake en vuelo, pero depende de la semántica de `Deno.startTls` (consume la TCP) y no se pudo verificar con un Deno real (limitación D-5); se deja como seguimiento, no como parte de este fix.

**Files likely to change** (los del fix ya aplicado; para un eventual ajuste):

- `supabase/migrations/20270323100100_tienda_dns_ip_publica_publica.sql`
- `supabase/functions/verificar-dominio-tienda/tls.ts`, `tls.test.ts`, `index.ts`, `handler.ts`, `handler.test.ts`
- `supabase/tests/database/tienda_dns_ip_publica_msf797.test.sql`
- `openapi/verificar-dominio-tienda.json`, `package.json` (script de test de la función)
- `apps/web/src/lib/tiendaDominio.ts`, `apps/web/src/lib/tiendaDominio.verificar.test.ts`, `apps/web/src/pages/empresas/tienda/pestanas/publicacion/Dominio.tsx`, `Dominio.test.tsx`
- `docs/tiendas-online.md`, `docs/tecnico/tienda-dominio-y-publicacion.md`, `docs/tecnico/api.md`, `docs/tecnico/datos.md`

**Tests to add or update**:

- pgTAP de `private.ip_publica_valida`: rangos rechazados, bordes admitidos, notación estricta (octetos > 255, ceros a la izquierda), TEST-NET-2/3 y la IP de dev admitidas; CHECK que rechaza loopback/10/192.168/172.16/multicast y admite la fila sembrada; `preparar_verificacion_tienda` con IP inválida → `plataforma_no_configurada` **sin** consumir el límite de 10 s; `obtener_dominio_tienda` sin registro A.
- `tls.test.ts` (node --test, `pnpm test:edge:verificar-dominio-tienda`): cierre en éxito (una sola vez, la TLS), timeout en la conexión TCP con llegada tardía, timeout en el handshake con llegada tardía, certificado inválido, puerto cerrado, `close()` sobre conexión ya cerrada (BadResource) y ausencia de temporizadores colgados al terminar.
- `handler.test.ts`: 503 `plataforma_no_configurada` sin consultar DNS, sin abrir conexiones TLS y sin registrar nada.
- Front: `tiendaDominio.verificar.test.ts` y `Dominio.test.tsx` para el motivo propio del panel.

## Risks & Considerations

- **Filas ya existentes no públicas**: el CHECK queda `NOT VALID` y la migración solo avisa; mientras tanto la RPC corta el flujo con 503 y el panel no muestra el A, pero el equipo técnico debe corregir la fila y correr `alter table public.tienda_dns_plataforma validate constraint tienda_dns_plataforma_ip_publica` (documentado en `docs/tiendas-online.md:75-80` y en el encabezado de la migración).
- **TEST-NET-2/3 admitidos a propósito** (D-3): el seed `203.0.113.24` y los tests siguen funcionando, pero esas IP no son enrutables — en un entorno real la verificación TLS no llega a ningún servidor hasta que el equipo técnico cargue la IP verdadera. La IP de dev `212.90.120.53` sí es pública.
- **Limitación D-5 (no verificada en un Deno real)**: `Deno.startTls` consume la conexión TCP; si el handshake queda colgado, al vencer solo se *intenta* cerrar la TCP (se tolera que esté consumida) y el socket TLS en curso no se puede cerrar hasta que `startTls` resuelva o falle. El impacto está acotado (una conexión a la IP de la plataforma, a lo sumo una verificación cada 10 s por tienda, y el runtime suelta al cortar el servidor) y queda documentado en `tls.ts:5-13` y en la spec.
- **`index.ts` no se puede type-checkear con `deno check`** (no resuelve `npm:@supabase/supabase-js` sin instalar): el cableado de `Deno.connect`/`Deno.startTls` lo valida el despliegue de la función, no el type-check local.
- **Sin ruptura de API en el camino feliz**: se agrega el código 503 y un motivo nuevo de error; el front y el contrato OpenAPI los cubren.
- **La migración es aditiva e idempotente** y trae su reversión en el encabezado; no destruye datos ni columnas (Principio VII de la constitución y regla de migraciones de `AGENTS.md`).
- **RLS y privilegios**: `private.ip_publica_valida` no es ejecutable por `anon`; las RPC mantienen `revoke … from public, anon` y `grant` a `authenticated`; la service-role sigue solo en el servidor.
- **Documentación**: el cambio es de plataforma/Supabase/Edge Function, así que exige el equivalente en `docs/` y en la spec de la épica (ya hecho en `488800f2` y `f5d8f4a5`).

## Open Questions

- [NEEDS CLARIFICATION: el tracker pide un fix nuevo o la verificación del parche ya aplicado? La rama `fix/bug-MSF-797` ya contiene `93fd00e3` (corrección) y `f5d8f4a5` (revision); el fix no debe duplicar el parche y corresponde cerrar con `speckit-bug-test`.]
- [NEEDS CLARIFICATION: ¿cuál es la `ip_publica` real por entorno (dev/staging/producción) y ya se corrió `validate constraint` en cada uno? Con el seed `203.0.113.24` la verificación TLS nunca llega a un servidor real.]
- [NEEDS CLARIFICATION: ¿la limitación D-5 (no poder abortar el handshake TLS en vuelo) se acepta como deuda o se abre un seguimiento para cerrar el socket a nivel de Deno?]
- [NEEDS CLARIFICATION: ¿el cierre del socket TLS al vencer exige además una verificación en un Deno real (no verificada en el entorno de desarrollo, según T007)?]
