# Implementation Plan: Paridad de pantallas con el prototipo

**Spec**: `specs/20261017-193000-paridad-pantallas/spec.md`

**Delivery scope**: `refine` (apps/web).

## Contexto técnico

- Stack: React + Refine + MUI (`apps/web`). Tokens en `apps/web/src/tema/tokens.ts`, tema en
  `apps/web/src/tema/temaPanel.ts` (de la spec anterior).
- Piezas de página: `apps/web/src/components/pagina/**` (EncabezadoPagina, ContenedorSeccion,
  ContenidoAdaptable, ContextoOrganizacionActiva).
- Componentes base: `apps/web/src/components/base/**` (EtiquetaEstado, MiniaturaProducto).
- Guardián: `scripts/verificar-estilos-sueltos.mjs` (prohíbe valores sueltos en `pages/**`).

## Enfoque

1. **Piezas compartidas primero** (mayor impacto, menor riesgo): encabezado y barra de
   herramientas; ajustes de tema para las píldoras.
2. **Ingreso** (`Login`) con el layout de dos paneles.
3. **Listados**, uno por uno, usando las piezas compartidas: Clientes, Productos, Empresas,
   Usuarios, Roles, Actividad.
4. **Cuenta/acceso**: perfil y pantallas de contraseña.
5. **Verificación**: tests de las piezas compartidas y de cada pantalla; `tsc`, `lint`,
   `estilos:check` y `docs:check`.

## Riesgos

- **No inventar datos**: el prototipo muestra columnas y controles sin dueño (stock, categorías,
  ranking, correo, importar, etiquetas, tiendas, cuenta web). Se omiten y se anotan en el PR.
- **Tests existentes**: se conservan las APIs (`EncabezadoPagina`, `ContenidoAdaptable`) para no
  romper los tests; los cambios son de presentación.
- **Guardián**: las pantallas no pueden llevar valores sueltos; todo sale de tokens/tema/piezas.

## Entregables

- Piezas compartidas actualizadas/nuevas en `components/pagina`.
- Ajustes de tema en `temaPanel.ts` (píldoras).
- Pantallas actualizadas.
- Tests.
- `docs/sistema-de-diseno.md` actualizado.
