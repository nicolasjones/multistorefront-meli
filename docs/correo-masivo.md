# Correo masivo a clientes (MSF-155)

Spec: `specs/20261028-100000-correo-masivo-a-clientes/`. Esta guía crece con cada historia de la épica; hoy cubre
**F-CLI-11 · Destinatarios** (MSF-357). El envío, la baja y el historial los suman F-CLI-12 y F-CLI-13.

## Aceptación del cliente

- Columna `public.clientes.acepta_correo_masivo` (`boolean not null default false`). Los clientes existentes quedan
  **sin aceptación** hasta que se los marque (no hay consentimiento previo).
- Se cambia con el interruptor **«Incluir en el correo masivo»**:
  - en el formulario de alta y edición (`FormularioCliente`); en el **alta nace encendido**, como el prototipo;
  - en el bloque **«Comunicaciones»** de la ficha (`/clientes/show/:id`), que guarda al instante y queda de solo
    lectura para quien no edita Clientes.
- El alta rápida del taller (Service técnico) **no** pide el consentimiento: esos clientes nacen sin aceptación.
- La columna entra en los grants por columna de `authenticated` (insert/update); la RLS de `clientes` no cambia.

## Quién es destinatario

Un cliente es **elegible** si está activo (no archivado), tiene `acepta_correo_masivo` y un correo válido
(una sola dirección: se rechazan `,` y `;`). El Consumidor final del mostrador nunca es destinatario.

El resumen reparte a los clientes activos que cumplen los filtros en tres grupos que suman el total:

| Grupo | Criterio |
|---|---|
| `elegibles` | con correo válido y con aceptación |
| `sin_correo` | sin correo válido (acepte o no) |
| `no_aceptan` | con correo válido pero sin aceptación |

## Filtros (los mismos del listado de Clientes)

Búsqueda de texto (literal: `%` y `_` no son comodines), tipo (minorista / mayorista), empresa (`FiltroEmpresa`),
«con cuenta web» (cuenta activa y cliente habilitado en la tienda) y, opcionalmente, los clientes marcados en el
listado (`p_clientes`).

## Funciones de base (esquema `public`, `security invoker`)

Migración `20270120100000_clientes_acepta_correo_masivo.sql`. No se crea ninguna tabla.

| Función | Devuelve |
|---|---|
| `listar_destinatarios_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes, p_pagina, p_tamano)` | `{ total, filas: [{ id, numero, nombre, correo }] }` |
| `resumen_destinatarios_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes)` | `{ elegibles, sin_correo, no_aceptan }` |

Ambas **exigen edición en la sección `clientes`** (con lectura rechazan con `42501`; la UI oculta, la base manda),
respetan la RLS por organización y no son ejecutables por `anon`. El filtro común vive en
`private.clientes_para_correo_masivo`.

## Pantallas y rutas

- **Correo masivo → Nueva campaña**: `/clientes/correo-masivo`, entrada «Correo masivo» (ícono de sobre) del menú
  Contactos, para roles con edición en Clientes. Muestra filtros, destinatarios paginados, el conteo y cuántos
  quedan afuera y por qué.
- **Listado de Clientes**: la acción «Enviar correo a seleccionados (N)» lleva los marcados a la pantalla anterior;
  sin selección avisa «Elegí al menos un cliente con las casillas». El diálogo del prototipo lo entrega F-CLI-12.

## Empresa activa (Principio VIII)

La pantalla sigue la empresa de la barra superior: al cambiarla recarga lista y resumen, vuelve a la página 1,
descarta la selección que venía del listado y no muestra filas de la empresa anterior.

## Reversión

Migración posterior (nunca en el mismo PR): borrar las dos funciones públicas y `private.clientes_para_correo_masivo`,
y luego `alter table public.clientes drop column acepta_correo_masivo`. El detalle está en el encabezado de la migración.
