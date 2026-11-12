# Tareas: Tiendas online · Diseño del prototipo

Regla: ninguna tarea queda `[ ]`; cada una trae su evidencia o un `Desvío:`.

## Fase 1: tramo A (datos)

- [x] T001 Tipografías `Bricolage Grotesque` y `DM Sans` en la lista cerrada (migración `20270302100000_tienda_tipografias_prototipo.sql`, `TIPOGRAFIAS` en `lib/tiendaIdentidad.ts`). Evidencia: commit `acc9e49b`.
- [x] T002 Color «Barra superior y pie» (`color_barra`, migración `20270302200000_tienda_color_barra.sql`; `colorBarra` en la identidad y en la pestaña con chequeo de contraste). Evidencia: commit `94ed436e`.
- [x] T003 Campo `eslogan` (80 caracteres) en el contenido (migración `20270302300000_tienda_eslogan.sql` y pestaña de textos). Evidencia: commit `e4808b62`.
- [x] T004 Foto de categoría en `publico.categorias_por_dominio` (migración `20270302400000_tienda_categorias_imagen.sql`, una sola pasada). Evidencia: commit `e6ec8bbe`; docs en `7ae9c967`.

## Fase 2: tramo B (front público)

- [x] T005 Identidad aplicada a toda la tienda: `layout/IdentidadTiendaContexto.tsx` (un fetch por host; tema MUI, variables `--tienda-*` con `--tienda-color-barra`, fuentes con `preconnect`), `theme.tienda` en `tema/temaTienda.ts` y la vista previa del panel con la identidad completa. Evidencia: `TemaTienda.test.tsx` y `layout/tiendaDiseno.test.tsx` (tema en `/catalogo`, una sola lectura, base sin identidad).
- [x] T006 Logo en el encabezado (a la izquierda, nombre en texto sin logo) y en el pie (blanco); `TemaTienda` ya no lo repite en la portada. Evidencia: `layout/tiendaDiseno.test.tsx` («logo y barra superior», «pie oscuro»).
- [x] T007 Barra superior (`layout/BarraSuperior.tsx`): eslogan o bienvenida, WhatsApp y correo; sin datos no se muestra; `BarraBienvenida` no duplica. Evidencia: `layout/tiendaDiseno.test.tsx` («sin eslogan…», «con eslogan y una bienvenida distinta», «un dato ausente…»).
- [x] T008 Encabezado y barra de categorías del prototipo («Principal» + categorías en mayúsculas con subrayado de 3 px; buscador con lupa; tope de 6 + «Más categorías» intacto). Evidencia: `layout/tiendaDiseno.test.tsx` («encabezado y categorías»), `EnrutadorTienda.test.tsx`.
- [x] T009 Pie oscuro (`layout/PieCategorias.tsx`): logo, eslogan, texto del pie, Categorías, Información, Contacto, bloque legal y «© año empresa»; el texto del pie sale del layout (no duplicado). Evidencia: `layout/tiendaDiseno.test.tsx` («pie oscuro»), `PieInformacion.test.tsx`, `enlaces-contacto.test.tsx`.
- [x] T010 Tarjetas de categoría con foto (URL firmada, una sola llamada; recuadro neutro sin foto). Evidencia: `rutas/inicio/CategoriasInicio.test.tsx`.
- [x] T011 Bloque «Consultas por WhatsApp / Escribinos» al final de la portada. Evidencia: `rutas/inicio/ConsultasInicio.test.tsx`.
- [x] T012 Tipografías: títulos y cuerpo por el tema MUI con la identidad. Evidencia: `TemaTienda.test.tsx` («aplica la identidad al tema MUI…»), `tema/temaTienda.test.tsx`.
- [x] T013 Contenido y contacto leídos una vez por host y compartidos por contexto (`useContenidoPublico`, `useContactoTienda`). Evidencia: `layout/tiendaDiseno.test.tsx` («se leen una sola vez por host»).
- [x] T014 Accesibilidad: axe a 320, 768 y 1440 px en el layout, la sección de categorías y el bloque de consultas. Evidencia: `layout/tiendaDiseno.test.tsx`, `CategoriasInicio.test.tsx`, `ConsultasInicio.test.tsx`.

## Fase 3: documentación y validación

- [x] T015 `docs/tiendas-online.md` (sección «Diseño del prototipo en el front público») y esta spec con su matriz pantalla↔criterios. Evidencia: `pnpm docs:check` y `pnpm matriz:check` en verde (ver informe del tramo B).
- [x] T016 Validación: `tsc -b`, `oxlint src`, `vite build` y guards de `scripts/`. Evidencia: informe del tramo B.
- [x] T017 Verificación visual contra el prototipo con Playwright. Desvío: no se corrió; la memoria libre del servidor estaba por debajo de 1 GB; queda para la verificación en dev.
- [x] T018 Vista previa del panel muestra la foto de categoría. Desvío: `vista_previa_tienda` no devuelve `imagen`; se tolera `null` (recuadro neutro) en lugar de otra migración; seguimiento si se quiere paridad.
