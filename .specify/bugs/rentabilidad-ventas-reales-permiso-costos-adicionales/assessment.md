# Bug Assessment: Rentabilidad · Ventas reales falla al consultar datos en Superset

- **Slug**: rentabilidad-ventas-reales-permiso-costos-adicionales
- **Created**: 2026-11-23
- **Source**: reporte de Nicolás: Historia y Ventas reales «se ven pero siguen con fallas»
- **Verdict**: valid
- **Severity**: high

## Symptom

Los gráficos del tablero Ventas reales no cargan datos.

## Root Cause

Log de Superset: `psycopg2.errors.InsufficientPrivilege: permission denied for function costos_adicionales_de`.
La función se creó (20270202201002) sin `grant execute` para `superset_analitica`; las vistas que la usan fallan con esa conexión.

## Fix

Migración `20270507210600_analitica_grant_costos_adicionales_superset`: `grant execute ... to superset_analitica`.
