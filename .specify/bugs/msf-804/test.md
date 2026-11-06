# Test: msf-804

Verificación de los `ignores` de commitlint sobre mensajes de ejemplo (resultado abajo): el merge de épica pasa; un mensaje sin tipo sigue fallando.

Resultado (node, `require("./commitlint.config.cjs").ignores`): `Merge base de la épica en feat/story-MSF-423` → ignorado (true); `basura sin tipo` → no ignorado (false). commitlint no está instalado localmente; el job `quality` del PR lo corre completo.
