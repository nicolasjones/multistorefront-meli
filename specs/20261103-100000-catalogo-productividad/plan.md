# Implementation Plan: Catálogo · Catálogo productividad

**Spec**: `spec.md` · **Épica**: MSF-218 · **Rama**: `epic/MSF-218-catalogo-catalogo-productividad` · **Delivery scope**: `refine`, `supabase`

## Resumen

Sobre el listado de MSF-160 se agrega selección múltiple con una barra de acciones masivas (categoría, estado, empresas) y la acción «Duplicar» que abre el alta precargada. La base suma solo tres RPC que envuelven, en una transacción, las RPC individuales que ya existen; no hay tablas, columnas ni cambios de vistas. El duplicado no toca la base.

## Technical Context

- **Stack**: Refine + MUI (`apps/web`), Supabase self-hosted (migración de funciones `security invoker`, pgTAP), Vitest y Playwright. Sin dependencias nuevas.
- **Permisos**: `private.nivel_seccion('productos')` en pantalla (`useNivelSeccion`) y en las RPC; nunca `puede_escribir()`.
- **Reutiliza**: `asignar_categoria_producto`, `cambiar_estado_producto`, `definir_empresas_producto`, `crear_producto`; `SelectorEmpresas` (casillas), `SelectorCategoria`/árbol de categorías de MSF-160, `FormularioProducto`, `pages/productos/create.tsx`, `hooks/useFiltroPorEmpresaActiva`.
- **Actividad**: sin eventos nuevos; los triggers existentes los emiten por producto con cambio real.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Las RPC son `security invoker`: rige la RLS por organización y sección; ids ajenos son `P0002`. pgTAP con dos organizaciones. |
| II Spec antes | Esta spec; cada FR/SC con una sola tarea dueña. |
| III Idempotencia | Las RPC no cambian ni auditan lo que ya está en el estado pedido. |
| IV Despliegues | Solo `apps/web` y `supabase/`. |
| V Simplicidad | Sin librería nueva ni infraestructura; el duplicado sin migración. |
| VI Panel operable | Sin pantalla ni menú nuevos: la ruta `/productos/create` ya existe (suma el parámetro `duplicar_de`); kit de estados; teclado; 320/768/1440 px; sin ids técnicos visibles; sin peso fuera del recorrido (los diálogos se cargan de forma diferida). |
| VII Esquemas | Ninguna tabla nueva ni alterada. Las tres RPC van en `public` (contrato de la app); los datos viven en `dominio`. Se re-verifica en tareas, implementación y PR. |
| VIII Empresa activa | FR-007 + test que cambia de empresa (SC-002). |

## Diseño

- **Base**: migración `20261103100000_catalogo_edicion_masiva.sql`, aditiva (reversión en el encabezado: `drop function` de las tres). Cada RPC valida permiso y tamaño, bloquea las filas con `select … for update` en orden de id (evita interbloqueos) y llama a las RPC individuales; cualquier error revierte todo.
- **Selección**: hook `useSeleccionProductos` (ids de la página visible); se reinicia con la empresa activa, la página, el filtro y la búsqueda.
- **Barra y diálogos**: componentes en `components/productos/` (`BarraSeleccion`, `MoverCategoriaDialog`, `CambiarEstadoDialog`, `CambiarEmpresasDialog`) cargados con `lazy`; usan los patrones compartidos de diálogo, aviso y error.
- **Duplicar**: `pages/productos/create.tsx` lee `duplicar_de`, trae el origen con la consulta de la ficha y precarga `FormularioProducto`; el guardado es el del alta.
- **Contradicciones con el prototipo (anotar en el PR)**: se omite «hasta 3.er nivel» (el árbol es de 2 niveles); no se construyen destacado, newsletter ni borrado; «Cambiar estado» y «Cambiar empresas» no están dibujados.

## Pruebas

pgTAP de las RPC (aislamiento, roles, atomicidad, tope, idempotencia, Actividad); Vitest de barra, diálogos, solo lectura, cambio de empresa y duplicado; E2E de punta a punta; `rls_en_toda_tabla` verde.

## Riesgos

Que `producto_empresa` o `categorias` de MSF-160 lleguen con otra firma: se re-verifica contra `main` al empezar. El duplicado copia datos que Nicolás podría querer distintos (Decisión 4).
