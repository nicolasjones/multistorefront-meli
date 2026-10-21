# Decisiones de arquitectura (ADR)

Una ADR explica **por qué** se eligió algo, qué alternativas había y qué consecuencias tiene. Vive en el repo y se linkea desde la spec/PR.

## Plantilla

```markdown
# ADR-000N · Título

- **Estado:** propuesta | aceptada | reemplazada por ADR-000M
- **Fecha:** YYYY-MM-DD
- **Contexto:** qué problema/decisión
- **Decisión:** qué se eligió
- **Alternativas:** qué se descartó y por qué
- **Consecuencias:** qué habilita, qué cuesta, qué deuda deja
- **Evidencia:** specs/PRs/commits
```

## ADRs de MSF

| ADR | Decisión | Estado |
|---|---|---|
| ADR-0001 | Documentación como código (Markdown + MkDocs + Archify) | aceptada |
| ADR-0002 | RLS por organización/empresa como frontera de seguridad | aceptada |
| ADR-0003 | Migraciones aditivas con reversión documentada | aceptada |
| ADR-0004 | Historial del panel anterior en tablas de archivo, sin FKs a tablas vivas | aceptada |

Las decisiones transversales se promueven a `platform-knowledge` del orquestador.
