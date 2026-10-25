---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - supabase/functions/invitar-miembro
  - supabase/tests/database
  - apps/web/src/pages/usuarios
  - apps/web/src/pages/roles
  - apps/web/src/pages/acceso-restringido
  - apps/web/src/lib/permisos.ts
---

# Usuarios y roles (MSF-125)

Épica **MSF-125 · Acceso, organización y permisos**. Spec: `specs/20261013-120000-usuarios-y-roles/` (`spec.md`, `plan.md`, `tasks.md`). Resumen de producto: [Usuarios y roles](../producto/usuarios-y-roles.md).
Contratos detallados (no se duplican aquí): [Permisos por rol](../permisos-por-rol.md) · [Invitar usuarios](../invitar-usuarios.md).

## Alcance de entrega

`refine` (`apps/web`) y `supabase` (migraciones, RLS, RPC, Edge Function, pgTAP). Sin `kestra`, `superset` ni `workers`.

## Datos (esquema `public`, Principio VII)

Todas son de plataforma (acceso transversal), por eso `public`; con RLS por organización y sin privilegios para `anon`. DER en [Datos y DER](datos.md).

| Objeto | Migración | Cambio |
|---|---|---|
| `roles_organizacion` | `20261013130002_roles_basicos_permisos.sql` | 5 filas nuevas: `operador`, `consulta`, `mostrador`, `deposito`, `administracion` |
| `permisos_rol` | ídem | Organización × rol × sección → `edicion`/`lectura`/`ninguno`; `check` impide restringir a `administrador` |
| `permisos_rol_accion` | ídem | Organización × rol × sección × acción (`eliminar`, `exportar`, `ver_costos`) → permitido |
| `private.sembrar_permisos`, `private.nivel_seccion`, `private.puede_accion` | ídem; redefinidas en `20261014120000_usuarios_suspension_y_roles.sql` | Siembra por organización y contrato RLS; excluyen suspendidos |
| `public.guardar_matriz_permisos`, `public.restablecer_matriz_permisos` | `20261013140000_editar_matriz_permisos.sql` | Edición de la matriz (F-ROL-02), solo Administrador |
| `invitaciones_organizacion` + RPC | `20261013140001_invitaciones_usuarios.sql` y endurecimientos `20261013150000`…`20261013210000` | Invitaciones (vencen a 7 días); ver [Invitar usuarios](../invitar-usuarios.md) |
| RPC de usuarios | `20261014120000_usuarios_suspension_y_roles.sql` | `listar_usuarios_organizacion`, `cambiar_rol_miembro` (siete roles), `suspender_miembro`, `reactivar_miembro`, `remover_miembro` |
| `usuarios_organizacion.estado` | `20261012140100` (MSF-119) | Lo administra F-USR-02; traída desde `epic/MSF-138` (`tasks.md`, T029) |

Reversión: documentada en la cabecera de cada migración; son aditivas y no se ejecuta ninguna reversión en el mismo PR.

## Flujos

- **RLS:** las tablas de dominio usan `private.nivel_seccion(seccion)` / `private.puede_accion(seccion, accion)`; `private.puede_escribir()` sigue para las tablas no migradas (regresión en `permisos_por_rol.test.sql`).
- **Panel:** `PermisosPanelProvider` carga `public.permisos_actuales()`; hooks `useNivelSeccion` / `usePuedeAccion`; el menú oculta secciones `ninguno`; `accessControlProvider` usa `SECCION_POR_RECURSO` (`apps/web/src/lib/permisos.ts`).
- **Acceso restringido:** guard `RequiereAccesoSeccion` sobre las rutas con `seccionPermiso`; `App.guard.test.ts` falla si una ruta queda sin guard.
- **Invitar:** Edge Function `supabase/functions/invitar-miembro` (verifica con `puede_invitar()`); la membresía se crea al aceptar.
- **Usuarios absorbe Miembros (FR-019):** `/miembros*` redirige a `/usuarios*`; `listar_miembros_organizacion` queda sin uso en la web y se retira en un PR posterior.
- **Eventos (FR-012):** `eventos_membresia` hasta F-AUD-01 (`invitacion_enviada`, `rol_cambiado`, `suspendido`, `reactivado`); la matriz registra `permisos.matriz_guardada` / `permisos.matriz_restablecida` en `registro_actividad`.

## Pruebas

pgTAP (`supabase/tests/database/`): `permisos_por_rol`, `editar_matriz_permisos`, `invitaciones_usuarios`, `invitaciones_usuarios_endurecimiento`, `cambiar_rol_miembro_seis_roles`, `usuarios_suspension_y_roles`, `estado_usuario`, `puede_invitar`. Vitest: `pages/usuarios/list.test.tsx`, `pages/roles/list.test.tsx`, `pages/acceso-restringido/AccesoRestringido.test.tsx`, `App.guard.test.ts`. Edge Function: `pnpm test:edge:invitar-miembro`.

## Operación y límites

- Edición concurrente de la matriz: gana el último en guardar (la RPC serializa, no detecta conflictos); topes de 200 niveles y 400 acciones por guardado (`22023`).
- El rol `miembro` del template no se edita desde `/roles`; la RPC lo rechaza.
- Residuales aceptados de la Edge Function (sondeo 201/409, sin límite de frecuencia de reenvío): ver [Invitar usuarios](../invitar-usuarios.md).
- E2E de T019, T036 y T043b sin hacer por falta de suite Playwright de la app: deuda **MSF-499**.
- Extendida después por MSF-121 (rol por empresa, `usuarios_empresas`), MSF-132 (F-USR-03) y MSF-148 (solicitar acceso).
- **MSF-121** agrega `usuarios_empresas`, `usuario_empresa_activa`, la resolución por empresa de `nivel_seccion` y las RPC de asignación y cambio de empresa. Construcción interna: [Permisos por empresa](permisos-por-empresa.md).

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
