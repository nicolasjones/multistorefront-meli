---
owner: tecnico
sources:
  - specs/20261016-140000-permisos-por-empresa
  - supabase/migrations
  - supabase/tests/database
  - apps/web/src
---

# Permisos por empresa: construcción interna (MSF-121)

Épica **MSF-121 · Acceso, organización y permisos · Permisos por empresa**. Spec:
`specs/20261016-140000-permisos-por-empresa/`. Historias: F-ROL-04 (rol por empresa),
F-ROL-06 (selector de empresa activa) y F-ROL-07 (asignar empresas desde Usuarios).

Lado de producto: [Empresa activa](../empresa-activa.md), [Usuarios y empresas](../usuarios-y-empresas.md)
y [Permisos por rol](../permisos-por-rol.md). Modelo de datos en el DER:
[Datos · Permisos por empresa](datos.md#permisos-por-empresa-msf-121).

## Alcance de entrega

`refine` (`apps/web`) y `supabase` (migraciones, RLS, RPC y pgTAP). Sin `kestra`, `superset` ni `workers`.
La matriz de permisos editable (F-ROL-02) es de MSF-125 y no se toca acá.

## Datos

Tablas de plataforma (acceso transversal) en `public`; `dominio.empresas` solo se referencia.

| Objeto | Migración | Cambio |
|---|---|---|
| `public.usuarios_empresas` | `20261016140100_roles_por_empresa.sql` | **Nueva.** Rol por empresa: `user_id`, `empresa_id`, `organizacion_id`, `rol_id`, `created_at`; PK `(user_id, empresa_id)`. `check` limita `rol_id` a `operador`, `consulta`, `mostrador`, `deposito`, `administracion`; el trigger `usuarios_empresas_validar` exige que usuario y empresa sean de la organización de la fila. RLS: `select` para el propio usuario o quien gestiona membresías; sin escritura directa. |
| `public.usuario_empresa_activa` | ídem | **Nueva.** Una fila por usuario (`user_id` PK → `auth.users`, `empresa_id` → `dominio.empresas`, `updated_at`). RLS: lectura propia; sin escritura directa (solo la RPC de F-ROL-06). |
| `public.invitaciones_organizacion.asignaciones` | `20261016160100_asignar_empresas_usuario.sql` | **Alterada.** Columna `jsonb not null default '[]'` con `check` de arreglo; guarda `[{"empresa_id": uuid, "rol_id": text}]` para aplicar al aceptar la invitación. |
| `public.usuarios_organizacion` | existente | Solo se lee (membresía, rol de organización y `estado`); sin cambios. |
| `public.roles_organizacion` | existente | FK de `rol_id`; sin cambios (los cinco roles por empresa ya existen desde MSF-125). |
| `public.organizaciones` | existente | FK de `organizacion_id`; sin cambios. |
| `dominio.empresas` | existente | FK de ambas tablas nuevas; solo se lee (`id`, `nombre`, `activa`). |
| `auth.users` | existente | FK `usuario_empresa_activa.user_id`; sin cambios. |
| `public.registro_actividad` | existente | Recibe `usuario.empresa_activa_cambiada` y `usuario.empresas_asignadas`; sin cambios de esquema. |

Migraciones aditivas; cada cabecera documenta su reversión. La `20261017120000_cambiar_empresa_activa_serializada.sql`
solo redefine la RPC de F-ROL-06 (`create or replace`, mismos grants) para tomar un lock advisory por
usuario antes del primer cambio.

## Resolución de permisos

`private.nivel_seccion(seccion)` y `private.puede_accion(seccion, accion)` conservan su firma; cambian
la resolución vía `private.roles_de_referencia(seccion)` (`20261016140100`):

- **Compartidas** — `private.secciones_compartidas()`: `productos`, `categorias`, `stock`, `clientes`,
  `proveedores`, `cotizacion_dolar`. Nivel = el mejor (`edicion` > `lectura` > `ninguno`) entre los roles
  del usuario en sus empresas **activas**.
- **Por empresa** — `private.secciones_por_empresa()`: `ventas`, `consultas`, `reportes`. Nivel = el rol
  en la empresa activa **válida**; sin empresa activa válida → `ninguno`.
- **Resto** (Inicio, Empresas, Mercado Libre, Rentabilidad, Usuarios y permisos, Actividad, Service
  técnico), **el Administrador** y **quien no tiene asignaciones**: el rol de organización, como antes.
- `private.empresas_accesibles()` devuelve las empresas activas de la organización (todas para el
  Administrador; las asignadas para el resto) y exige membresía `activa`. `private.empresa_activa_valida()`
  devuelve la activa solo si sigue siendo accesible; `private.rol_en_empresa(empresa)` resuelve el rol
  (o `administrador`).

Las funciones son `security definer` con `search_path = ''`; `private.nivel_de_rol`,
`private.accion_de_rol` y `private.roles_de_referencia` no se exponen a `authenticated`.

## RPC

| RPC | Contrato |
|---|---|
| `public.cambiar_empresa_activa(p_empresa_id uuid)` | F-ROL-06. Valida sesión, organización y acceso con `private.empresas_accesibles()`; upsert en `usuario_empresa_activa` y evento `usuario.empresa_activa_cambiada` en la misma transacción. Si ya es la activa no escribe ni registra. Errores: `42501` sin sesión/membresía o empresa sin acceso; `22023` empresa nula. `revoke … from public, anon` + `grant … to authenticated`. |
| `public.empresas_para_selector()` | F-ROL-06. Devuelve `(id, nombre, es_activa, rol_id)` de las empresas accesibles, ordenadas por nombre; alimenta el selector. |
| `public.asignar_empresas_usuario(p_target_user_id uuid, p_asignaciones jsonb)` | F-ROL-07. Solo quien gestiona membresías; reemplazo atómico de `usuarios_empresas` con lock advisory por usuario. Si no hay activa válida, fija la primera (por nombre). Registra `usuario.empresas_asignadas`. Errores: `42501` sin permiso o empresa ajena; `22023` formato, rol, empresa repetida o destino Administrador; `P0002` usuario fuera de la organización. |
| `public.guardar_asignaciones_invitacion(p_invitacion_id uuid, p_asignaciones jsonb)` | F-ROL-07. Valida igual y guarda el jsonb normalizado en la invitación pendiente; la llama la Edge Function `invitar-miembro`. |
| `public.listar_empresas_usuarios()` | F-ROL-07. `(user_id, empresa_id, empresa_nombre, rol_id)` de la organización activa; solo para quien gestiona membresías. |
| `public.aceptar_invitacion()` | Redefinida en `20261016160100` (mismo contrato): aplica las asignaciones al crear la membresía e ignora empresas borradas o movidas entre invitar y aceptar. |

Detalle de errores y flujo de invitación: [Invitar usuarios](../invitar-usuarios.md).

## Frontend (`apps/web`)

| Ruta / archivo | Qué hace |
|---|---|
| `src/lib/empresaActiva.ts` | `listarEmpresasSelector()` llama `empresas_para_selector`; `cambiarEmpresaActiva()` llama la RPC. |
| `src/hooks/useEmpresaActiva.ts` | Carga las empresas, ejecuta el cambio y, al volver, invalida la caché de permisos (`invalidarCachePermisos()`), recarga `PermisosPanelProvider` e invalida todas las consultas de Refine (`invalidates: ['all']`). «Última petición gana» al cargar. |
| `src/components/navegacion/SelectorEmpresaActiva.tsx` | Botón/menú de la barra superior con la activa marcada y el rol por empresa; etiqueta fija si hay una sola; estados de carga y error; confirmación «¿Cambiar de empresa?» con cambios sin guardar (FR-011). |
| `src/components/navegacion/EncabezadoPanel.tsx` | Convive con `SelectorEmpresa` de F-EMP-05, que no cambia: ese elige la empresa de la ruta, este la empresa activa persistida (FR-013). |
| `src/components/pagina/ContenidoPorEmpresa.tsx` + `src/hooks/useVersionEmpresaActiva.ts` | Remonta la pantalla ruteada al cambiar la empresa (`key={version}`): paginación, selección y diálogos abiertos arrancan de cero; el encabezado queda montado. |
| `src/pages/usuarios/list.tsx` + `src/components/usuarios/SelectorAsignacionesEmpresa.tsx` | Columna **Empresas** con «Tienda: Rol»; diálogos Invitar y Editar con empresas y rol por empresa; Editar ofrece los seis roles y Administrador = todas las empresas. |
| `src/lib/asignacionesEmpresas.ts` | Llama `asignar_empresas_usuario` y `listar_empresas_usuarios`; normaliza el jsonb. |

La autorización real es RLS: el panel sólo refleja el nivel resuelto por `public.permisos_actuales()`.

## Pruebas

- pgTAP: `supabase/tests/database/roles_por_empresa.test.sql` (resolución por empresa, aislamiento entre
  organizaciones, roles rechazados, `anon`), `cambiar_empresa_activa.test.sql` (cambio, persistencia,
  evento, empresa ajena) y `asignar_empresas_usuario.test.sql` (atomicidad, permisos, quitar todas,
  evento). Regresión: `permisos_por_rol.test.sql`, `invitaciones_usuarios*.test.sql` y
  `rls_en_toda_tabla.test.sql`.
- Vitest: `components/navegacion/SelectorEmpresaActiva.test.tsx`, `hooks/useEmpresaActiva.test.tsx`,
  `components/pagina/ContenidoPorEmpresa.test.tsx`, `pages/usuarios/list.test.tsx` y
  `components/usuarios/SelectorAsignacionesEmpresa.test.tsx`.
- E2E: `apps/web/e2e/permisos-por-empresa.e2e.ts` (asignar, cambiar de empresa y comprobar el nivel que
  decide los botones de edición). Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y no corre en el
  CI público; ver [E2E de la app](../e2e-app.md).

## Operación y límites

- Un usuario pertenece a **una sola organización**; lo nuevo es la pertenencia a varias empresas dentro de
  ella. `usuarios_organizacion.user_id` sigue siendo PK.
- Un no Administrador **sin asignaciones** conserva el rol de organización; la restricción por empresa
  empieza al asignarle empresas. Con asignaciones pero sin activa válida queda en `ninguno` para las
  secciones por empresa.
- La empresa activa **persiste en base**, no en la URL ni en `localStorage`. La tabla no tiene escritura
  directa para `authenticated`: la RPC es el único camino.
- La matriz editable y sus acciones son de MSF-125 ([Permisos por rol](../permisos-por-rol.md)); acá solo
  se resuelve el rol que la alimenta.
- Reglas RLS por empresa en las tablas de Ventas, Consultas, Reportes, Inicio y Service técnico: son de
  MSF-139, MSF-275, MSF-156 y MSF-182, no de esta épica.
- Revisión de seguridad `authz-security` del cierre (T023) sin hallazgos abiertos: RLS en ambas tablas,
  `anon` sin privilegios, RPC `security definer` con `search_path = ''` y validación en el cuerpo,
  asignación serializada por usuario y sin escalada a Administrador. Evidencia en
  [Permisos por rol § Revisión de seguridad de cierre](../permisos-por-rol.md#revision-de-seguridad-de-cierre-msf-121-t023).

## Reversión

Cada migración es aditiva y documenta su camino en el encabezado. Orden para deshacer la épica: revertir
F-ROL-06 y F-ROL-07, restaurar `private.nivel_seccion` / `private.puede_accion` a la definición de
`20261014120000_usuarios_suspension_y_roles.sql`, borrar los helpers de `20261016140100` y recién
entonces `drop table public.usuario_empresa_activa; drop table public.usuarios_empresas;`.
Para deshacer el PR completo: `git revert -m 1 <merge>`.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
