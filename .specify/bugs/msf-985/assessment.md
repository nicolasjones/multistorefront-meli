# Bug Assessment: las filas «Cambio de empresa activa» llenan el historial de Actividad

- **Slug**: msf-985
- **Created**: 2026-11-18
- **Source**: pasted text (seguimiento de MSF-618, épica MSF-585, abierto por el Revisor del PR #638)
- **Verdict**: valid
- **Severity**: low

## Report (verbatim o resumido)

> **Qué se vio**: En la pantalla **Actividad**, cada vez que alguien alterna entre empresas aparece una fila «Cambio de
> empresa activa». Con varias personas cambiando de tienda a lo largo del día, el historial se llena de filas que no
> cuentan un cambio de negocio.
>
> **Por qué no entra en MSF-618**: MSF-618 es un arreglo de **formato**. Quitar la fila es un cambio de **comportamiento**:
> el evento lo escriben `public.cambiar_empresa_activa` y `public.empresa_activa_todas` (migraciones `20261016150100` y
> `20261018170000`) y lo verifican los pgTAP `cambiar_empresa_activa.test.sql` y `empresa_activa_todas.test.sql`.
> Decidirlo acá tocaría el contrato de F-ROL-06, que es de otra historia.
>
> **Qué hay que decidir**: (1) dejar de registrar el evento; (2) dejarlo pero marcarlo como ruido, que no ocupe la lista;
> (3) dejarlo como está.

## Síntoma

Cada alternancia de empresa activa escribe una fila «Cambio de empresa activa» en la lista de Actividad, así que el
historial de una organización con varias personas que cambian de tienda mezcla cambios de contexto con cambios de
negocio. Lo esperado es que el historial muestre cambios de negocio; el cambio de empresa activa, que además se
registra en la misma transacción que el cambio, no debería ocupar la lista.

## Reproducción

1. Entrar al panel con una persona que tenga dos empresas asignadas.
2. En la barra superior, cambiar de empresa activa (o elegir «Todas mis empresas»).
3. Ir a **Administración → Actividad**: aparece una fila de tipo «Cambio de empresa activa» por cada cambio.
4. Repetir los cambios durante el día: la lista se llena de esas filas y de ningún otro evento.

## Rutas de código sospechosas

- `supabase/migrations/20261016150100_cambiar_empresa_activa.sql:58` — `public.cambiar_empresa_activa` registra
  `usuario.empresa_activa_cambiada` en la misma transacción del cambio (FR-014 de F-ROL-06).
- `supabase/migrations/20261018170000_empresa_activa_todas.sql:105` — `public.usar_todas_las_empresas` registra el mismo
  tipo para el pase a la vista combinada.
- `supabase/migrations/20261016120000_registro_actividad.sql:221` — `public.listar_actividad` devuelve todo lo que hay en
  `public.registro_actividad` que pasa los filtros (sin filtro por tipo).
- `supabase/migrations/20270421000200_actividad_por_empresa_accesible.sql:62` — `public.exportar_actividad` (el CSV) usa el
  mismo filtro que la pantalla.
- `supabase/tests/database/cambiar_empresa_activa.test.sql:91` y `supabase/tests/database/empresa_activa_todas.test.sql:68` —
  los pgTAP que verifican que el evento se registre.

## Hipótesis de causa raíz

No es un error de código: el comportamiento es el que F-ROL-06 pidió (registrar el cambio de empresa activa) y el ruido
aparece porque la lista de Actividad no distingue los eventos de contexto de los de negocio. Confianza: alta.

## Remediación propuesta

**Preferida**: mantener el evento (la empresa activa decide el rol con el que la persona opera en las secciones por
empresa: ventas, consultas y reportes; el registro es inalterable y borrarlo perdería trazabilidad de contexto) y sacarlo
de la lista: los tipos de evento que no son un cambio de negocio no ocupan la lista de Actividad ni el CSV, salvo que se
pidan explícitamente por tipo (el filtro **Tipo** ya existe y los tipos se derivan del historial, así que el tipo sigue
siendo alcanzable sin tocar la interfaz). La regla vive en un único lugar, `private.tipos_de_contexto_actividad()`, y la
aplican `public.listar_actividad` y `public.exportar_actividad`.

**Alternativas**:
- Dejar de registrar el evento (quitar el `registrar_actividad` de las dos RPC): pierde la trazabilidad de un cambio que
  modifica el rol efectivo y contradice FR-014 de F-ROL-06 (el contrato de otra historia).
- Dejarlo como está: el ruido que motivó el reporte sigue ahí.

**Archivos que probablemente cambian**:
- `supabase/migrations/20270507200300_actividad_eventos_de_contexto.sql` (nuevo)
- `supabase/tests/database/actividad_eventos_contexto.test.sql` (nuevo)
- `docs/actividad.md`, `docs/producto/actividad.md`, `docs/empresa-activa.md`, `docs/tecnico/permisos-por-empresa.md`

**Pruebas a agregar o actualizar**:
- pgTAP `actividad_eventos_contexto.test.sql`: el evento se sigue registrando; la lista no lo muestra; se ve si se pide
  por tipo; el CSV sale con las mismas filas que la pantalla.

## Riesgos y consideraciones

- **Migración**: redefina dos funciones con la MISMA firma (`create or replace`); no crea ni altera tablas, así que es
  aditiva y su reversión es volver a recrearlas sin la línea de contexto.
- **Coherencia de conteos**: el `total` de la lista y el total del CSV se calculan con el mismo filtro, así que si solo
  se filtrara el listado, el «N eventos» y el archivo no coincidirían con lo que se ve.
- **Privacidad/RLS**: no cambia quién ve qué (sigue rigiendo la RLS de `registro_actividad`); solo cambia qué filas
  aparecen en la vista por defecto.
- **Descubribilidad**: el tipo sigue en las opciones del filtro **Tipo**, así que las filas se pueden pedir; la
  documentación (manual de usuario) lo explica.

## Preguntas abiertas

- [NEEDS CLARIFICATION: ninguna. La decisión es la del producto y queda registrada en `docs/actividad.md`: se conserva el
  evento y se oculta de la lista.]
