---
owner: tecnico
sources:
  - specs
---

# Modelo de datos

Diseño lógico del dominio. El esquema físico generado vive en
[../schema.html](../schema.html) y [../tecnico/datos.md](../tecnico/datos.md).

## Diagrama de entidades

```mermaid
erDiagram
  ORGANIZACION ||--o{ EMPRESA : tiene
  ORGANIZACION ||--o{ PRODUCTO : posee
  ORGANIZACION ||--o{ CLIENTE : comparte
  ORGANIZACION ||--o{ PROVEEDOR : comparte
  ORGANIZACION ||--o{ DEPOSITO : tiene
  EMPRESA ||--o{ USUARIO_EMPRESA : miembros
  ROL ||--o{ USUARIO_EMPRESA : asigna
  PRODUCTO ||--o{ EXISTENCIA_DEPOSITO : stock
  DEPOSITO ||--o{ EXISTENCIA_DEPOSITO : contiene
  PRODUCTO ||--o{ PRECIO_ESCALA : precios
  PRODUCTO }o--o{ EMPRESA : publicado_en
  EMPRESA ||--o{ COMPROBANTE : emite
  CLIENTE ||--o{ COMPROBANTE : recibe
  COMPROBANTE ||--|{ COMPROBANTE_LINEA : detalle
  PRODUCTO ||--o{ COMPROBANTE_LINEA : vendido
  COMPROBANTE_LINEA ||--o{ RESERVA_STOCK : reserva
  COMPROBANTE ||--o{ COBRO : cobranza
  COMPROBANTE ||--o{ DESPACHO : envio
  EMPRESA ||--o{ ORDEN_REPARACION : atiende
  CLIENTE ||--o{ ORDEN_REPARACION : trae
  PROVEEDOR ||--o{ PRODUCTO : abastece
```

## Entidades principales

| Entidad | Alcance | Notas |
|---|---|---|
| `organizaciones` | raíz | Frontera de aislamiento (RLS) |
| `empresas` (tiendas) | por organización | Una organización tiene N tiendas |
| `usuarios_empresas` | `(user_id, empresa_id, rol_id)` | Rol por tienda |
| `productos` | organización | Un catálogo; costo y proveedor por producto |
| `precios_escala` | producto | Escalas x1/x5/x10/x50 por tipo de cliente |
| `depositos`, `existencias_deposito` | organización | Cantidad por depósito |
| `reservas_stock` | línea de comprobante | Compromete stock sin descontarlo |
| `clientes`, `proveedores` | organización | Con "disponible en" tiendas |
| `comprobantes`, `comprobante_lineas` | tienda | Venta interna, sin fiscal |
| `cobros` | comprobante | Cobranzas parciales y deuda |
| `despachos` | comprobante | Armó / controló / entregó |
| `ordenes_reparacion` | **una** tienda | Service técnico |
| `rma`, `faltantes`, `transportes` | tienda / organización | Postventa y logística |

## Reglas de integridad

- Todo registro operativo lleva `organizacion_id`; los de tienda, además `empresa_id`.
- Clientes y proveedores pertenecen a la organización y se habilitan por tienda ("Disponible en").
- Una orden de reparación pertenece a una sola tienda.
- `existencias_deposito.cantidad >= 0` y `reservado <= cantidad` salvo producto "a pedido".
- Estados de producto: Stock, Sin stock, A pedido, Stock entrante.
- Los movimientos de stock son **append-only**: se corrige con otro movimiento, no editando.
- El historial del sistema anterior se consulta en solo lectura y no se mezcla con estas tablas.
