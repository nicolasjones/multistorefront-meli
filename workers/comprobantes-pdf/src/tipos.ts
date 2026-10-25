// Datos que devuelve `private.datos_documento_comprobante` (jsonb). Lo no cargado viaja como null y la
// plantilla lo omite (FR-007).
export interface DatosDocumento {
  documento: { id: string; tipo: string; ruta: string };
  empresa: {
    nombre: string;
    razon_social: string | null;
    cuit: string | null;
    direccion: string | null;
    correo: string | null;
    whatsapp: string | null;
    logo_ruta: string | null;
  };
  cliente: { nombre: string; documento: string | null; direccion: string | null };
  comprobante: {
    tipo: string;
    numero: string;
    estado: string;
    fecha: string | null;
    valido_hasta: string | null;
    operador: string | null;
    forma_pago: string | null;
    envio: string | null;
    total_sin_iva: number | string;
    iva: number | string;
    total_con_iva: number | string;
  };
  lineas: Array<{
    orden: number;
    descripcion: string;
    codigo: string | null;
    cantidad: number | string;
    precio_unitario: number | string;
    subtotal_sin_iva: number | string;
    deposito: string | null;
  }>;
}

export interface Columna {
  titulo: string;
  /** Fracción del ancho útil de la tabla (la suma de las columnas es 1). */
  ancho: number;
  alinear: 'left' | 'right' | 'center';
}

/** Contenido de un documento, ya formateado: lo dibuja `pdf.ts` y lo prueba cada plantilla sin leer el PDF. */
export interface ModeloDocumento {
  titulo: string;
  leyenda: string;
  empresa: string[];
  datos: Array<[string, string]>;
  cliente: string[];
  columnas: Columna[];
  filas: string[][];
  totales: Array<[string, string]>;
  notas: string[];
}
