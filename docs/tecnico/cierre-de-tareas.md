---
owner: tecnico
sources:
  - scripts/consolidar-marcas-tasks.mjs
  - scripts/verificar-tareas-cerradas.mjs
  - .github/workflows/validate.yml
---

# Cierre de tareas de las specs (MSF-914)

La regla del repo es «ninguna tarea `[ ]` de un `tasks.md` queda sin hacer». Desde
MSF-914 esa regla **se verifica**: el `tasks.md` es la fuente de verdad del cierre y
un gate del CI falla si no lo refleja.

## Por qué hacía falta

El orquestador deja las marcas de una historia en su propio archivo
(`specs/<slug>/tasks/<HISTORIA>.md`) y, por diseño, no edita el `tasks.md` (que es la
spec compartida entre historias). Nadie volcaba esas marcas al `tasks.md`, así que los
specs de épicas ya entregadas quedaron con **1125 tareas `[ ]` en 45 specs** (medido
sobre `dokploy`): el archivo que leen los consumidores —el manifiesto de cobertura E2E
y el reporte de cobertura de épicas— reportaba como no entregada historia ya revisada y
mergeada.

## Cómo funciona ahora

| Pieza | Qué hace |
|---|---|
| Side-car `specs/<slug>/tasks/<HISTORIA>.md` | Las marcas `[x]` de una historia, cuando el orquestador la da por terminada. Es la fuente de verdad. |
| `pnpm tareas:consolidar` | Vuelca al `tasks.md` **sólo** las marcas que ya existen en un side-car. No inventa marcas, nunca vuelve `[x]` a `[ ]`, deja intacto el texto de la línea y es idempotente. |
| `pnpm tareas:check` | Gate (corre en el job `chequeos` de `validate.yml` y como parte de `pnpm test`): falla si una historia cerrada dejó una tarea `[ ]` en el `tasks.md`. |

```bash
pnpm tareas:consolidar          # vuelca las marcas al tasks.md (idempotente)
pnpm tareas:consolidar -- --dry-run   # muestra qué cerraría, sin escribir
pnpm tareas:check               # verifica que no quedó ninguna tarea sin cerrar
```

Cada tarea consolidada queda con su procedencia: `Evidencia: marca de cierre en
\`tasks/F-TDA-11.md\``.

## Reglas del gate

Por cada tarea `[ ]` de un `tasks.md`:

1. Si un side-car la marcó `[x]` → **falla**: la proyección quedó desactualizada.
   Se resuelve con `pnpm tareas:consolidar`.
2. Si la historia que la posee (la etiqueta `[F-XXX-NN]`, `[CIERRE]` o `[MSF-NNN]`)
   tiene un side-car y esa historia no la marcó → **falla**: la historia se cerró y
   la tarea quedó atrás.
3. Si la línea (o su línea de continuación) tiene una nota `Desvío:` **fuera de un
   fragmento de código** → pasa: es deuda trazada, no una tarea olvidada.
4. En cualquier otro caso → pasa: la historia todavía no se cerró, la tarea está en
   curso.

## Cuando una tarea no se puede hacer

No se deja abierta: se cierra con `[x]` y una nota de desvío corta que cite el
seguimiento trazado (tarea `seguimiento` en el tracker):

```markdown
- [x] T030 [CIERRE] Documentación. Desvío: lo hace MSF-XXX (seguimiento MSF-XXX).
```

## Estado al cerrar MSF-914

Medido sobre `dokploy` con `grep -E '^\s*[-*]\s*\[ \]' specs/*/tasks.md`: **45 specs con
1125 tareas `[ ]`**. La consolidación dejó **10 specs con 87 tareas `[ ]`**, todas de
historias que todavía no se cerraron (no tienen side-car): `F-TDA-26`, `F-TDA-27`,
`F-VTA-33`, `F-CLI-20`, `F-CLI-21`, `F-PRV-09`, `F-PRE-14`, `F-GAS-01`–`F-GAS-03`,
`F-OPI-01`–`F-OPI-03`, las historias `US-*` de las specs nuevas y la fase `[CIERRE]` de
esas specs. No es deuda consolidable: son historias en curso, y cada una tiene su
excepción documentada en el `tasks.md` de su spec.

El gate no las marca: sólo falla cuando una historia **cerrada** dejó una tarea atrás.

## Referencias

- [Documentación obligatoria de cambios](../documentacion-cambios.md)
- [Control del CI](../control-ci.md)
- [Operación](operacion.md)
