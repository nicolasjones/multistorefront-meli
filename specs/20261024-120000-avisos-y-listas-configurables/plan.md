# Implementation Plan: Plataforma · Avisos y listas configurables

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-189 · **Rama**: `epic/MSF-189-plataforma-avisos-y-listas-configurables`
**Alcance de entrega**: `refine` + `supabase` + `kestra`. Sin `superset` ni `workers` (el envío usa el `MailSend` de Kestra con SMTP genérico; no hay lógica de negocio fuera de SQL).

## Resumen

F-NOT-01: un catálogo de tipos de aviso y las preferencias por usuario en `public`; los componentes emiten avisos con `private.emitir_aviso`, que resuelve destinatarios (acceso por sección + preferencia) y encola en `public.avisos_pendientes` agrupando por destinatario y tipo en una ventana de 15 minutos. Un flow de Kestra reclama los grupos vencidos, envía un correo por grupo y registra el resultado con reintentos. F-CFG-01: una pantalla de administración que edita los motivos de stock (la tabla existente) y los estados de consulta. Dos historias independientes, cada una con **su propia migración aditiva**.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI, kit `EncabezadoPagina`/`ContenidoAdaptable`/estados compartidos). Preferencias en `apps/web/src/pages/cuenta/avisos.tsx`; listas en `apps/web/src/pages/configuracion/listas.tsx`, reutilizando el editor de `pages/stock/motivos.tsx`. Hooks y libs en `apps/web/src/hooks` y `apps/web/src/lib`.
- **Base**: Supabase self-hosted. RPC en `public` con `security invoker` y `set search_path = ''`; `emitir_aviso` y el reclamo son `security definer` (únicos caminos de escritura a la cola), verifican organización y permisos dentro de la función.
- **Permisos**: `private.nivel_seccion` resuelve la sesión actual; para filtrar destinatarios ajenos se agrega `private.nivel_seccion_de_usuario(user_id, sección)` (T004). Escritura de listas: `private.puede_escribir()` (Administrador), como `motivos_movimiento`.
- **Concurrencia**: reclamo con `for update skip locked` y vencimiento del reclamo; marca de enviado idempotente.
- **Kestra**: `infra/kestra/flows/enviar-avisos.yml` con Schedule por minuto, rol de base propio de mínimo privilegio (patrón de `despachador-programado`), SMTP `KESTRA_SMTP_*` (patrón de `aviso-fallo-copias`), valores escapados en el HTML. Sin secretos en Git: solo `.env.example`.
- **Estado actual verificado** (repo/grafo): existen `private.nivel_seccion`, `private.organizacion_id`, `private.puede_escribir`, `dominio.motivos_movimiento` (+ `/stock/motivos`), `public.despachos_ejecucion` (outbox de ejecuciones, **no** de correo), `usuarios_empresas`, flows de Kestra y el SMTP genérico. **No existen**: `tipos_aviso`, `preferencias_aviso`, `avisos_pendientes`, `estados_consulta` (los estados los define MSF-122, sin mergear), `nivel_seccion_de_usuario`, ni las rutas `/cuenta/avisos` y `/configuracion/listas`. Se proponen en las migraciones de abajo; ninguna se asume.
- **Dependencias externas**: MSF-125 (F-NOT-01), MSF-136 y MSF-122 (F-CFG-01). Bloquea a MSF-224, MSF-265 y MSF-155.

## Migraciones (una por historia, aditivas, con reversión en el encabezado)

| Historia | Migraciones | Esquema | Reversión |
|---|---|---|---|
| F-NOT-01 | `20261024120000…120600` (catálogo, preferencias, listar, cola, agrupación, reclamo, resultado) | `public` (tablas) · `private` (funciones) | `drop` de funciones, luego tablas, en una migración posterior |
| F-CFG-01 | `20261024130000…130200` (estados de consulta, RPC, activar) | `dominio` | `drop` de funciones; la tabla solo si la creó esta migración y sin datos |

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS en las 4 tablas; `avisos_pendientes` sin políticas para `authenticated`; pgTAP con dos organizaciones. |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia y auditoría | Reclamo sin doble toma, marca de enviado idempotente, estado, intentos, `enviado_en` y error útil por aviso. |
| IV Despliegues independientes | El flow de Kestra se despliega aparte; sin Compose raíz. |
| V Simplicidad | SMTP y Kestra ya existentes; sin worker ni servicio nuevo; ventana como constante de base. |
| VI Panel operable | Rutas `/cuenta/avisos` (menú de la cuenta, todos los roles con tipo visible) y `/configuracion/listas` (Administración, icono de ajustes, solo Administrador); estados de carga/vacío/error/éxito compartidos; teclado, lector y 320/768/1440 px; sin identificadores técnicos visibles; pantallas con carga diferida. Sin rutas anteriores que mantener. |
| VII Esquemas | `tipos_aviso`, `preferencias_aviso`, `avisos_pendientes` → `public` (plataforma/transversal); `estados_consulta` → `dominio` (negocio); `motivos_movimiento` sin cambio. Re-verificado en cada fase y en el PR. |
| VIII Empresa activa | **No aplica**: preferencias del usuario y listas de la organización; se declara en la matriz y se prueba que cambiar de empresa no altera las pantallas (SC-005, SC-006). |
| VIII Documentación | `docs/avisos-por-correo.md`, `docs/listas-configurables.md`, roadmap y `pnpm docs:check` (cierre). |

## Contratos

Declarados en [contracts/avisos-y-listas.md](./contracts/avisos-y-listas.md). Sin cambios de firma de objetos existentes: no hay `BREAKING`.

## Pruebas

pgTAP por tema (`supabase/tests/database/avisos_*.test.sql`, `listas_configurables.test.sql`), Vitest de ambas pantallas, validación del flow de Kestra (`pnpm test:kestra:copias`, `pnpm infra:config`), E2E de cierre, `rls_en_toda_tabla`. Validación por historia: `pnpm test:db`, `pnpm lint`, `pnpm build`, `pnpm test:web`.

## Riesgos

- **Proveedor de correo no definido** (Decisiones 6): el código usa SMTP genérico; sin remitente verificado los correos pueden caer en spam.
- **MSF-122 sin mergear**: el integrador de consulta nueva (T017) y `estados_consulta` (T018) dependen de su forma final; se verifica antes de migrar y, si no se puede, se traza como `[Deuda MSF-189]`.
- **Estados de sistema de la consulta** (Decisiones 7): desactivar uno con lógica atada podría romper Consultas.
- **Ventana de 15 min** sin confirmar con el cliente (Decisiones 1): retrasa hasta 15 min el primer correo.
