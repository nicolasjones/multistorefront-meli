# Bug Verification: Verificación de dominio — validar `ip_publica` y cerrar el socket TLS al vencer

- **Slug**: msf-797
- **Tested**: 2026-11-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

Los dos hallazgos P3 de la revisión de seguridad de cierre (MSF-779) no se reproducen: la base rechaza una
`ip_publica` que no sea una IPv4 pública y la comprobación TLS cierra (o cancela) siempre la conexión que abre,
también al vencer el timeout. No se detectaron regresiones en los tests del área (Edge Function, panel y
documentación). El pgTAP de base de datos no se pudo correr en este entorno (no hay acceso al socket de Docker):
lo corre el CI contra una base limpia.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) — el timeout cierra/cancela la conexión | `pnpm test:edge:verificar-dominio-tienda` | pass | 26/26. Cubre: cierre al terminar, timeout en la conexión TCP (con llegada tardía y cancelación de la pendiente), timeout en el handshake TLS, certificado inválido, puerto cerrado, `close()` sobre conexión ya cerrada y ausencia de temporizadores colgados. |
| Reproduction (post-fix) — la base rechaza la IP no pública | `supabase/tests/database/tienda_dns_ip_publica_msf797.test.sql` | not-run | Requiere `supabase test db --local`; en este entorno el socket de Docker da `permission denied`. Lo corre el CI (33 casos). |
| New / updated tests | `pnpm test:edge:verificar-dominio-tienda` | pass | El caso nuevo «el timeout durante la conexión TCP cancela la conexión pendiente» **falla** si se quita `cancelacion.abort()` (verificado a propósito y revertido: 25/26 con un fallo). |
| Regression suite (panel) | `pnpm --filter @platform/web exec vitest run src/lib/tiendaDominio.verificar.test.ts src/pages/empresas/tienda/Dominio.test.tsx` | pass | 35/35 (motivo `plataforma_no_configurada` incluido). |
| Contrato de la Edge Function | `node scripts/verificar-openapi.mjs` | pass | «Contratos OpenAPI: OK (2 contrato(s))». El contrato no cambia: no hay request, respuesta ni error nuevos. |
| Lint / type-check | `pnpm lint` | pass | Exit 0; solo warnings preexistentes del repo (ninguno en lo tocado). |
| Build | `pnpm build` | pass | Exit 0 (`✓ built in 5.67s`). |
| Documentación | `pnpm docs:check` | pass | «Documentación de cambios: OK» y «Migraciones OK» (no hay migración nueva en este commit). |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack en ok; **gitleaks** no pudo correr (corre en Docker y no hay permiso sobre el socket). Lo corre el CI. |
| Type-check de Deno | `deno check` de `tls.ts` / `index.ts` | not-run | No hay `deno` instalado en este entorno. `tls.ts` y `handler.ts` no importan Deno y se ejercitan con `node --test`; el cableado de `index.ts` lo valida el despliegue de la función. |

## Output Excerpts

```
$ pnpm test:edge:verificar-dominio-tienda
▶ comprobarTls (MSF-797)
  ✔ conexión y certificado correctos: «activo» y cierra la conexión TLS una sola vez
  ✔ el timeout durante la conexión TCP responde «pendiente» y cierra la conexión que llegue tarde
  ✔ el timeout durante la conexión TCP cancela la conexión pendiente
  ✔ el timeout durante el handshake TLS intenta cerrar la TCP y cierra la TLS que llegue tarde
  ✔ un certificado inválido responde «error» y cierra la conexión TCP
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

```
$ pnpm --filter @platform/web exec vitest run src/lib/tiendaDominio.verificar.test.ts src/pages/empresas/tienda/Dominio.test.tsx
 Test Files  2 passed (2)
      Tests  35 passed (35)
```

```
$ pnpm test:db
failed to inspect docker image: permission denied while trying to connect to the Docker daemon socket
```

## Residual Risks

- **El pgTAP no se corrió localmente** (`permission denied` sobre `/var/run/docker.sock`): la evidencia de la base
  (33 casos de `tienda_dns_ip_publica_msf797.test.sql`) es la del CI, no de esta corrida.
- **Limitación D-5 (conhecida y documentada):** `Deno.startTls` consume la conexión TCP; si el handshake TLS queda
  colgado, el socket TLS en curso no se puede cerrar desde JS. Ahora la conexión **pendiente de conectar** sí se
  cancela al vencer; el handshake en vuelo sigue dependiendo del runtime. Impacto acotado (una conexión a la IP de la
  plataforma, a lo sumo una verificación cada 10 s por tienda).
- **No verificado en un Deno real:** el comportamiento de `Deno.connect` con `signal` (que el runtime cierre el socket
  pendiente al abortar) y el de `close()` sobre una TCP ya consumida por `startTls`. `tls.ts` está preparado para
  ambos casos (tolerar `BadResource`), pero el cableado de `index.ts` solo lo valida el despliegue.
- **Por entorno:** el seed deja `203.0.113.24` (TEST-NET-3) como `ip_publica`; hay que cargar la IP real de cada
  entorno (la de dev, `212.90.120.53`, es pública) y validar el CHECK donde la fila haya quedado con una IP no pública.

## Recommendation

Cerrar el bug — verificado con los tests del área en verde y sin regresiones; lo que queda es la evidencia del pgTAP
en el CI y la carga de la `ip_publica` real por entorno (tarea de operación, no de código).
