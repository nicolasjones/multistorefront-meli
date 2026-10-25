---
owner: producto
sources:
  - specs
---

# Empresa activa (F-ROL-06)

Selector de la barra superior para elegir con qué empresa trabaja el usuario.
Spec: `specs/20261016-140000-permisos-por-empresa/` (épica MSF-121, historia F-ROL-06).
Construcción interna: [Permisos por empresa](tecnico/permisos-por-empresa.md).

## Qué resuelve y para quién

Una persona que administra o atiende varias tiendas de la misma organización necesita decirle al panel
con cuál está trabajando, porque su rol puede ser distinto en cada una. Con este selector elige la
**empresa activa** y, desde ese momento, las secciones por empresa (Ventas, Consultas, Reportes) aplican
el rol que tiene en esa tienda, tanto en pantalla como en la base de datos. El Administrador de la
organización ve todas las empresas; el resto, solo las que tiene asignadas.

**Límites:** la empresa activa no cambia la empresa de la ruta ni la del enlace «Cambiar a» de
Configuración (F-EMP-05); no se guarda en la URL; no requiere volver a iniciar sesión. Las reglas por
empresa en las tablas de Ventas, Consultas y Reportes llegan con sus propias épicas (MSF-139, MSF-275,
MSF-156, MSF-182).

## Qué se ve

- Botón **Empresa activa: <nombre>** en el encabezado del panel, junto al selector de F-EMP-05.
- Al abrirlo: solo las empresas a las que el usuario accede (el Administrador, todas las de su
  organización), con la activa marcada y su rol en cada una.
- Con **una sola** empresa es una etiqueta fija, sin menú. Sin empresas accesibles no se muestra.
- Estados: cargando (indicador), error de carga (botón «Reintentar empresas»), error al cambiar
  (aviso `role="alert"`). Funciona con teclado; el botón se achica con el ancho (320/768/1440 px).
- Con cambios sin guardar en la pantalla, elegir otra empresa abre un diálogo «¿Cambiar de empresa?»
  (**Seguir acá** / **Cambiar igual**). Cancelar no cambia nada.

## Cómo funciona

1. `public.empresas_para_selector()` devuelve las empresas accesibles (`private.empresas_accesibles()`),
   cuál es la activa válida y el rol en cada una (`private.rol_en_empresa`).
2. `public.cambiar_empresa_activa(p_empresa_id)` valida el acceso (42501 si la empresa es ajena, de otra
   organización, inexistente o el usuario está suspendido), hace upsert en `public.usuario_empresa_activa`
   y registra `usuario.empresa_activa_cambiada` en la misma transacción. Elegir la que ya es la activa no
   escribe ni registra.
3. El panel llama `invalidarCachePermisos()` y recarga `PermisosPanelProvider` (`recargar()`): los
   botones de edición pasan a reflejar el rol de la nueva empresa (secciones por empresa de F-ROL-04).

La empresa activa **persiste en base** (no en la URL ni en `localStorage`): al volver a entrar, o desde
otro dispositivo, se conserva. Ambas RPC: `revoke … from public, anon` + `grant … to authenticated`.
La tabla no tiene escritura directa para `authenticated`; esta RPC es el único camino.

## Qué debe hacer cada pantalla o diálogo

La empresa activa no es sólo del encabezado: **toda pantalla o pop-up que lea o
escriba datos de empresa debe declararlo y respetarlo** (constitución, Principio
VIII). El prototipo es la fuente de verdad; por ejemplo, `Clientes.dc.html` dice:
«Si elegís una empresa en la barra superior, se filtra por esa tienda».

Checklist para una pantalla o diálogo:

1. **Alcance declarado:** ¿filtra por la empresa activa, muestra todas, o no
   aplica? Si no aplica, decilo con el motivo.
2. **Al cambiar de empresa:** se invalidan y recargan **todas** las consultas de
   datos de la pantalla (no alcanza con permisos), se reencuadra la paginación
   y se descarta la selección que ya no existe. Nunca quedan filas ni totales de
   la empresa anterior.
3. **Diálogos abiertos:** se cierran con aviso o se reabren acotados a la nueva
   empresa; jamás guardan datos cargados de la anterior bajo la nueva.
4. **Una sola fuente de verdad:** no se guarda la empresa en estado local ni se
   duplica el selector.
5. **Prueba:** un test que cambia de empresa y verifica que la pantalla (o el
   pop-up) se reencuadra. En la spec, la fila «Empresa activa» de
   `## Matriz pantalla↔criterios` es obligatoria (`pnpm matriz:check`).

Referencia de la regresión: Clientes y la barra superior (datos de la empresa
anterior); se repitió en Productos, Servicios, Modelos y pop-ups.

### Cómo se reencuadra (implementación)

Al cambiar la empresa, `useEmpresaActiva` invalida **todas** las consultas de
datos de Refine (`invalidates: ['all']`, además de `access`) y avisa el cambio
(`lib/cambioEmpresaActiva.ts`). `ContenidoPorEmpresa` envuelve el `<Outlet />`
con `key={version}`: la pantalla ruteada se remonta y, con ella, sus hooks
vuelven a pedir datos, la paginación y la selección arrancan de cero y los
diálogos abiertos se cierran. El encabezado y el selector quedan montados; no
hay recarga del navegador.

## Límite con F-EMP-05

| | `SelectorEmpresa` (F-EMP-05) | `SelectorEmpresaActiva` (F-ROL-06) |
|---|---|---|
| Qué cambia | la empresa de la **ruta** (`/empresas/edit/:id`) | la empresa **activa persistida** |
| Persistencia | URL | `usuario_empresa_activa` |
| Afecta permisos | no | sí (secciones por empresa: ventas, consultas, reportes) |

Conviven en `EncabezadoPanel`; F-ROL-06 no modifica el comportamiento del selector por ruta (FR-013).

## Esquemas y reversión

Sin tablas nuevas. Migración aditiva `20261016150100_cambiar_empresa_activa.sql` (renombrada desde `20261016150000` al integrar la épica de clientes; funciones en `public`). Migración posterior `20261017120000_cambiar_empresa_activa_serializada.sql`: lock advisory por usuario para que dos primeras elecciones concurrentes no dupliquen el evento.
Reversión: `drop function public.empresas_para_selector(); drop function public.cambiar_empresa_activa(uuid);`.
Prueba: `supabase/tests/database/cambiar_empresa_activa.test.sql`.
