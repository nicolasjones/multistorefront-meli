---
owner: operacion
sources:
  - scripts/vencimientos-gates.mjs
---

# Gates del tracker: la fecha de vencimiento

El board del tracker (It's a Plan, proyecto `MSF`) guarda en cada ítem la **fecha de
vencimiento** (`dueDate`): es el plazo por el que algo tiene que pasar. El **contrato
de vitalidad** aplica lo mismo a las esperas del flujo: un gate humano (una decisión
que espera Nicolás) **vence a las 24 h** y, mientras tanto, el watchdog avisa con
cadencia.

El problema (MSF-909) era que ese plazo **no estaba escrito en el ítem**: los gates
tenían las etiquetas `gate`, `decision` o `escala-humano` y el campo `dueDate` vacío.
Sin fecha no hay planificación en el tablero ni forma de saber que una decisión está
vencida; el watchdog lo deducía de otra parte y el board no lo podía contrastar.

## La regla

`scripts/vencimientos-gates.mjs` le pone la fecha a los gates que **esperan decisión** y
no la tienen:

- **Qué es un gate:** el ítem lleva alguna de las etiquetas `gate`, `decision` o
  `escala-humano`.
- **Qué es «esperar decisión»:** el ítem no está archivado y no llegó a una columna
  terminal del flujo (`stateType: completed`: *Review In DEV*, *Approved In Dev*,
  *Review In STG*, *Approved In STG*, *Finalizada*). Un ítem que ya se entregó no
  espera nada.
- **Qué fecha se pone:** la **fecha en que vence el gate**, es decir las **24 h del
  contrato** contadas desde que el ítem empezó a esperar en su columna
  (`statusSince`), expresadas como fecha en `America/Argentina/Buenos_Aires`. El
  tracker guarda fecha y no hora, así que el plazo se redondea al día: un gate abierto hoy vence
  mañana.
- **Qué no se toca:** los ítems que ya tienen `dueDate` (la corrida es idempotente) y
  los que no son gates.

Para los gates que **ya vencieron**, la fecha queda en el pasado: eso es lo que hace
visible que la decisión está vencida, que es lo que el reporte pedía. No se usa «hoy + 1»
como fecha de compromiso: re-armaría el reloj y el tablero terminaría diciendo «vence
mañana» de ítems que el watchdog ya marca como vencidos (además no distinguiría un
ítem de un día de otro de cuarenta).

## Cómo se aplica

Necesita la clave personal del tracker en el entorno (`ITSAPLAN_API_KEY`; nunca en el
repo):

```sh
# 1. Simulación: lista los gates a los que les falta la fecha y NO escribe nada.
node scripts/vencimientos-gates.mjs

# 2. Aplicación: pone la fecha (un PATCH por ítem, sólo el campo dueDate).
node scripts/vencimientos-gates.mjs --aplicar
```

La simulación es el paso obligatorio: imprime el ítem, la columna, la fecha que le
corresponde y cuánto ítems del board se leyeron.

**Verificación.** Después de aplicar, la simulación tiene que dar **0** ítems (todos
tienen fecha) y el detalle de cada ítem tiene que mostrar la fecha:

```sh
node scripts/vencimientos-gates.mjs          # 0 gates sin fecha
curl -s -H "x-api-key: $ITSAPLAN_API_KEY" \
  https://api.plan.agenmatica.com/issues/<id> | jq '{identifier, dueDate}'
```

El board se lee por tipo de ítem y la API del tracker **no pagina** (ignora `offset` y
`page`): si un tipo llegara al tope de 500 ítems, el barrido corta con error en vez de
darse por completo. Ese error hay que tomarlo en serio: significa que el «0 gates»
todavía no se puede afirmar.

**Reversión.** La herramienta sólo **agrega** un dato que estaba vacío: para deshacer
basta con borrar la fecha de los ítems que tocó la corrida (`dueDate` acepta `null`):

```sh
curl -s -X PATCH -H "x-api-key: $ITSAPLAN_API_KEY" -H 'content-type: application/json' \
  -d '{"dueDate": null}' https://api.plan.agenmatica.com/issues/<id>
```

Los ids y las fechas que puso la corrida quedan en la salida de `--aplicar` (y en el
informe de la historia MSF-909).

## Lo que esta herramienta no arregla

El flujo que **abre** un gate vive en el orquestador (`ai-dev-orchestrator`), no en este
repo: sigue creando ítems sin `dueDate`. Esta herramienta es un **barrido
idempotente** y se puede volver a correr para completar los gates que aparezcan
después; que el gate nazca con la fecha puesta es un cambio del flujo del orquestador
(quedó trazado como **MSF-995** en el tracker: Tarea, etiqueta `seguimiento`, en
`Backlog`, bajo la épica MSF-515, con `dueDate` 2026-12-04).

La regla está fijada por tests (`pnpm test:vencimientos:gates`): qué es un gate, qué es
«esperar decisión», el cálculo de la fecha con su borde de medianoche, que la corrida
no toque lo que ya tiene fecha, que el `PATCH` mande **sólo** `dueDate` (mandar
`labelIds` en el mismo `PATCH` reemplazaría las etiquetas del ítem) y que el barrido
corte con error si el board no se puede leer entero.
