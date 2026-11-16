---
owner: tecnico
sources:
  - design/pantallas/Opiniones.dc.html
  - design/pantallas/Opiniones.inventory.json
---

# Opiniones de clientes (MSF-467)

**Épica:** MSF-467 · **Componente:** Tiendas online · **Alcance:** `etapa2` · **Prioridad:** P2
(provisoria).

**Estado:** **no implementada**. No hay spec, historias, migraciones, rutas, RPC ni tests de Opiniones en
este repositorio. La única fuente disponible es el artboard del prototipo.

Resumen para quien usa el panel: [Opiniones de clientes](../producto/opiniones-de-clientes.md).

## Evidencia del estado

| Qué se buscó | Resultado |
|---|---|
| Spec de la épica | No existe `specs/*opiniones*` ni una carpeta de spec con `spec.md` para Opiniones. |
| Rutas o pantallas | `apps/web/src` no tiene ninguna coincidencia de «opiniones» ni una ruta de moderación. |
| Tablas y migraciones | `supabase/migrations` no tiene tablas, columnas ni funciones de opiniones. |
| Tests | No hay pgTAP ni Playwright con el rótulo `[MSF-467:...]`. |
| Prototipo | `design/pantallas/Opiniones.dc.html` e `Opiniones.inventory.json` existen y describen la moderación. |
| Paridad pantalla↔prototipo | `specs/20261017-193000-paridad-pantallas/inventario-pantallas-prototipo.md:48` lista `Opiniones` entre los prototipos **sin pantalla implementada**. |

La épica se creó a pedido y sus documentos de origen solo mencionan Opiniones en el roadmap de Etapa 2
(`docs/system-design/roadmap.md:37`). La propia épica pide **no arrancar sin historias redactadas**.

## Qué muestra el prototipo (solo referencia visual)

El artboard `Tienda · Opiniones (Etapa 2)` (`design/pantallas/Opiniones.dc.html:97-125`) muestra una
pantalla de **moderación**, no el formulario público:

| Zona | Contenido |
|---|---|
| Encabezado | «Opiniones de clientes · Etapa 2» y la aclaración de que las nuevas quedan pendientes hasta aceptarlas o rechazarlas y que solo las aceptadas se muestran en la tienda (`:97`). |
| Filtro por tienda | «Todas las tiendas», San Javucho y Mundo JC; nota de que cada opinión pertenece a la tienda donde se compró y que la empresa activa filtra la lista (`:97`). |
| Indicadores | Pendientes, Aceptadas y Rechazadas (`:97`, `:124`). |
| Filtros de estado | Pendientes, Aceptadas, Rechazadas y Todas (`:98`, `:125`). |
| Fila | Persona, tienda, fecha, estado, puntuación sobre 5, comentario y producto (`:99`, `:113`). |
| Acciones | **Aceptar** y **Rechazar**; una aceptada solo se puede rechazar y una rechazada solo aceptar (`:100`, `:122-123`). |
| Aviso | «Opinión aceptada: ya se muestra en la tienda» y «Opinión rechazada» (`:123`). |

El inventario del prototipo no declara tablas, campos ni diálogos; solo los botones `Aceptar` y `Rechazar`
(`design/pantallas/Opiniones.inventory.json`).

**No es contrato.** El prototipo no define el formulario público, el modelo de datos, los permisos, la
respuesta del equipo ni la publicación en la tienda.

## Qué falta y quién lo debe resolver

| Pendiente | Dueño | Evidencia |
|---|---|---|
| Redactar historias y `spec.md`/`plan.md`/`tasks.md` de la épica (`opiniones`) | Producto / Spec Kit | La épica no trae historias. |
| Definir tablas, estados, RLS y RPC de opiniones | Supabase | No hay migraciones de Opiniones. |
| Implementar la pantalla de moderación en el panel | Refine | No hay ruta ni pantalla. |
| Implementar el formulario público para dejar la opinión | Tiendas online | El prototipo no lo muestra. |
| Definir si el equipo responde y cómo | Producto | El objetivo de la épica menciona «responde»; el prototipo no lo muestra. |
| Capturas del manual | Documentador | No se pueden generar sin pantalla implementada; `pnpm docs:capturas` requiere specs en `apps/web/e2e/capturas/`. |
| Tests E2E y pgTAP | QA / Playwright | No existe ningún test con rótulo `MSF-467`. |

## Modelo de datos: sin cambios de esquema

No hay tablas, columnas, políticas ni migraciones de Opiniones. Tampoco hay DER nuevo: el nombre de la
tabla, sus estados y sus relaciones se definen recién en la spec. Cuando exista, esta sección debe
actualizarse junto con [Datos y DER](datos.md) y, si aplica, un ERD Archify.

## Contratos y flujos: no definidos

No hay funciones de `publico` ni de `private`, ni rutas de panel, ni endpoints de API para Opiniones. El
flujo de moderación del prototipo (pendiente → aceptada/rechazada → publicación en la tienda) es **diseño
visual**, no un contrato implementado.

## Empresa activa

El prototipo anota que cada opinión pertenece a la tienda donde se compró y que la empresa activa filtra la
lista (`design/pantallas/Opiniones.dc.html:97`). Cuando se implemente, la pantalla debe filtrar por la
empresa activa, admitir «Todas mis empresas», recargar todas las consultas al cambiar de empresa,
reencuadrar la paginación y descartar selecciones de la empresa anterior (Principio VIII de la
constitución; ver [Empresa activa](../empresa-activa.md)).

## Guía de prueba técnica

**Hoy no hay nada ejecutable:** no hay pantalla, tabla ni test. Los rótulos quedan reservados para cuando se
redacten las historias; no se inventan criterios de aceptación.

| Rótulo | Qué debe probar cuando exista | Estado |
|---|---|---|
| `[MSF-467:T001]` | Moderación: una opinión nueva queda pendiente; aceptar la publica y rechazar no la publica; los estados se pueden revertir. | Pendiente de historia y test. |
| `[MSF-467:T002]` | Tienda pública: solo se ven las opiniones aceptadas del producto y de esa tienda. | Pendiente. |
| `[MSF-467:T003]` | Empresa activa: la lista se filtra por tienda, «Todas mis empresas» muestra todas y cambiar de empresa recarga y limpia la selección. | Pendiente. |
| `[MSF-467:T004]` | Respuesta del equipo: definir y probar el contrato (el prototipo no lo muestra). | Pendiente de definición. |

**Sin video:** no hay pantalla implementada que filmar. **Automatización:** no existe ningún caso Playwright
ni pgTAP con `MSF-467`; queda pendiente de automatizar.

## Capturas

TODO (dueño: Documentador): cuando exista la pantalla, agregar la spec de captura en
`apps/web/e2e/capturas/` y generar las imágenes con `pnpm docs:capturas`; la página de producto las
referencia en `docs/producto/img/opiniones-de-clientes/`. No se inventa una imagen del prototipo.

## Referencias

- Prototipo: `design/pantallas/Opiniones.dc.html:97-125`.
- Inventario del prototipo: `design/pantallas/Opiniones.inventory.json`.
- Paridad pantalla↔prototipo:
  `specs/20261017-193000-paridad-pantallas/inventario-pantallas-prototipo.md:48`.
- Roadmap: `docs/system-design/roadmap.md:37`.
