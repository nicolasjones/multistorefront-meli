# Bug Assessment: Evidencia E2E en DEV del recorrido Service cobro y avisos (seguimiento MSF-232)

- **Slug**: msf-780 (provisto por el usuario)
- **Created**: 2026-11-04
- **Source**: pasted text (sin URL)
- **Verdict**: likely valid, needs reproduction (deuda de verificación, no defecto funcional demostrado)
- **Severity**: medium

## Report (verbatim or summarized)

"[seguimiento MSF-232] Evidencia E2E en DEV: reparación con 2 ítems → comprobante en Ventas → cobro → aviso por correo (It's a Plan MSF-780)".
Es una Tarea `seguimiento` abierta al cerrar MSF-232 (spec `specs/20261028-100000-service-cobro-y-avisos`, SC-009 / T032): el E2E se escribió pero nunca se ejecutó contra un entorno real, y falta la evidencia.

## Symptom

Existe `apps/web/e2e/service-cobro-avisos.e2e.ts` (SC-009), pero no hay evidencia de que el recorrido completo funcione en DEV (reparación de 2 ítems → comprobante → cobro → correo recibido → pestaña de la ficha). Esperado: una corrida documentada y verde con el correo realmente recibido.

## Reproduction

1. Levantar el stack con Kestra y SMTP de prueba/Mailpit, y servir la web.
2. `E2E_CORREO_KESTRA=1 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm test:e2e -- service-cobro-avisos`.
3. Contra DEV (Supabase compartido) el spec aborta en la carga del módulo.
[NEEDS CLARIFICATION: qué es exactamente «DEV» (Supabase compartido + Kestra + SMTP desplegados) y quién tiene acceso a sus credenciales.]

## Suspected Code Paths

- `apps/web/e2e/service-cobro-avisos.e2e.ts:17-20` — guard `HOSTS_LOCALES` (localhost/127.0.0.1/host.docker.internal): lanza `Error` si `SUPABASE_URL` no es local. Por diseño impide ejecutar el E2E en DEV, que es lo que pide el ticket.
- `apps/web/e2e/service-cobro-avisos.e2e.ts:9-15` — el tramo del correo solo corre con `E2E_CORREO_KESTRA=1` y toma Mailpit de `MAILPIT_URL` o `http://127.0.0.1:${SUPABASE_MAILPIT_PORT ?? 4302}`; en DEV el buzón no es local.
- `apps/web/e2e/service-cobro-avisos.e2e.ts` — el estado «Cobrado» se marca desde Node porque el disparo desde cobros no tiene pantalla (F-VTA-10, FR-026), según `docs/service-tecnico.md:29`; el paso «cobro en Ventas» no se ejercita por UI.
- `docs/e2e-app.md` — no tiene fila del E2E de service-cobro-avisos (otros E2E sí figuran, p. ej. ventas-impresion con «Desvío: no se ejecutó en el entorno del Desarrollador»); falta registrar el desvío y la evidencia.
- `specs/20261028-100000-service-cobro-y-avisos/tasks.md` — T032 figura `[ ]` en tasks.md aunque `tasks/CIERRE.md` la reconcilió como `[x]` (BUG-143) sin evidencia de ejecución; incoherencia que la regla «ninguna tarea queda `[ ]`» exige resolver con evidencia o con seguimiento trazado (este ticket).
- `infra/kestra/flows/reparaciones-aviso-correo.yml` y `.test.mjs` — flow del aviso; solo probado con test del flow, no de punta a punta.

## Root Cause Hypothesis

No es un defecto de runtime: el E2E se entregó "escrito pero no ejecutado" (sin stack local ni DEV en el entorno del Desarrollador) y se trazó este seguimiento. Además el propio spec bloquea la ejecución en DEV por el guard de hosts locales (la service-role key siembra datos y crea usuarios con contraseña conocida), de modo que la evidencia pedida es inalcanzable sin cambiar la estrategia. Confianza: alta en la causa del bloqueo, media en que el recorrido pase al ejecutarse (nunca corrió, puede haber fallos latentes; p. ej. el cobro simulado desde Node).

## Proposed Remediation

**Preferred**: producir la evidencia sin debilitar el guard. (1) Ejecutar el E2E en un stack equivalente a DEV levantado localmente (`pnpm dev:supabase` + Kestra + Mailpit, `E2E_CORREO_KESTRA=1`) y adjuntar la salida de Playwright, el mensaje recibido en Mailpit y la fila `reparacion_avisos` en estado `enviado`. (2) Registrar la corrida en `docs/e2e-app.md` (fila con fecha, comando y resultado) y en `docs/service-tecnico.md`/`docs/service-cobro.md`. (3) Corregir cualquier fallo que aparezca al correrlo (hoy desconocido). (4) Dejar T032 coherente en tasks.md (`[x]` con «ver commit» o `Desvío:` con este seguimiento).

**Alternatives**:
- Permitir DEV mediante allowlist explícita (p. ej. `E2E_HOSTS_PERMITIDOS`) con datos prefijados y limpieza: da evidencia real en DEV, pero expone la service-role de un entorno compartido y contradice la regla del proyecto; requiere decisión del dueño.
- Verificación manual guiada en DEV (capturas + correo recibido) adjunta al ticket: barata, pero no repetible ni versionada.

**Files likely to change**:
- `docs/e2e-app.md`
- `docs/service-tecnico.md`
- `specs/20261028-100000-service-cobro-y-avisos/tasks.md`
- `apps/web/e2e/service-cobro-avisos.e2e.ts` (solo si la corrida revela fallos o si se elige la alternativa de allowlist)

**Tests to add or update**:
- Ejecución real de `service-cobro-avisos.e2e.ts` con `E2E_CORREO_KESTRA=1` (aserción del correo en Mailpit, aviso `enviado`, pestaña «Reparaciones» de la ficha).
- Si se agrega allowlist: test unitario del guard (host local OK, host no permitido aborta).

## Risks & Considerations

- Seguridad: service-role key y usuarios con contraseña fija no deben tocar entornos compartidos; no relajar el guard por defecto.
- Los datos sembrados deben limpiarse (el spec ya borra en `finally`); en DEV compartido podría contaminar otras corridas.
- El paso de cobro se simula desde Node (sin pantalla de disparo): la evidencia no cubre la UI de cobro de Ventas hasta F-VTA-10.
- Depende de Kestra, SMTP/Mailpit y el worker de despacho disponibles.
- Solo documentación/evidencia: `pnpm docs:check` debe pasar con el cambio.

## Open Questions

- [NEEDS CLARIFICATION: ¿«DEV» significa el stack local de desarrollo o el entorno compartido desplegado? Define si basta con la corrida local o hay que habilitar una allowlist.]
- [NEEDS CLARIFICATION: ¿hay Kestra y SMTP de prueba disponibles donde se ejecutará?]
- [NEEDS CLARIFICATION: ¿se acepta evidencia manual si el entorno compartido no admite el E2E automatizado?]

Next step: `speckit-bug-fix slug=msf-780`
