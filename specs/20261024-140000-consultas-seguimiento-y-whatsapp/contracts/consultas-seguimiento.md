# Contrato: interés por WhatsApp y respuesta desde el panel

Épica MSF-130 · spec `consultas-seguimiento-y-whatsapp`. Todo es **nuevo y aditivo**; no cambia la firma de nada existente (reusa `public.actualizar_consulta` de MSF-122 tal cual).

## Pública (la llama la tienda, MSF-212 · F-TDA-14)

```ts
publico.registrar_interes_whatsapp(host: text, producto_id: uuid): void
```

- Ejecutable por `anon` y `authenticated`. La empresa se resuelve **solo** por `host` (`dominio.tiendas`); no recibe `empresa_id`. **No recibe ni guarda datos personales.**
- Errores: `P0002` dominio desconocido o empresa desactivada (mensaje genérico, idéntico en ambos casos, resuelto antes de validar); `22023` producto inexistente o de otra organización (campo en `DETAIL`).
- Efecto: suma una fila en `dominio.intereses_whatsapp`. Sin anti-spam aquí (es de la tienda).

## Vista (panel, `authenticated`; consumidor previsto F-REP-04)

```ts
public.interes_whatsapp_por_producto  // security_invoker; columnas: organizacion_id, empresa_id, empresa_nombre, producto_id, producto_nombre, sku, total, ultimo_interes_at
```

Agrupada por empresa y producto; aplica la RLS de `dominio.intereses_whatsapp` (`consultas`≥`lectura` y empresa accesible). `anon` sin acceso.

## Reusada (MSF-122, sin cambios)

```ts
public.actualizar_consulta(p_id: uuid, p_estado: text, p_responsable_id: uuid | null, p_nota_interna: text | null, p_updated_at: timestamptz): timestamptz
```

F-CON-04 la llama con `p_estado = 'en_curso'` (si estaba `nueva`), `p_responsable_id` = usuario actual (si no había) y la nota y el `updated_at` vigentes. Errores: `40001` conflicto, `42501` sin permiso, `22023` responsable inválido.
