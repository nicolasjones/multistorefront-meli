// Formatos de presentación compartidos por las plantillas (es-AR).
const moneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const cantidad = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

export const LEYENDA_NO_VALIDO = 'Documento no válido como factura';

export function formatearMoneda(valor: number | string): string {
  return moneda.format(Number(valor));
}

export function formatearCantidad(valor: number | string): string {
  return cantidad.format(Number(valor));
}

/** `2026-10-25` o ISO con hora → `25/10/2026`; un valor no reconocible se devuelve tal cual. */
export function formatearFecha(valor: string | null): string | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor;
}

/** `20123456789` → `20-12345678-9`. */
export function formatearCuit(cuit: string | null): string | null {
  if (!cuit) return null;
  return /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}

/** Líneas del encabezado de empresa; lo no cargado se omite. */
export function lineasEmpresa(e: {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  direccion: string | null;
  correo: string | null;
  whatsapp: string | null;
}): string[] {
  const lineas = [e.razon_social || e.nombre];
  if (e.razon_social && e.razon_social !== e.nombre) lineas.push(e.nombre);
  const cuit = formatearCuit(e.cuit);
  if (cuit) lineas.push(`CUIT ${cuit}`);
  if (e.direccion) lineas.push(e.direccion);
  const contacto = [e.correo, e.whatsapp].filter(Boolean).join(' · ');
  if (contacto) lineas.push(contacto);
  return lineas;
}
