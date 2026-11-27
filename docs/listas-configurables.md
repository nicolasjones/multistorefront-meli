---
owner: tecnico
sources:
  - specs/20261024-120000-avisos-y-listas-configurables
  - apps/web/src/pages/stock/motivos.tsx
---

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

- **Estados de sistema** (migración `20270507000400`, columna `es_sistema`): un estado que el flujo de la
  consulta necesita no se desactiva, renombra ni borra. La guarda está en la
  base (trigger `estados_consulta_proteger_sistema`, error `23514` con mensaje en castellano que la pantalla
  muestra tal cual) y en la UI (botones deshabilitados con la explicación «Es un estado de sistema: lo
  necesita el flujo de las consultas…»). Solo una migración marca un estado como de sistema: la guarda frena a quien usa la app
  (`authenticated`/`anon`), pero `service_role` y las funciones `security definer` SÍ pueden marcar o desmarcar
  `es_sistema` y deben hacerlo únicamente desde migraciones. Borrar una organización arrastra sus estados en
  cascada, también los de sistema. Desde la migración `20270510000000` **los tres estados de base (Nueva, En curso y
  Resuelta) son de sistema** en toda organización (ver la sección siguiente). Pruebas: `listas_configurables.test.sql` y `listas.test.tsx`.

## Estados configurables y `consultas.estado` (MSF-595)

Los estados de la lista **sí son los que usa una consulta**. Decisión de producto (2026-11-26, delegada): el
Administrador puede agregar estados y una consulta puede quedar en cualquier estado activo de su organización. Esto
revierte la decisión previa de dejar los tres estados fijos que figura en `decisiones-2026-11-17.md`.

- **Clave estable.** `dominio.estados_consulta.clave` es el valor que guarda `dominio.consultas.estado`. Los tres de
  base conservan sus claves históricas (`nueva`, `en_curso`, `resuelta`); un estado creado por el Administrador usa su
  propio id como clave, así renombrarlo no deja consultas huérfanas. La clave no cambia nunca (el trigger lo impide a
  quien usa la app). No hay clave foránea: el check cerrado de `consultas.estado` se reemplazó por una guarda de formato
  y la validez la decide `actualizar_consulta` (se evita una FK que complicaría el borrado en cascada por organización y los
  tests de las demás áreas).
- **Siembra.** Cada organización, existente o nueva (trigger `organizaciones_sembrar_estados_consulta`), tiene los tres de base
  como `es_sistema`: no se desactivan ni se renombran. Si una organización ya había creado un estado con el mismo nombre
  que uno de base, esa fila se adopta (se reactiva y se marca de sistema) sin duplicar.
- **Elegir un estado.** `actualizar_consulta` acepta cualquier estado **activo** de la organización. Un estado inexistente
  responde `PT404` y uno desactivado `PT412` con `detail = estado` (el `PT412` sin `detail` sigue siendo el conflicto de
  edición); el detalle de códigos está en [`errores-negocio-postgrest.md`](./errores-negocio-postgrest.md).
- **Un estado que luego se desactiva.** Las consultas que ya estaban en él siguen mostrándose con su nombre y se pueden
  guardar sin cambiarlo (nota, responsable); no se puede elegir como destino desde otro estado.
- **Pantalla.** La bandeja y el detalle leen la lista (`useOpcionesEstadoConsulta`): los filtros y el selector de estado ofrecen los
  estados configurados; uno desactivado se sigue ofreciendo marcado «(desactivado)» porque puede tener consultas. El color del chip
  es el de siempre para los tres de base y neutro para los propios. La acción «Responder» sigue pasando `nueva` a `en_curso`.
- **Pruebas.** `estados_consulta_conectados.test.sql`, `listas_configurables.test.sql`, `consultas.test.sql`, `lib/consultas.test.ts`,
  `DetalleConsulta.test.tsx` y `pages/consultas/list.test.tsx`.

## Empresa activa

No aplica: las listas son de la organización, no de una empresa. Un test de la pantalla verifica que
re-renderizar no recarga ni altera las listas.

## Reversión

Migraciones aditivas `20261210130000`…`20261210130200`. Para deshacer (en una migración posterior, tras
exportar los datos): `drop function public.cambiar_estado_estado_consulta(uuid, boolean)`,
`public.renombrar_estado_consulta(uuid, text)`, `public.crear_estado_consulta(text)`, el trigger
`estados_consulta_normalizar`, `private.normalizar_estado_consulta()` y `dominio.estados_consulta`.
La pantalla se retira quitando la ruta y el ítem de menú; `/stock/motivos` sigue funcionando.
