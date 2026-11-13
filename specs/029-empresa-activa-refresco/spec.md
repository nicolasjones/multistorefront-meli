# Feature Specification: reencuadrar la pantalla al cambiar de empresa

**Feature Branch**: `fix/029-empresa-activa-refresco` · **Estado**: implementada

## Problema

Al elegir otra empresa activa en la barra superior sólo se recargaban los
permisos. Los listados (Clientes, Productos y los que vengan) seguían mostrando
las filas de la empresa anterior, conservaban paginación y selección, y un
pop-up abierto seguía operando sobre los datos viejos.

## Objetivo

Que cambiar de empresa **reencuadre la pantalla completa**: datos, paginación,
selección y diálogos, sin recargar el navegador (constitución, Principio VIII).

## Requisitos

- **FR-001** Al cambiar la empresa con éxito se invalidan **todas** las consultas
  de datos (no sólo `access`) y se avisa el cambio.
- **FR-002** El contenido ruteado se remonta con la nueva empresa: los hooks
  vuelven a pedir datos, la paginación y la selección arrancan de cero y los
  diálogos abiertos se cierran.
- **FR-003** El encabezado y el selector no se remontan; la etiqueta de empresa
  activa se actualiza y los permisos se recargan como hasta ahora.
- **FR-004** No hay recarga completa del navegador ni pérdida de la ruta.
- **FR-005** Si el cambio falla, no se remonta nada.

## Criterios de aceptación

1. En Clientes, cambiar de empresa vuelve a la página 1, limpia la selección y
   pide la lista de nuevo.
2. En Productos (u otra pantalla), el listado se vuelve a pedir.
3. Un diálogo abierto en la pantalla se cierra al cambiar de empresa.
4. El selector muestra la nueva empresa activa sin recargar la página.

## Matriz pantalla↔criterios

| Elemento visible | Criterio |
| --- | --- |
| Empresa activa: al elegir otra, la pantalla se remonta y recarga | FR-001, FR-002, FR-004 |
| Paginación y selección vuelven a cero | FR-002, CA-1 |
| Diálogo abierto se cierra | FR-002, CA-3 |
| Encabezado con la nueva empresa, sin remontarse | FR-003, CA-4 |
| Cambio fallido: todo queda como estaba | FR-005 |

## Alcance de entrega

`refine`; sin cambios de esquema.
