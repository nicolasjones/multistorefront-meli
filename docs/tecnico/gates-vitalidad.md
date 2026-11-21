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

## Cómo lee el board (y por qué lee dos veces)

La API del tracker **no pagina**: ignora `offset` y `page` y cada lectura corta en 500
ítems. Una lectura truncada es el peor fallo posible acá: el barrido declararía «0 gates
sin fecha» con gates sin fecha (un **falso verde**). Por eso el barrido lee el board de
**dos maneras independientes** y las contrasta:

| Lectura | Qué trae | Para qué |
|---------|----------|-----------|
| **Por etiqueta** (`?labelIds=…`, una por etiqueta de gate) | sólo los gates | es la fuente del barrido: chico y completo |
| **Por tipo** (`?typeId=…`, una por tipo de ítem) | todos los ítems del tipo | es el contraste: grande e independiente |

El contraste corta con error si las dos lecturas no ven los mismos gates: un gate que
falta en una de las dos delata la lectura truncada. Los **archivados no se leen**: la
regla ya los descarta y sólo consumirían el tope de la lectura.

Si el proyecto no tiene ninguna etiqueta de gate, el barrido también corta: sin ellas
no puede leer el board y un «0 gates» sería mentira.

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
corresponde y cuántos gates del board esperan decisión.

**Verificación.** Después de aplicar, la simulación tiene que dar **0** ítems (todos
tienen fecha) y el detalle de cada ítem tiene que mostrar la fecha:

```sh
node scripts/vencimientos-gates.mjs          # 0 gates sin fecha
curl -s -H "x-api-key: $ITSAPLAN_API_KEY" \
  https://api.plan.agenmatica.com/issues/<id> | jq '{identifier, dueDate}'
```

El «0» es sobre los gates que **esperan decisión**: los que ya se entregaron (columna
terminal) no esperan y no se fechan, así que no cuentan.

### Si el barrido corta con error

El corte es deliberado: es preferible no escribir nada a escribir un «0 gates» falso.
El error dice qué se truncó y **la corrida no escribió nada** (el corte ocurre en la
lectura, antes del primer `PATCH`), así que no hay nada que revertir. Para destrabarlo:

- **Un tipo llegó a 500 ítems** (o una etiqueta de gate): reducilo. La regla ya ignora
  los archivados, así que archivar los ítems viejos del tipo es la salida más directa;
  si el tipo es grande de verdad, dividí el proyecto. La API no pagina: no hay forma de
  leer más de 500 ítems por consulta.
- **Las dos lecturas no ven los mismos gates**: una de las dos volvió truncada. Volvé a
  correr la simulación: si el error sigue, el board tiene un tipo (o una etiqueta) en el
  tope de la lectura y hay que aplicar el punto anterior.

Mientras no se destrabe, los gates de los tipos que no se pudieron leer **quedan sin
fecha**: es preferible a fecharlos con una lectura incompleta.

### Reversión

La herramienta sólo **agrega** un dato que estaba vacío: para deshacer
basta con borrar la fecha de los ítems que tocó la corrida (`dueDate` acepta `null`):

```sh
curl -s -X PATCH -H "x-api-key: $ITSAPLAN_API_KEY" -H 'content-type: application/json' \
  -d '{"dueDate": null}' https://api.plan.agenmatica.com/issues/<id>
```

Los ids y las fechas que puso la corrida quedan en la salida de `--aplicar`: cada ítem
se anota **apenas se escribe** (no al final de la corrida), así que si un `PATCH` falla
a mitad, la salida dice exactamente qué ítems quedaron con fecha y la reversión se
puede aplicar sin tocar los que ya tenían fecha.

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
corte con error si el board no se puede leer entero (por tope de lectura o por
contraste entre las dos lecturas).
