# Listas configurables

Pantalla de administración `/configuracion/listas` (menú Administración → «Listas configurables», solo
Administrador). Spec: `specs/20261024-120000-avisos-y-listas-configurables` (historia F-CFG-01, MSF-333).

## Qué edita

| Lista | Tabla (esquema) | Escritura |
|-------|-----------------|-----------|
| Motivos de stock | `dominio.motivos_movimiento` (F-STK-02, sin cambios) | RLS: `private.puede_escribir()` |
| Estados de consulta | `dominio.estados_consulta` (nueva) | RPC + RLS: `private.puede_escribir()` |

Los motivos son **la misma tabla** que edita `/stock/motivos`: el editor (`PanelMotivos` en
`apps/web/src/pages/stock/motivos.tsx`) se comparte entre ambas pantallas, no hay copia.

## Estados de consulta

- Esquema `dominio` (entidad del negocio; Principio VII). RLS por organización: select con acceso a la
  sección `consultas`, insert/update solo Administrador, sin delete (se desactiva), `anon` sin privilegios.
- Al implementar F-CFG-01, MSF-122 (Consultas) no estaba mergeada y la tabla no existía: se creó con la
  forma mínima `id, organizacion_id, nombre, activo, orden`, **sin siembra** de estados. Si MSF-122 la
  define también, su migración debe ser aditiva sobre esta.
- RPC (`public`, `security invoker`, `grant execute … to authenticated`, `revoke … from public, anon`):
  `crear_estado_consulta(p_nombre)`, `renombrar_estado_consulta(p_id, p_nombre)` y
  `cambiar_estado_estado_consulta(p_id, p_activo)`. Errores: `42501` sin permiso, `23514` nombre vacío,
  `23505` nombre repetido (sin distinguir mayúsculas ni espacios en los extremos), `P0002` inexistente.
- Un estado desactivado no se borra ni toca a las consultas que ya lo usan; el nuevo estado queda al final
  del orden. Reordenar y borrar están fuera de alcance. El `orden` se calcula como `max(orden)+1` sin bloqueo: dos altas simultáneas pueden repetir `orden`; es
  cosmético (no hay reordenamiento ni se usa como clave) y se aceptó a propósito.

- **Estados de sistema** (migración `20270325200000`, columna `es_sistema`): un estado que el flujo de la
  consulta necesita (p. ej. el de la acción «Cerrar») no se desactiva, renombra ni borra. La guarda está en la
  base (trigger `estados_consulta_proteger_sistema`, error `23514` con mensaje en castellano que la pantalla
  muestra tal cual) y en la UI (botones deshabilitados con la explicación «Es un estado de sistema: lo
  necesita el cierre de las consultas…»). Solo una migración marca un estado como de sistema (la app no puede
  crearlo ni quitarle la marca). **Hoy no hay ninguno marcado**: las consultas siguen con sus tres estados
  fijos (Nueva, En curso, Resuelta) y la lista no se siembra; el primer estado de sistema lo marca la
  migración de la funcionalidad que lo use. Pruebas: `listas_configurables.test.sql` y `listas.test.tsx`.

## Empresa activa

No aplica: las listas son de la organización, no de una empresa. Un test de la pantalla verifica que
re-renderizar no recarga ni altera las listas.

## Reversión

Migraciones aditivas `20261210130000`…`20261210130200`. Para deshacer (en una migración posterior, tras
exportar los datos): `drop function public.cambiar_estado_estado_consulta(uuid, boolean)`,
`public.renombrar_estado_consulta(uuid, text)`, `public.crear_estado_consulta(text)`, el trigger
`estados_consulta_normalizar`, `private.normalizar_estado_consulta()` y `dominio.estados_consulta`.
La pantalla se retira quitando la ruta y el ítem de menú; `/stock/motivos` sigue funcionando.
