# Implementation Plan: Mercado Libre · Ml conexión de cuentas

**Spec**: `specs/20261024-130000-ml-conexion-de-cuentas/spec.md` · **Contratos**: `contracts/ml-conexion-de-cuentas.md`
**Branch**: `epic/MSF-129-mercado-libre-ml-conexion-de-cuentas` · **Delivery scope**: `refine`, `supabase`, `kestra`, `workers`

## Resumen

Cinco historias sobre un modelo nuevo de cuentas de canal (`dominio.cuentas_canal` + `dominio.cuenta_canal_empresas`) que reutiliza el mecanismo OAuth/Nango del template pero **no** su esquema (D1: `conexiones_oauth` admite una sola conexión por organización e integración).

- **F-MLC-01**: tablas, RPC, Edge Functions de sesión y confirmación, registro de la integración, pantalla «sin cuentas», diálogo de conexión, ítem de navegación y funcionalidad.
- **F-MLC-02**: `listar_cuentas_canal` y listado con estados y tarjeta «Alcance de la integración».
- **F-MLC-03**: reautorizar y desconectar (diálogo, revocación en Nango, conservación).
- **F-MLC-04**: worker + flow de Kestra de renovación, exclusión por cuenta, fallo → «Requiere reautorización». Empieza con una verificación documentada de Nango (FR-306).
- **F-MLC-05**: `asignar_empresas_cuenta_canal` y tarjeta «Cuentas que usa <empresa>» en la ficha.

## Contexto técnico

- Stack: Refine + MUI (`apps/web/src/pages/mercado-libre/*`, `pages/empresas/PestanasEmpresa.tsx`), Supabase self-hosted (migraciones, RPC `security definer`, Edge Functions en `supabase/functions/`), Kestra (`infra/kestra/flows/`), worker en `workers/` siguiendo `workers/CONTRATO.md`, pgTAP en `supabase/tests/database/`, Vitest.
- Base reutilizada (verificada): `providers/nango` (`conectarOAuth`), Edge Function `iniciar-sesion-oauth` como patrón, `registrar_integracion_oauth`, `private.nivel_seccion`, `private.registrar_actividad`, `dominio.depositos_empresas` + `private.validar_deposito_empresa` como patrón de relación y trigger, `SelectorEmpresas`, `EstadosPagina`, `destinosPanel.ts` (grupo `canales`), `docs/adoptar-conexiones-oauth.md`.
- El grafo (`graphify-out/graph.json`) existe; el estado se confirmó contra las migraciones. No se actualizó el grafo.

## Constitución — verificación

| Principio | Cumplimiento |
|---|---|
| I. Aislamiento | RLS por `organizacion_id` en las dos tablas nuevas; sin escritura directa; claves de Nango solo en servidor/worker; nada de service-role en el navegador. |
| II. Spec antes de código | Esta spec; cada tarea cita FR/SC. |
| III. Idempotencia y auditoría | `unique (organizacion_id, canal, usuario_externo_id)`; renovación idempotente y exclusiva por cuenta; actividad `mercado_libre.*` con actor y motivo sanitizado. |
| IV. Despliegues independientes | Flow de Kestra y worker con configuración propia; sin Compose raíz. |
| VI. Panel | Ítem en Canales tras Empresas (icono Link, solo Administrador), rutas `/mercado-libre` y `/empresas/:id/mercado-libre`, estados compartidos, 320/768/1440 px. |
| VII. Esquemas | `dominio.cuentas_canal`, `dominio.cuenta_canal_empresas` (y condicional `dominio.bloqueos_renovacion`) → `dominio`; fila de catálogo en `public.integraciones_oauth`. Re-verificar en tareas, implementación y PR; pgTAP recorre `public` + `dominio`. |
| VIII. Empresa activa | Listado: no aplica (cuentas de la organización); ficha: empresa de la ficha, con test de cambio de empresa. Declarado en la matriz. |

## Diseño por historia

### F-MLC-01
1. Migración `…_cuentas_canal_tablas.sql`: tablas, estados (`pendiente`, `autorizada`, `requiere_reautorizacion`, `desconectada`), unique por usuario de Mercado Libre, RLS solo lectura, trigger de misma organización, reversión documentada.
2. Migración `…_cuentas_canal_conexion.sql`: `iniciar_conexion_cuenta_canal`, `confirmar_conexion_cuenta_canal`, limpieza de `pendiente` abandonadas, actividad.
3. Edge Functions `iniciar-sesion-canal` y `confirmar-conexion-canal` (patrón de `iniciar-sesion-oauth`).
4. Alta de la integración `mercado_libre` en `integraciones_oauth` y funcionalidad `mercado_libre` (`docs/registrar-funcionalidad-desde-migracion.md`).
5. UI: `pages/mercado-libre/index.tsx` (pantalla sin cuentas + espera), diálogo de conexión con `SelectorEmpresas`, ruta en `App.tsx`, ítem en `destinosPanel.ts`.

### F-MLC-02
Migración `…_cuentas_canal_listar.sql` (`listar_cuentas_canal`); tabla y chips en `pages/mercado-libre/` (la página alterna entre vacío y listado), tarjeta «Alcance de la integración».

### F-MLC-03
Migración `…_cuentas_canal_desconectar.sql`; Edge Function `desconectar-cuenta-canal`; regla de misma cuenta en `confirmar-conexion-canal`; acciones y diálogo en el listado.

### F-MLC-04
Verificación de Nango (documento en `docs/`), migración `…_cuentas_canal_renovacion.sql` (`registrar_renovacion_cuenta_canal`, conteo de reintentos; `bloqueos_renovacion` solo si D2 lo exige), `workers/renovar-autorizacion-ml/`, flow `infra/kestra/flows/renovar-autorizacion-ml.yml`, variables en `.env.example`.

### F-MLC-05
Migración `…_cuentas_canal_asignar_empresas.sql`; tarjeta y pestaña «Mercado Libre» en la ficha de empresa.

Cada historia trae SU migración con su timestamp (todas posteriores a `20261202130100`); no se encadenan entre sí. F-MLC-02, F-MLC-04 y F-MLC-05 dependen de la tabla de F-MLC-01; F-MLC-03 además del listado de F-MLC-02 (las acciones viven en sus filas).

## Riesgos

- **Proveedor de Mercado Libre en Nango no verificado** y duración del token (Mercado Libre expira el acceso en horas): FR-306 lo resuelve primero y define qué vencimiento se muestra como «Vence en N días».
- **Aprobación de permisos de la aplicación por Mercado Libre** puede demorar: se pide antes de empezar la etapa (supuesto de la épica).
- Concurrencia de renovación: test dedicado (SC-003).
- Defaults pendientes de OK de Nicolás: D1…D9.

## Documentación (obligatoria)

`docs/mercado-libre-conexion-de-cuentas.md` (guía: flujo, estados, permisos, variables de Nango, reversión), actualizar `docs/adoptar-conexiones-oauth.md` §5 (mapeo), fila en `docs/roadmap-template.md` al cerrar, `.env.example` del worker, comentarios de migración con reversión, `pnpm docs:check` verde.
