---
name: eficiencia-contexto
description: Reduce consumo de contexto y tokens al investigar, planificar o revisar este repositorio sin perder evidencia. Úsala para tareas amplias, auditorías, depuración extensa o antes de cargar muchos artefactos.
---

# Eficiencia de contexto

Empieza por la mínima evidencia dirigida: estado Git, el archivo de instrucciones aplicable, `rg --files` y búsquedas acotadas. Lee solo los artefactos que la pregunta requiere; para una spec, primero identifica su carpeta y fase en `tasks.md` antes de abrir documentos relacionados.

Resume resultados intermedios en hechos verificables con ruta y línea cuando importe. No vuelvas a cargar documentos completos ya examinados salvo que cambiaron o falte una precisión concreta. Para repositorios o salidas grandes, usa filtros por ruta, patrón, rango o JSON y conserva solo la evidencia necesaria.

No reduzcas seguridad ni validación para ahorrar tokens: ejecuta las comprobaciones proporcionales al riesgo. Antes de ampliar alcance, declara qué falta comprobar y por qué. Al finalizar, diferencia hechos comprobados, inferencias y validaciones pendientes.
