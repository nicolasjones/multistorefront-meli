# Implementation Plan: Ventas y despacho · Ventas backlog

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-208 · **Rama**: `epic/MSF-208-ventas-y-despacho-ventas-backlog`
**Alcance de entrega**: `—` (sin `refine`, `supabase`, `kestra`, `superset` ni `workers`).

## Resumen

Esta épica es un **backlog**: declara dos historias previstas — F-VTA-34 (Facturación electrónica ARCA, P3, XL) y F-VTA-35 (Pedidos desde la tienda online, P3, L) — que no tienen requisitos, pantallas, horas ni hito. No hay trabajo de implementación en esta entrega: cada historia se especificará (con su spec/plan/tasks, pantallas y flujos) en su propia rama cuando entre a un hito.

## Contexto técnico

No aplica. Sin frontend, sin base de datos, sin worker, sin Kestra ni Superset en esta entrega.

## Revisión de la Constitución

No aplica: no se crea ni altera tabla, pantalla, worker, flow ni tooling, por lo que no se disparan los principios I, III, VI, VII ni VIII. La verificación de esquema (Principio VII) y la de empresa activa (Principio VIII) se re-aplicarán en la spec de cada historia futura. El único artefacto de este cambio es la spec misma (Principio II y Documentación).

## Decisiones de diseño

Ninguna. No hay diseño ni arquitectura en esta entrega.

## Riesgos y reversión

Ninguno. Sin cambios de código que revertir; el PR de esta spec se revierte entero con `git revert -m 1` si hiciera falta.
