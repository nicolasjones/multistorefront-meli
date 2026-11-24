# Bug Assessment: Las categorías no se pueden guardar en dev («No pudimos guardar la categoría»)

- **Slug**: categorias-constraint-niveles-no-guarda
- **Created**: 2026-11-23
- **Source**: reporte de Nicolás sobre `/categorias` en dev (editar una categoría, por ejemplo para marcar una empresa)
- **Verdict**: valid
- **Severity**: high

## Symptom

Crear, editar, reordenar o eliminar una categoría muestra «No pudimos guardar la categoría. Probá de nuevo.»

## Reproduction

Llamar `public.guardar_categoria(...)` como administrador en dev: `constraint "categorias_dos_niveles" does not exist`.

## Root Cause

`guardar_categoria`, `reordenar_categorias` y `eliminar_categoria` ejecutan
`set constraints dominio.categorias_dos_niveles immediate`. La base de dev tiene aplicada la migración de 3 niveles
(rama `feat/catalogo-real-cliente`, no mergeada), que reemplazó ese constraint por `categorias_tres_niveles`; las
funciones quedaron apuntando al nombre viejo. El front oculta el error real (código fuera de la lista conocida).

## Fix

Migración `20270507200200_categorias_validar_niveles_tolerante`: las tres funciones fuerzan la validación sobre el
constraint que exista (2 o 3 niveles). Mismas definiciones vigentes, sin otro cambio de comportamiento.
