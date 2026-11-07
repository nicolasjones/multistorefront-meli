# Evaluación: MSF-784

El detector de deploy a DEV del Release (repo `ai-dev-orchestrator`) usa `git merge-base --is-ancestor origin/<head> origin/<base>` en el camino «no hay PR abierto». Con la rama head borrada por GitHub al mergear (caso MSF-588, PR #623, merge commit `14ef1624`), la comprobación falla siempre → falso «no se pudo crear/encontrar el PR» y `Deploy Failed`.

Alcance: el detector NO vive en este repo (`multistorefront-meli`); `ai-dev-orchestrator` no está disponible en este circuito (mismo bloqueo que MSF-757). Verificado: ningún archivo de este repo contiene esa lógica ni el mensaje.

Regla: la fuente de verdad del deploy a DEV es el **merge commit presente en la rama base**, no la rama head ni un PR abierto.
