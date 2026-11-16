# Feature Specification: Correr un recorrido desde el visor

**Feature Branch**: `feat/025-correr-desde-visor` · **Estado**: implementada

## Problema

Para ver el video de una historia había que ir a GitHub Actions, disparar el job
manual y esperar; el visor sólo mostraba lo que ya estaba publicado.

## Objetivo

Desde la ficha de una épica en `/cobertura-e2e`, lanzar el recorrido de esa
historia y ver el video nuevo cuando termina, sin salir del visor.

**Esto es herramienta del visor, no del producto**: el botón sólo existe si el
build define `VITE_E2E_RUNNER_URL`; el panel que usan los clientes no lo muestra
ni depende de ningún servicio nuevo.

## Requisitos

- **FR-001** Con `VITE_E2E_RUNNER_URL` definida, la ficha muestra «Correr este
  recorrido»; sin ella, no hay botón ni llamadas de red.
- **FR-002** El botón hace `POST {runner}/correr` con la clave de la épica; el
  runner dispara el workflow manual con `e2e_grep=<clave>`, modo visible y video.
- **FR-003** El visor consulta `GET {runner}/estado` cada 5 s; al quedar `listo`
  recarga la ficha, y si falla muestra el motivo.
- **FR-004** Una sola corrida a la vez (409 si ya hay una en curso).
- **FR-005** Al terminar, el runner publica manifiesto + videos con claves ASCII
  y actualiza `latest/cobertura-e2e.json` (mismo contrato que el CI).
- **FR-006** Sin red o con el runner apagado, el visor sigue funcionando.

## Fuera de alcance

- Exponer el runner en el producto o en Internet: corre en la máquina de
  desarrollo, en el tailnet, sin autenticación adicional.
- Elegir un test individual dentro de una épica (se corre la épica).

## Criterios de aceptación

1. En la ficha de `MSF-121`, «Correr este recorrido» dispara la corrida y, al
   terminar, la ficha muestra el video nuevo sin recargar a mano.
2. En un build sin `VITE_E2E_RUNNER_URL` no aparece el botón.
3. Dos clics seguidos no lanzan dos corridas.

## Matriz pantalla↔criterios

| Elemento visible | Criterio |
| --- | --- |
| Botón «Correr este recorrido» en la ficha | FR-001, FR-002 |
| Botón deshabilitado con «Corriendo…» | FR-003, FR-004 |
| Leyenda «Graba el video… (~10 minutos)» | FR-003 |
| Mensaje de error de la corrida | FR-003, FR-006 |
| Ausencia total del bloque en el build del producto | FR-001 |

## Alcance de entrega

`refine` (visor) y CI; sin cambios de esquema ni servicios nuevos en el producto.
