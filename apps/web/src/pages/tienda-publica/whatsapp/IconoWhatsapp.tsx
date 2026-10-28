// Glifo de WhatsApp (marca): el mismo dibujo que usa el prototipo validado de la ficha
// (`design/pantallas/MJC_Producto/MJC_Producto.dc.html`). Es decorativo —el botón y el diálogo nombran la
// acción con texto—, así que va con `aria-hidden` y toma el color del texto que lo contiene.
export function IconoWhatsapp({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2m5.8 14.19c-.24.68-1.42 1.3-1.96 1.35-.5.05-1.13.07-1.82-.11-.42-.13-.96-.31-1.65-.61-2.91-1.26-4.81-4.19-4.96-4.38-.14-.19-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.26-.29.57-.36.76-.36l.55.01c.18 0 .42-.07.65.5.24.57.82 1.99.89 2.13.07.14.12.31.02.5-.09.19-.14.31-.28.47l-.42.49c-.14.14-.29.3-.12.59.16.29.73 1.2 1.57 1.95 1.08.96 1.99 1.26 2.28 1.4.29.14.46.12.63-.07.17-.19.73-.85.92-1.14.19-.29.38-.24.65-.14.26.1 1.68.79 1.97.93.29.14.48.21.55.33.07.12.07.69-.17 1.37" />
    </svg>
  )
}
