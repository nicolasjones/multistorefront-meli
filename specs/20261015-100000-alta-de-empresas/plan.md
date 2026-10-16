# Implementation Plan: Acceso, organización y permisos · Alta de empresas

**Branch**: `epic/MSF-475-acceso-organizacion-y-permisos-alta-de-e` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

## Summary

Alta de empresas por la RPC `public.crear_empresa` (security definer) que inserta en `dominio.empresas` y copia la configuración del origen en la misma transacción, más botón y diálogo «Nueva empresa» en la pantalla Empresas existente. Sin tablas nuevas.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL en `supabase/migrations`

**Dependencies**: Refine, MUI — ya presentes; sin dependencias nuevas

**Storage**: Postgres self-hosted (Supabase), `dominio.empresas` existente

**Testing**: Vitest + Testing Library; pgTAP en `supabase/tests/database/`. E2E Playwright: la suite de la app depende de MSF-499; si no existe al implementar, se cubre con Vitest + pgTAP y la tarea se cierra con desvío trazado.

**Delivery scope**: `refine`, `supabase`

**Constraints**: migración aditiva; nunca service-role en el navegador; `anon` sin acceso; sin asumir 2 empresas; sin copiar HTML/CSS del prototipo.

## Constitution Check

- **I / VII**: no hay tabla nueva; `dominio.empresas` (esquema `dominio`, re-verificado en spec, plan y tareas) mantiene RLS por organización; el alta pasa por RPC que resuelve la organización en el servidor. ✔
- **II**: spec con permisos, fallos, datos; la auditoría `empresa.creada` queda como decisión abierta. ✔
- **III**: alta atómica; la unicidad por índice hace el reintento seguro (no duplica). ✔
- **VI**: no cambia la navegación (ítem «Empresas» existente, ruta `/empresas`); diálogo con estados compartidos, teclado/lector, 320/768/1440 px, sin UUID visible; sin peso inicial extra (diálogo liviano, sin carga diferida necesaria). ✔
- **VIII**: `docs/empresas.md` + esta spec. ✔
- Sin violaciones; sin Complexity Tracking.

## Diseño de datos

Migración `supabase/migrations/<ts>_alta_de_empresas.sql` (aditiva):

1. **Pre-chequeo** documentado: `select organizacion_id, lower(btrim(nombre)), count(*) from dominio.empresas group by 1,2 having count(*) > 1;` debe dar 0 filas antes de aplicar; si no, renombrar a mano esos datos (la migración no los toca).
2. `create unique index empresas_organizacion_nombre_uq on dominio.empresas (organizacion_id, lower(btrim(nombre)));`
3. `private.copiar_configuracion_empresa(p_origen uuid, p_destino uuid)`: punto de extensión, `security definer`, `set search_path = ''`. Hoy copia lo existente por empresa (si no hay tabla de configuración, no hace nada); cada épica futura agrega sus tablas ahí **excluyendo dominio y cuentas**. Sin `grant` a `authenticated`/`anon` (solo la invoca la RPC).
4. `public.crear_empresa(p_nombre text, p_copiar_de uuid default null) returns dominio.empresas`, `security definer`, `set search_path = ''`: exige `private.puede_escribir()`; organización = `private.organizacion_id()`; recorta nombre y valida no vacío; si hay origen, exige que sea de la misma organización; `insert`; captura `unique_violation` y la traduce a un error reconocible (`errcode` propio/mensaje estable) para el campo Nombre; llama a la copia. `revoke … from public, anon; grant execute … to authenticated`.
5. Sin cambios de RLS ni de grants de tabla (sigue sin INSERT directo).

**Reversión** (en una migración posterior, no en este PR): `drop function public.crear_empresa(text, uuid); drop function private.copiar_configuracion_empresa(uuid, uuid); drop index dominio.empresas_organizacion_nombre_uq;`. Las empresas creadas no se pierden al revertir (son filas de `empresas`); el revert del PR (`git revert -m 1`) deja funciones e índice huérfanos hasta esa migración.

## Diseño de frontend

- `pages/empresas/list.tsx`: botón «Nueva empresa» en el encabezado y fila final «Nueva empresa» con «Crear», visibles solo con `usePuedeEscribir()`. Abren `DialogoNuevaEmpresa`.
- `components/empresas/DialogoNuevaEmpresa.tsx` (nombre a confirmar con la convención del repo): campo Nombre, selector «Copiar configuración de» alimentado por `useEmpresas` (todas, cualquier cantidad; deshabilitado con mensaje si no hay), Cancelar / «Crear empresa»; deshabilita el envío mientras guarda; foco gestionado; errores en campo; error de servidor con reintento.
- `hooks/useCrearEmpresa.ts`: llama `supabaseClient.rpc('crear_empresa', …)`, mapea el error de nombre repetido, refresca `useEmpresas` y emite la confirmación «Empresa creada como borrador» con el patrón compartido de éxito.
- Sin cambios en `destinosPanel.ts` ni en `App.tsx` (rutas y menú existentes).

## Seguridad y concurrencia

Revisión `authz-security`: RPC `security definer` con organización resuelta en servidor, rol validado con `puede_escribir()` (excluye suspendidos), origen verificado contra la organización, `search_path` vacío, `anon` revocado. Concurrencia: índice único + captura de `unique_violation`; alta y copia en una transacción.

## Pruebas

- pgTAP `supabase/tests/database/alta_de_empresas.test.sql`: administrador crea (con y sin origen); nombre vacío y repetido (también variando mayúsculas y espacios); miembro/operador/consulta/suspendido rechazados; origen de otra organización rechazado; sin INSERT directo; `anon` sin ejecución (el test de `anon` existente sigue verde); `rls_en_toda_tabla` y aislamiento siguen verdes; 1/2/3 empresas.
- Vitest: botón y fila visibles solo con escritura; diálogo (campos, textos, errores, estado sin origen, doble envío, éxito «Empresa creada como borrador»); a11y básica.
- E2E: ver Testing.

## Documentación

`docs/empresas.md`: sección «Alta de empresas» (RPC, qué se copia y qué no, punto de extensión para épicas futuras, reversión, término «borrador»). Fila de `docs/roadmap-template.md` al cierre (paso manual).

## Resultado de implementación (MSF-277)

- T001: pre-chequeo de nombres duplicados documentado en el encabezado de la migración (no toca datos). Esquema re-verificado: `dominio.empresas` (dominio); sin tablas nuevas; funciones de plataforma/acceso.
- Inventario de configuración por empresa: ninguna migración tiene `empresa_id` ni referencia a `dominio.empresas`; `private.copiar_configuracion_empresa` valida el origen y hoy no copia nada (FR-010).
- Desvío menor: el refresco de `useEmpresas` lo hace la pantalla (`onCreada` → `refetch`) en lugar del hook `useCrearEmpresa`, para no acoplar el hook a una instancia de listado.
