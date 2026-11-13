---
owner: producto
sources:
  - specs
---

# Sistema de diseño (MSF-117)

Épica **MSF-117** · Plataforma · Sistema de diseño. Spec: `specs/20261012-130000-sistema-de-diseno/spec.md`.
Detalle técnico: [catálogo y tema](../sistema-de-diseno.md).

## Qué resuelve y para quién

El panel y las tiendas públicas se ven con una sola identidad, sin que cada pantalla invente sus colores,
tipografías o tamaños. Se adaptó el tema y el kit de panel del template (no se armó un sistema desde cero):

- **Equipo que construye pantallas:** usa los componentes base y el tema; no escribe colores ni radios sueltos.
- **Personas que usan el panel:** ven la misma estética en todo el panel (Sora para títulos, Instrument Sans para
  texto, azul de acción `#2B55E6`, botones de 38 px con esquinas de 9 px).
- **Tiendas públicas:** cada empresa puede tener su propio tema (por ejemplo Mundo JC con Barlow Condensed y Barlow)
  sin alterar el del panel.

## Historias

| Historia | Jira | Estado |
|---|---|---|
| DS-01 Tokens y tema del panel | MSF-420 | Hecha (`tasks.md` T001–T005, T022) |
| DS-02 Componentes base y estados | MSF-426 | Hecha (T006–T012, T023) |
| DS-03 Estructura del panel: encabezado, menú y selector de empresa | MSF-431 | Hecha (T013–T017) |
| DS-04 Temas de las tiendas públicas por empresa | MSF-435 | Mecanismo hecho (T018–T021); no está montado en pantallas |

## Límites (fuera de alcance)

- La configuración de la identidad por empresa («Empresa · Identidad visual») y su lectura desde la base la cubre
  MSF-147 ([Tienda: dominio e identidad](tienda-dominio-e-identidad.md)). Los colores de ejemplo de San Javucho y
  Mundo JC no están confirmados con el cliente.
- Modo oscuro, búsqueda global (⌘K) y branding por organización: no incluidos.
- El selector de empresa del encabezado sólo cambia de empresa dentro de `/empresas/edit/:id`; fuera de ahí muestra
  la etiqueta de la organización.
- Cómo se comparten los tokens si el front público fuera otro repo: sin definir. TODO (dueño: producto).

## Cómo probarlo

### Prerrequisitos

- Entorno local (`pnpm dev:supabase` + `pnpm dev:refine:host`) o DEV, con un usuario del panel que pueda ver
  Empresas, de una organización con al menos dos empresas.
- Para la parte de tienda no hay pantalla: se prueba con tests (ver pasos 6–7).

### Pasos

1. Entrá al panel e iniciá sesión. Se ve el panel con tipografía Sora en los títulos, Instrument Sans en el texto y fondo gris cálido.
2. Abrí cualquier listado (Clientes, Productos). El botón primario es azul `#2B55E6`, de 38 px y esquinas redondeadas; al pasar el mouse se oscurece a `#1E3FB8`.
3. En un formulario, enfocá un campo y dejalo con error. Se ve el borde azul en foco y el mensaje de error en rojo `#C62828`.
4. Mirá el encabezado y la barra lateral: se ven con el estilo del sistema; los destinos y permisos son los mismos de antes.
5. Entrá a Empresas → editar una empresa. El selector de empresa del encabezado lista las empresas de la organización, marca la actual y, al elegir otra, navega a la misma sección con esa empresa.
6. Corré `pnpm --filter @platform/web test -- tema` y verificá que pasan los tests de tokens, tema del panel y componentes.
7. Corré `pnpm --filter @platform/web test -- temaTienda`: dos identidades (Mundo JC, San Javucho) renderizan independientes, sin identidad cae al tema neutro y el tema del panel no cambia.
8. Corré `pnpm estilos:check`: debe pasar; falla si una pantalla usa colores o tamaños literales.

### Resultado esperado

- **Given** una persona con acceso al panel, **When** navega por sus pantallas, **Then** ve la identidad única (tipografías, azul de acción, botones 38/9 px) sin diferencias entre pantallas.
- **Given** una organización con varias empresas, **When** elige otra en el selector de la edición de empresa, **Then** la pantalla pasa a esa empresa.
- **Given** dos identidades de tienda, **When** se renderizan, **Then** cada una usa sus tipografías y colores y el panel no cambia.

### Cómo automatizarlo

Los pasos 6–8 ya están cubiertos por Vitest (`apps/web/src/tema/*.test.ts(x)`) y el guardián `estilos:check`. No existe
un E2E de Playwright con rótulo `[MSF-117:T0yy]` para los pasos 1–5: queda pendiente de automatizar (dueño: QA).
