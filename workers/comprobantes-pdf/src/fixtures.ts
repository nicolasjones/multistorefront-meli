import type { DatosDocumento } from './tipos.js';

export function datosDePrueba(tipo: 'factura' | 'remito' | 'presupuesto' = 'factura', cambios: Partial<DatosDocumento> = {}): DatosDocumento {
  return {
    documento: {
      id: '33333333-3333-4333-8333-333333333333',
      tipo,
      ruta: 'o/e/c/33333333-3333-4333-8333-333333333333.pdf',
    },
    empresa: {
      nombre: 'San Javucho',
      razon_social: 'San Javucho SRL',
      cuit: '30712345678',
      direccion: 'Calle 1 123, Rosario',
      correo: 'ventas@sanjavucho.test',
      whatsapp: null,
      logo_ruta: null,
    },
    cliente: { nombre: 'Ana Pérez', documento: '20123456786', direccion: 'Mitre 45, Rosario, Santa Fe' },
    comprobante: {
      tipo: 'factura',
      numero: '00000001',
      estado: 'confirmada',
      fecha: '2026-10-25',
      valido_hasta: null,
      operador: 'Luis Gómez',
      forma_pago: 'Transferencia',
      envio: 'Retiro en tienda',
      total_sin_iva: 1000,
      iva: 210,
      total_con_iva: 1210,
    },
    lineas: [
      { orden: 1, descripcion: 'Funda de silicona', codigo: 'FS-01', cantidad: 2, precio_unitario: 400, subtotal_sin_iva: 800, deposito: 'Central' },
      { orden: 2, descripcion: 'Vidrio templado', codigo: null, cantidad: 1, precio_unitario: 200, subtotal_sin_iva: 200, deposito: 'Central' },
    ],
    ...cambios,
  };
}
