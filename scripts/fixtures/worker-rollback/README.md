# Fixture de rollback

`v1.json` y `v2.json` representan dos publicaciones inmutables. El escenario
esperado ejecuta v2, registra una regresión y vuelve a `v1` sin modificar otros
workers. `audit.jsonl` contiene únicamente campos operativos sanitizados.
