# Permisos por rol: contrato `nivel_seccion` / `puede_accion`

Spec: `specs/20261013-120000-usuarios-y-roles/` (F-ROL-01, MSF-258, épica MSF-125).
Migración: `supabase/migrations/20261013130000_roles_basicos_permisos.sql`.
Pruebas: `supabase/tests/database/permisos_por_rol.test.sql`.

Toda tabla de dominio de las demás épicas (Catálogo, Stock, Ventas, …) DEBE usar este
contrato en sus políticas RLS en vez de `private.puede_escribir()`.

## Modelo

| Elemento | Esquema | Naturaleza |
|---|---|---|
| `roles_organizacion` | `public` | Catálogo de roles: `administrador`, `operador`, `consulta`, `mostrador`, `deposito`, `administracion` y `miembro` (template). |
| `permisos_rol` | `public` | Organización × rol × sección → `edicion` / `lectura` / `ninguno`. |
| `permisos_rol_accion` | `public` | Organización × rol × sección × acción (`eliminar`, `exportar`, `ver_costos`) → permitido. |

Son mecanismos de acceso transversales (Principio VII), por eso viven en `public`. Cada
organización tiene su propia matriz, sembrada al crearla (trigger sobre `organizaciones`) con los
valores de `Roles.dc.html`; las organizaciones existentes se rellenaron en la migración.
El Administrador no se puede restringir: lo garantizan `check` de base de datos, no solo la UI.

Secciones (clave → nombre): `inicio`, `productos`, `categorias`, `stock`, `cotizacion_dolar`,
`empresas`, `mercado_libre`, `rentabilidad`, `usuarios_permisos`, `actividad`, `consultas`,
`ventas`, `clientes`, `proveedores`, `reportes`, `service_tecnico`.

## Funciones (esquema `private`, `GRANT EXECUTE` a `authenticated`)

- `private.nivel_seccion(seccion text) returns text` → `'edicion' | 'lectura' | 'ninguno'` para el
  usuario actual en la organización de `private.organizacion_id()`. Sin fila en `permisos_rol` usa
  la matriz inicial; sin membresía o sección desconocida devuelve `'ninguno'` (nunca acceso total).
  Un superadmin con organización activa equivale a administrador.
- `private.puede_accion(seccion text, accion text) returns boolean`. `eliminar` exige `edicion`;
  `exportar` y `ver_costos` exigen al menos `lectura`; una acción desconocida es `false`.

### Cómo usarlas en una tabla de dominio

```sql
create policy productos_select on dominio.productos for select to authenticated
  using (organizacion_id = (select private.organizacion_id())
         and (select private.nivel_seccion('productos')) in ('lectura', 'edicion'));

create policy productos_insert on dominio.productos for insert to authenticated
  with check (organizacion_id = (select private.organizacion_id())
              and (select private.nivel_seccion('productos')) = 'edicion');

create policy productos_delete on dominio.productos for delete to authenticated
  using (organizacion_id = (select private.organizacion_id())
         and (select private.puede_accion('productos', 'eliminar')));
```

Envolver la llamada en `(select …)` para que Postgres la evalúe una sola vez por consulta.

## Panel

- RPC `public.permisos_actuales()` devuelve nivel y acciones por sección del usuario actual
  (solo para presentar; la autorización real es RLS).
- `PermisosPanelProvider` (dentro de `ContextoPanelProvider`) la carga; `useNivelSeccion(seccion)`
  y `usePuedeAccion(seccion, accion)` la exponen.
- Menú: un destino con `seccionPermiso` en `destinosPanel.ts` no aparece si la sección es `ninguno`.
- `accessControlProvider`: los recursos listados en `SECCION_POR_RECURSO` (`lib/permisos.ts`)
  niegan todo con `ninguno`, permiten `list`/`show` con `lectura` y el resto con `edicion`.
  **Cada épica agrega su recurso a `SECCION_POR_RECURSO` y su destino con `seccionPermiso`.**

## Compatibilidad y límites

- `private.puede_escribir()` no cambia: las tablas existentes (`clientes`, …) conservan su
  comportamiento hasta que cada una migre a este contrato (pgTAP de regresión incluido).
- **`clientes` (decisión de la devolución del Revisor, PR #33):** su RLS de escritura sigue en
  `puede_escribir()` (solo administrador), así que `RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR`
  (`lib/permisos.ts`) exige además administrador para crear/editar/eliminar en la UI; la matriz no
  promete más de lo que la base acepta. **Riesgo aceptado:** `clientes_select` sigue abierta a todo
  miembro de la organización, de modo que `ninguno` en Clientes oculta menú y rutas pero no impide
  leer vía API REST directa. Se cierra al migrar `clientes` a `nivel_seccion` (épica de ventas/clientes),
  no aquí: migrarla ahora rompería la regresión de `puede_escribir()`.
- `accessControlProvider` comparte una sola consulta de permisos por usuario (promesa en vuelo + TTL de 5 s,
  `obtenerPermisosActualesCacheado`); F-ROL-02 debe llamar `invalidarCachePermisos()` al editar la matriz.
- El rol `miembro` del template queda en solo lectura donde el prototipo da lectura, y sin acceso
  a las secciones reservadas a Administrador/Administración (nunca gana acceso que no tenía).
- Los valores iniciales de las acciones (`eliminar`, `exportar`, `ver_costos`) son una
  **extensión propuesta**, pendiente de confirmar con el cliente. Se editan con F-ROL-02.
- **Pendiente MSF-119**: cuando exista `usuarios_organizacion.estado`, `private.nivel_seccion`
  DEBE excluir `suspendido` (`and u.estado <> 'suspendido'`). La columna no existe todavía en esta
  rama, así que hoy la función no puede filtrarlo; US4 (F-USR-02) queda bloqueada hasta entonces.
- Sin policies de escritura sobre las tablas de permisos: la edición llega con F-ROL-02 vía RPC
  que verifica que quien llama es Administrador de esa organización.

## Guard de rutas (F-ROL-03)

Toda ruta de sección con `seccionPermiso` DEBE envolverse en `RequiereAccesoSeccion`
(`apps/web/src/components/RequiereAccesoSeccion.tsx`); hoy cubre `/clientes*` y `/miembros*`; `inicio` (`/`) queda fuera a propósito (es el destino de
redirección, envolverla causaría un bucle). `apps/web/src/App.guard.test.ts` cruza `DESTINOS_PANEL` con
`App.tsx` (importado con `?raw`, sin `node:fs`) y falla si una ruta con `seccionPermiso` queda sin guard.
El guard exige acceso a la sección (`lectura` o `edicion`), no distingue `create`/`edit`: en esas
rutas un usuario con `lectura` ve el formulario pero RLS rechaza la escritura (UX, no fuga). Las etiquetas de rol viven en
`ETIQUETA_ROL` (`apps/web/src/lib/permisos.ts`); un rol nuevo se agrega ahí. El guard
es defensa de UX (RLS es la autoridad) y falla cerrada: solo `lectura`/`edicion` abren la sección; un
nivel nulo tras cargar se trata como denegado. El rol mostrado sale de `usuarios_organizacion`
filtrado por `user_id` y por la organización activa (`useOrganizacionDeTrabajo`, por si la persona
pertenece a varias); si falla, se muestra «actual» y nunca una pantalla en blanco.

## Reversión

Documentada en la cabecera de la migración (solo válida mientras ninguna tabla de dominio use las
funciones). La migración es aditiva: no modifica ni elimina objetos existentes.
