# Implementation Plan: Tiendas · Estilo del encabezado y mayúsculas por identidad (MSF-848)

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `refine` + `supabase`.

## Enfoque técnico

- **Base** (`supabase/migrations/20270308100000_tienda_estilo_heroe_mayusculas.sql`, idempotente y aditiva): columnas con check y default; `private.identidad_vivo`, `private.validar_tienda_identidad`, `private.detalle_cambios_tienda` y `public.publicar_tienda` recreadas con `create or replace`; `public.guardar_tienda_identidad` con dos parámetros nuevos al final (se elimina la firma de 11 argumentos; los grants se repiten); `publico.identidad_por_dominio` recreada con las dos claves y los mismos grants. Esquemas (Principio VII): tabla en `dominio`, lectura pública en `publico`, auxiliares en `private`.
- **Compatibilidad**: las claves ausentes (borradores y versiones anteriores) valen `oscuro` / `true` en el validador, en el detalle de cambios, en `publicar_tienda` y en `identidadDesdeFila`.
- **TS**: `lib/tiendaIdentidad.ts` (tipos, `IDENTIDAD_BASE`, `FilaIdentidad`, `identidadDesdeFila`, columnas, `guardarIdentidad`), `lib/tiendaBorrador.ts` (los valores de la identidad pueden ser booleanos).
- **Tema** (`tema/temaTienda.ts`): `ESTILOS_HEROE`, `ColoresTienda.heroe` (`estilo`, `fondo`, `texto`, `circulo`) y `titulosMayusculas`; `botonDestacado` se calcula contra la franja del héroe (en el estilo oscuro es la franja de la barra, igual que antes).
- **Panel**: `pestanas/identidad.tsx` (tarjeta «Portada y menú», vista previa) y `componentes/identidad/CamposDeIdentidad.tsx` (`SelectorEstiloHeroe`, `InterruptorMayusculas`).
- **Front público**: `secciones/BannerHome.tsx` (variante clara con círculo, mayúsculas del título y del botón) y `layout/MenuCategorias.tsx` (mayúsculas y `letter-spacing` de la barra).
- **Pruebas**: pgTAP `tienda_identidad_estilo_heroe.test.sql` (nuevo; se corrió a mano en dev dentro de `begin … rollback`) y los tests existentes con la firma nueva; Vitest (`tema`, `layout/estiloHeroeMayusculas.test.tsx`, `lib/tiendaIdentidad.test.ts`, `IdentidadTienda.test.tsx`, axe a 320/768/1440).
- **Documentación**: `docs/tiendas-online.md` y la spec de MSF-847 (decisiones resueltas).
- Reversión: ver el encabezado de la migración; revertir los commits del front.
