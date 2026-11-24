# Bug Assessment: el dashboard de Rentabilidad no se puede importar en Superset (YAML inválido)

- **Slug**: superset-yaml-descripcion-costos-fijos
- **Created**: 2026-11-23
- **Source**: re-importación de los dashboards en dev para dejarlos iguales al repo
- **Verdict**: valid
- **Severity**: medium

## Symptom

`superset import-dashboards` sobre `infra/superset/dashboards/rentabilidad` falla en la validación: `mapping values are not allowed here`.

## Root Cause

`datasets/Rentabilidad_analitica/margen_costos_fijos_empresa_mes.yaml` tiene `description: Por empresa y mes: ventas netas, …`
sin comillas: el segundo `:` rompe el YAML. Lo introdujo el commit a8f3d3a9a (F-GAS-03). Ningún chequeo parsea los YAML de dashboards.

## Fix

La descripción va entre comillas dobles. Los demás YAML de `infra/superset/dashboards` parsean.
