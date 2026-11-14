# Bug Fix: Verificación de dominio — validar `ip_publica` y cerrar el socket TLS al vencer

- **Slug**: msf-797
- **Fixed**: 2026-11-14
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

La IP de la plataforma (`public.tienda_dns_plataforma.ip_publica`) deja de validarse solo por formato: la base la
rechaza si no es una IPv4 enrutable (loopback, redes privadas, CGNAT, link-local, multicast, reservadas, octetos
fuera de 0–255) y las dos RPC que la leen dejan de usarla mientras la fila no cumpla. La comprobación TLS de
`verificar-dominio-tienda` pasa a ser la dueña de la conexión que abre: la cierra al terminar, al vencer los 5 s y
también si llega tarde; además, la conexión que seguía **pendiente** de conectar se cancela al vencer (se le pasa
una señal de cancelación a `Deno.connect`), así que no queda esperando a que la promesa resuelva.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270323100100_tienda_dns_ip_publica_publica.sql` | added | `private.ip_publica_valida(text)` + CHECK `tienda_dns_plataforma_ip_publica` (`NOT VALID` y validación con aviso) y las dos RPC con la guarda (`plataforma_no_configurada` 22023). Commit `93fd00e3`; `06e806e3` le da `execute` a `service_role` (lo exige el guard del CI). |
| `supabase/functions/verificar-dominio-tienda/tls.ts` | modified | La conexión pendiente se cancela al vencer el tiempo (señal de cancelación) — este commit. |
| `supabase/functions/verificar-dominio-tienda/index.ts` | modified | Cablea `Deno.connect({ …, signal })` — este commit. |
| `supabase/functions/verificar-dominio-tienda/tls.test.ts` | added test | Caso «el timeout durante la conexión TCP cancela la conexión pendiente» — este commit. |
| `supabase/functions/verificar-dominio-tienda/handler.ts` / `handler.test.ts` | modified | 503 `plataforma_no_configurada` sin consultar DNS ni abrir conexiones (commit `93fd00e3`, caso en `handler.test.ts`). |
| `supabase/tests/database/tienda_dns_ip_publica_msf797.test.sql` | added test | pgTAP de la IP pública (rangos, bordes, notación estricta, CHECK y las dos RPC). Commit `93fd00e3`; `06e806e3` agrega el caso de privilegio de `service_role`. |
| `openapi/verificar-dominio-tienda.json` | modified | Documenta el 503 `plataforma_no_configurada` (commit `93fd00e3`). |
| `apps/web/src/lib/tiendaDominio.ts`, `…/Dominio.tsx` | modified | El aviso del panel traduce `plataforma_no_configurada` a un mensaje propio (commit `f5d8f4a5`). |
| `docs/tiendas-online.md`, `docs/tecnico/tienda-dominio-y-publicacion.md` | modified | Documentan el CHECK, el 503 y el cierre del socket; este commit agrega la cancelación de la conexión pendiente. |

## Diff Highlights

```ts
// tls.ts: el dueño de la conexión la cancela al vencer el tiempo
const cancelacion = new AbortController()
const trabajo = (async () => {
  const abierta = await operaciones.conectar(ipPlataforma, cancelacion.signal)
  …
})()
temporizador = setTimeout(() => {
  vencido = true
  rechazar(new Error('timeout'))
  // El socket que quedó pendiente de conectar se cancela acá (no cuando la promesa resuelva más tarde).
  cancelacion.abort()
}, tiempoMs)
```

```ts
// index.ts: el cableado real de Deno
conectar: (ip, senal) => Deno.connect({ hostname: ip, port: 443, signal: senal }),
```

## Tests Added or Updated

- `supabase/functions/verificar-dominio-tienda/tls.test.ts::el timeout durante la conexión TCP cancela la conexión pendiente` — la señal que se le pasa a `conectar` queda abortada al vencer el tiempo (si se saca el `abort()`, el caso falla).
- `supabase/functions/verificar-dominio-tienda/tls.test.ts::el timeout durante la conexión TCP responde «pendiente» y cierra la conexión que llegue tarde` — la conexión que llega después del vencimiento se cierra.
- `supabase/functions/verificar-dominio-tienda/tls.test.ts::el timeout durante el handshake TLS intenta cerrar la TCP y cierra la TLS que llegue tarde` — limitation D-5 (el handshake en vuelo no se puede abortar desde JS).
- `supabase/functions/verificar-dominio-tienda/handler.test.ts::una IP de plataforma no pública responde 503 sin consultar DNS ni abrir conexiones`.
- `supabase/tests/database/tienda_dns_ip_publica_msf797.test.sql` — 33 casos: rangos rechazados, bordes admitidos, notación estricta, TEST-NET-2/3 y la IP de dev admitidas, CHECK que rechaza loopback/10/192.168/172.16/300.x/multicast, y las dos RPC con una fila no pública.

## Local Verification

- Commands run: `pnpm test:edge:verificar-dominio-tienda` → 26/26 en verde (antes 25).
- Commands run: `pnpm lint` → exit 0 (solo warnings preexistentes del repo).
- Commands run: `pnpm build` → exit 0 (`✓ built in 5.67s`).
- Commands run: `pnpm --filter @platform/web exec vitest run src/lib/tiendaDominio.verificar.test.ts src/pages/empresas/tienda/Dominio.test.tsx` → 35/35.
- Commands run: `node scripts/verificar-openapi.mjs` → «Contratos OpenAPI: OK (2 contrato(s))».
- Commands run: `pnpm docs:check` → OK (documentación de cambios y migraciones).
- Commands run: `pnpm calidad` → todo en ok salvo **gitleaks**, que corre en Docker y en este entorno no hay permiso sobre el socket (`permission denied … /var/run/docker.sock`); lo corre el CI.
- Manual checks: se comprobó que el caso nuevo **falla** si se saca `cancelacion.abort()` (25/26, un fallo) y se restauró el código.
- No se pudo correr localmente: `pnpm test:db` (pgTAP) necesita el socket de Docker (`permission denied`); lo corre el CI contra una base limpia.

## Deviations from Assessment

- El assessment ya decía que el parche no debía duplicarse (los commits `93fd00e3`, `f5d8f4a5` y `06e806e3` ya lo traían): no se volvió a implementar la validación de la IP ni la lógica de cierre.
- Lo que sí quedaba abierto —y es lo que se cambia acá— es que la conexión **pendiente** de conectar solo se cerraba cuando la promesa resolvía más tarde: si el `SYN` no recibía respuesta, el socket quedaba abierto hasta que el sistema lo soltara. Ahora se cancela al vencer los 5 s.
- No se creó migración nueva: la del hallazgo (1) (`20270323100100`) ya está aplicada y versionada en la base del PR; la versión `20270323100301` queda libre por si otra historia la necesita.

## Follow-ups

- **Limitación D-5 (abierta, documentada):** `Deno.startTls` consume la conexión TCP; si el handshake TLS queda colgado, el socket TLS en curso no se puede cerrar desde JS (solo se intenta cerrar la TCP, que ya fue consumida). Impacto acotado: una conexión a la IP de la plataforma, a lo sumo una verificación cada 10 s por tienda. Cerrarlo exigiría una API de cancelación del handshake.
- **Por entorno:** cargar la `ip_publica` real (el seed deja `203.0.113.24`, que es de documentación) y, si alguna fila quedó con una IP no pública, correr `alter table public.tienda_dns_plataforma validate constraint tienda_dns_plataforma_ip_publica` (la migración avisa con `raise warning`).
- El type-check de `index.ts` con `deno check` sigue sin poder correrse en este entorno (no hay `deno` instalado y no resuelve `npm:@supabase/supabase-js`); lo valida el despliegue de la función.
