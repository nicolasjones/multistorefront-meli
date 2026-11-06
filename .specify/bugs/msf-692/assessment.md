# Bug Assessment: Usuario removido o cuenta web de cliente sin membresía inicia y mantiene sesión en el panel

- **Slug**: msf-692
- **Created**: 2026-11-01
- **Source**: pasted text (MSF-692, It's a Plan; sin URL)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

"[Bug] Un usuario removido de la organización, o una cuenta web de cliente sin membresía, puede iniciar sesión y mantener la sesión en el panel."

## Symptom

Una persona cuya membresía fue borrada (`remover_miembro`) o una cuenta web de cliente (`cuentas_cliente`, que por diseño nunca tiene fila en `usuarios_organizacion`) completa el login y queda autenticada dentro del panel. Esperado: solo miembros activos (o superadmins) acceden al panel; un removido/cliente es rechazado con el mensaje genérico y su sesión se invalida.

## Reproduction

1. Remover un miembro con `public.remover_miembro` (hace `delete` de su fila; no revoca sesiones de Auth).
2. Ese usuario inicia sesión en `/login` con su correo y contraseña (sigue existiendo en `auth.users`), o con una sesión ya abierta recarga el panel.
3. Resultado: `login` pasa y `check()` devuelve `authenticated: true`; ve el layout protegido (`Authenticated` en `App.tsx`).
4. Igual con una cuenta web de cliente (usuario de Auth sin fila en `usuarios_organizacion` ni en `superadmins`).

[NEEDS CLARIFICATION: confirmar con negocio qué ve el removido hoy (layout vacío por RLS) — no cambia el diagnóstico.]

## Suspected Code Paths

- `apps/web/src/providers/authProvider.ts` (`login`, bloque «Un suspendido…»): consulta `usuarios_organizacion` con `maybeSingle()` y solo rechaza si `errorMembresia` o `estado === 'suspendido'`. El comentario dice explícitamente «Un superadmin sin membresía no tiene fila: pasa», así que *toda* ausencia de fila pasa (removido y cliente incluidos). No verifica `superadmins`.
- `apps/web/src/providers/authProvider.ts` (`check`): solo comprueba que haya sesión y la inactividad; nunca revalida membresía. Una sesión abierta de un usuario removido/suspendido después del login se mantiene (JWT válido hasta expirar; refresh token vigente).
- `supabase/migrations/20260909051331_remover_miembro.sql`: borra la fila pero no revoca sesiones/refresh tokens (`auth.sessions`/`auth.refresh_tokens`).
- `supabase/migrations/20261211100000_cuentas_cliente.sql`: la cuenta de cliente es un usuario de Auth normal sin membresía; comparte el mismo endpoint de login que el panel. `publico.acceso_cliente_por_dominio` solo gobierna la tienda, no el panel.
- `supabase/migrations/20260922120000_contexto_panel_operativo.sql` (`contexto_panel_actual`) y `apps/web/src/context/ContextoPanel.tsx`: ya devuelven `es_superadmin` y `organizacion_id`, pero ningún guard los usa para expulsar (`App.tsx:319` solo usa `Authenticated`).
- `private.is_superadmin()` en `supabase/migrations/20260908172920_fundacion_multitenant.sql:96`: criterio correcto para distinguir al superadmin sin membresía.

## Root Cause Hypothesis

El control de acceso al panel es «negativo»: solo se rechaza `estado='suspendido'` y la ausencia de fila se interpreta como superadmin. Falta una regla positiva «para estar en el panel hay que ser miembro activo o superadmin». Además la comprobación se hace solo en `login` (no en `check()` ni en el servidor), y `remover_miembro` no invalida las sesiones existentes. RLS evita fuga de datos (`organizacion_id()` es nulo), pero la sesión y el acceso a la UI persisten. Confianza: alta.

## Proposed Remediation

**Preferido**: (1) Regla positiva en servidor: nueva RPC (p. ej. `public.acceso_panel_permitido()`, `security definer`, `search_path=''`, `revoke ... from public, anon` + `grant execute ... to authenticated`) que devuelva true si el `auth.uid()` es superadmin o tiene fila `usuarios_organizacion` con `estado='activo'`. (2) En `authProvider.login`, tras autenticar, llamar a esa RPC; si da false o error (falla cerrado) cerrar sesión como ya se hace con el suspendido y devolver `mensajeIngresoGenerico`. (3) En `check()`, revalidar (con caché corto, para no golpear la RPC en cada navegación) y devolver `{authenticated:false, logout:true}` si ya no tiene acceso, lo que cubre sesiones abiertas. (4) En `remover_miembro` (y al suspender), revocar sesiones del usuario removido (`delete from auth.sessions where user_id = ...`) en migración nueva — aditiva, con reversión documentada.

**Alternativas**:
- Solo front (usar `contexto_panel_actual` en un guard): más simple pero no cierra la sesión de Auth ni protege otros clientes; el servidor sigue emitiendo tokens válidos.
- Auth Hook de «before sign-in» que rechace usuarios sin membresía: bloquearía también a las cuentas de cliente en la tienda (comparten Auth), por lo que exigiría distinguir por origen; mayor riesgo.

**Files likely to change**:
- `apps/web/src/providers/authProvider.ts`
- `apps/web/src/providers/authProvider.test.ts` (hoy hay un test que afirma que «sin fila ingresa»)
- `supabase/migrations/<nueva>_acceso_panel_solo_miembros.sql` (RPC + revocación de sesiones en `remover_miembro`)
- `supabase/tests/` (pgTAP) y `docs/acceso-ingreso.md`; spec `20261012-140000-acceso-y-organizacion` si aplica FR-004

**Tests to add or update**:
- Vitest: login con usuario sin fila y no superadmin → rechazado, `signOut` invocado, mensaje genérico; superadmin sin fila → ingresa; RPC con error → falla cerrado.
- Vitest: `check()` devuelve no autenticado cuando la RPC dice false.
- pgTAP: la RPC devuelve false para removido y cuenta de cliente, true para miembro activo y superadmin; `remover_miembro` elimina las sesiones; grants (anon sin execute).

## Risks & Considerations

- Superadmins sin membresía deben seguir entrando (verificar `superadmins`, no solo membresía).
- Las cuentas de cliente comparten `auth.users`: no romper el login de la tienda (`acceso_cliente_por_dominio`); el rechazo aplica solo al panel.
- Revocar `auth.sessions` es destructivo para el usuario afectado (intencional); migración aditiva con reversión explícita (CLAUDE.md).
- Costo de la RPC en `check()`: cachear unos segundos/minutos.
- Reglas del repo: RPC con grants explícitos (test pgTAP de `anon`); documentación obligatoria (`pnpm docs:check`).
- Aprendizaje previo: una cuenta confirmada sin organización no se puede re-invitar (FR-009); el rechazo de removidos es consistente con eso.

## Open Questions

- [NEEDS CLARIFICATION: ¿mensaje al removido: el genérico no revelador (recomendado) o uno específico?]
- [NEEDS CLARIFICATION: ¿el cierre de sesión de removidos debe ser inmediato (revocar sesiones) o basta con la revalidación en `check()`?]
