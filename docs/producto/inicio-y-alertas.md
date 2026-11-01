---
owner: producto
sources: []
---

# Inicio, alertas y búsqueda de productos

## Para qué sirve

Inicio es la primera pantalla que ves al entrar. En pocos segundos te muestra lo que tu rol puede resolver hoy: el estado de tus empresas, el stock, las consultas nuevas y el dólar, junto con una lista de alertas que te llevan directo a la pantalla donde se arreglan. Además, desde cualquier pantalla podés buscar un producto con el campo de búsqueda de la barra superior.

Cada persona ve solamente lo que su rol permite: si no tenés acceso a una sección (por ejemplo, Consultas), su tarjeta, sus alertas y sus resultados de búsqueda no aparecen.

> **TODO (dueño: Documentador, con datos de `pnpm demo:dataset`):** agregar las capturas de Inicio y de la búsqueda en `img/inicio-y-alertas/` con `pnpm docs:capturas`. Todavía no hay un guion de capturas para esta pantalla.

## La pantalla de Inicio

Se abre con el ítem **Inicio** del menú. Arriba ves un saludo con tu nombre («Buen día, …») y la fecha. Debajo aparecen, según tu rol:

| Qué ves | Qué muestra | Quién lo ve |
|---|---|---|
| **Accesos directos** | Botones **Nuevo comprobante**, **Registrar movimiento** y **Nuevo producto**. | Solo quien puede editar la sección correspondiente (Ventas, Stock, Productos). Con permiso de solo lectura no aparecen. |
| **Tus empresas** | Las empresas a las que tenés acceso, con la empresa activa marcada. Un enlace **Ver empresas** te lleva a la pantalla de empresas. | Todos. Si todavía no tenés empresas asignadas, lo dice. |
| **Stock hoy** | Cuántos productos están sin stock y cuántos bajo el mínimo. El enlace **Ver stock** abre Stock. | Quien puede ver Stock. |
| **Consultas nuevas** | Cuántas consultas nuevas hay sin atender en la empresa activa. El enlace **Abrir consultas** abre la bandeja. | Quien puede ver Consultas. |
| **Dólar** | La cotización vigente. Si hoy todavía no se cargó, avisa «Todavía no se cargó el dólar de hoy» y, si podés editar la cotización, ofrece **Cargar ahora**. | Quien puede ver la cotización del dólar. |
| **Qué hacer hoy** | La lista de alertas (ver más abajo). | Ver abajo. |

Cosas para tener en cuenta:

- **Cada tarjeta carga por su cuenta.** Si una falla, esa tarjeta muestra «No pudimos cargar este dato» y el resto sigue funcionando.
- Si tu rol todavía no tiene ninguna sección habilitada, Inicio te lo avisa: «Tu rol todavía no tiene secciones habilitadas».
- «Registrar movimiento» te lleva a Stock, donde está el botón **Nuevo movimiento**.
- Las tarjetas y alertas de Mercado Libre y de precios en revisión **todavía no existen**: se van a mostrar cuando esas funciones estén activas en tu organización.

### Empresa activa

El stock y el dólar son de toda la organización, así que no cambian al elegir otra empresa. Las consultas nuevas sí se acotan a la **empresa activa** de la barra superior. Cuando cambiás de empresa, Inicio vuelve a cargar todas sus tarjetas y alertas, y no queda ningún dato de la empresa anterior. Con **Todas mis empresas** ves lo de todas las empresas a las que accedés.

## Alertas: «Qué hacer hoy»

La tarjeta **Qué hacer hoy** ocupa todo el ancho de Inicio y lista lo que está pendiente. Cada alerta tiene un enlace que te lleva a la pantalla donde se resuelve.

| Alerta | Cuándo aparece | A dónde te lleva |
|---|---|---|
| Productos sin stock | Hay productos activos sin stock disponible. | Stock |
| Stock bajo | Hay productos activos por debajo del mínimo. | Stock |
| Consultas sin atender | Hay consultas nuevas que nadie tomó. | Consultas |
| Dólar sin cargar | Hoy todavía no se confirmó la cotización del dólar. | Cotización del dólar |
| Margen negativo | Hay productos que se venden con margen negativo. Aparece solo si Rentabilidad está disponible en tu sistema. | Rentabilidad |

- **Solo ves las alertas de secciones que tu rol puede ver.** Y, si trabajás con una empresa, las de esa empresa más las de toda la organización.
- Las alertas **no se actualizan al instante**: el sistema las recalcula cada 15 minutos. Si pasó más de una hora desde el último cálculo, te lo avisa: «Las alertas se calcularon por última vez a las HH:MM y pueden estar desactualizadas». Si nunca se calcularon, dice «Todavía no se calcularon las alertas».
- Cuando no hay nada pendiente ves **Sin alertas** y el mensaje «No hay nada pendiente por resolver».
- Si falla la carga, aparece «No pudimos cargar este dato» con el botón **Reintentar**.

## Búsqueda global de productos

El campo de búsqueda está en la barra superior y se ve en todas las pantallas del panel.

1. Hacé clic en el campo y escribí **al menos 2 letras** del nombre o del código (SKU) del producto. No importa si usás mayúsculas o tildes, y el nombre tolera errores leves de tipeo.
2. Esperá un instante: la lista de resultados aparece sola, con unos pocos productos (hasta 8).
3. Elegí un resultado con el mouse, o con las flechas y **Enter** desde el teclado. Se abre la pantalla de edición de ese producto. **Escape** cierra la lista.
4. Si no hay coincidencias, ves «No encontramos productos». Si falla la búsqueda, ves el aviso de error con **Reintentar** y lo que escribiste se mantiene.

Límites:

- Busca **solo productos**. Clientes y comprobantes no se buscan desde acá.
- Solo encontrás productos si tu rol puede ver la sección Productos; si no, la búsqueda no devuelve nada.
- Los productos son del catálogo de la organización, por eso la búsqueda **no depende de la empresa activa**.

## Todavía no se puede

- Ver tarjetas o alertas de Mercado Libre ni de precios en revisión.
- Gráficos de ventas en Inicio (se resuelven con los reportes).
- Buscar clientes o comprobantes desde la búsqueda global.
- Elegir qué alertas ves ni cambiar cada cuánto se recalculan.

Ver también: [Stock](stock-movimientos.md) · [Consultas](consultas.md) · [Cotización del dólar](precios-dolar.md) · [Rentabilidad](rentabilidad.md) · [Tu organización y tus empresas](organizacion-y-empresas.md).
