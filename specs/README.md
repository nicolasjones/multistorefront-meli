# Especificaciones del producto

Este directorio contiene una spec por funcionalidad, no una spec por
tecnología. Así se conserva el valor de negocio como unidad de trabajo aunque
la implementación toque varios productos.

Cada `spec.md` debe incluir al inicio un bloque de alcance de entrega:

```text
**Delivery scope**: refine | supabase | kestra | superset | workers
```

Para cada producto incluido, el `plan.md` debe mencionar el archivo que cambia,
la validación y su destino de despliegue:

| Producto | Desarrollo | Producción |
|---|---|---|
| refine | `infra/refine/compose.yaml` | Vercel |
| supabase | Supabase CLI | Supabase Cloud |
| kestra | `infra/kestra/compose.yaml` | VPS |
| superset | `infra/superset/compose.yaml` | VPS |
| workers | `workers/<nombre>/` | VPS |

No se implementa una funcionalidad hasta tener `spec.md`, `plan.md` y
`tasks.md` aprobados según el flujo de GitHub Spec Kit.
