# Fix: MSF-626 — textos con códigos internos visibles al usuario

- `CorreoAvisosConsultas.tsx`: se quita «Desde MSF-562,» del aviso de Empresas → Editar.
- `lib/ventas.ts`: `AYUDA_CANAL_ML` pasa a «Mercado Libre no está disponible todavía como canal.» (formulario y detalle de comprobantes).
- Aserción de `comprobante.test.tsx` actualizada. Los comentarios de código con «Etapa 2» no son visibles y quedan igual.
- Fuera de alcance: `design/pantallas/VentasComprobante.dc.html` y `docs/` conservan el texto histórico.
