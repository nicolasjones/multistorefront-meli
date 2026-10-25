import { describe, expect, it, vi } from 'vitest';
import { datosDePrueba } from './fixtures.js';
import { generarDocumento, ejecutarDesdeEntorno, type Puertos } from './generar.js';
import { renderizarPdf } from './pdf.js';
import { armarFactura } from './plantillas/factura.js';
import type { DatosDocumento } from './tipos.js';

const DOC = '33333333-3333-4333-8333-333333333333';
const EJE = '44444444-4444-4444-8444-444444444444';

function puertos(cambios: Partial<Puertos> = {}): Puertos {
  return {
    enCurso: vi.fn(async () => true),
    datos: vi.fn(async () => datosDePrueba('factura')),
    logo: vi.fn(async () => null),
    subir: vi.fn(async () => undefined),
    cerrar: vi.fn(async () => undefined),
    evento: vi.fn(),
    ...cambios,
  };
}

describe('renderizarPdf', () => {
  it('genera un PDF A4 válido', async () => {
    const pdf = await renderizarPdf(armarFactura(datosDePrueba('factura')));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // A4 = 595.28 x 841.89 pt
    expect(pdf.toString('latin1')).toMatch(/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  it('pagina cuando hay muchas líneas y repite el encabezado de la tabla', async () => {
    const base: DatosDocumento = datosDePrueba('factura');
    const lineas = Array.from({ length: 120 }, (_, i) => ({ ...base.lineas[0], orden: i + 1, descripcion: `Producto ${i + 1}` }));
    const pdf = await renderizarPdf(armarFactura({ ...base, lineas }));
    const paginas = pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(paginas.length).toBeGreaterThan(1);
  });
});

describe('generarDocumento (FR-004)', () => {
  it('sube el PDF en la ruta del documento y lo cierra como generado', async () => {
    const p = puertos();
    const salida = await generarDocumento(DOC, EJE, p);
    expect(salida).toEqual({ codigo: 0 });
    expect(p.subir).toHaveBeenCalledWith('o/e/c/33333333-3333-4333-8333-333333333333.pdf', expect.any(Buffer));
    expect(p.cerrar).toHaveBeenCalledWith(DOC, 'o/e/c/33333333-3333-4333-8333-333333333333.pdf', null);
  });

  it('usa la plantilla del remito para un remito', async () => {
    const p = puertos({ datos: vi.fn(async () => datosDePrueba('remito')) });
    expect((await generarDocumento(DOC, EJE, p)).codigo).toBe(0);
    expect(p.cerrar).toHaveBeenCalledTimes(1);
  });

  it('con la ejecución cerrada sale con 78 EJECUCION_NO_EN_CURSO y no toca nada', async () => {
    const p = puertos({ enCurso: vi.fn(async () => false) });
    expect(await generarDocumento(DOC, EJE, p)).toEqual({ codigo: 78, stderr: `EJECUCION_NO_EN_CURSO:${EJE}` });
    expect(p.datos).not.toHaveBeenCalled();
    expect(p.cerrar).not.toHaveBeenCalled();
  });

  it('un documento ya cerrado es éxito idempotente', async () => {
    const p = puertos({ datos: vi.fn(async () => { throw new Error('DOCUMENTO_NO_PENDIENTE: ya cerrado'); }) });
    expect(await generarDocumento(DOC, EJE, p)).toEqual({ codigo: 0 });
    expect(p.subir).not.toHaveBeenCalled();
  });

  it('un tipo sin plantilla cierra el documento como fallido y sale con 78', async () => {
    const p = puertos({ datos: vi.fn(async () => datosDePrueba('factura', { documento: { id: DOC, tipo: 'otro', ruta: 'x' } })) });
    expect(await generarDocumento(DOC, EJE, p)).toEqual({ codigo: 78, stderr: `CONFIGURACION_INVALIDA:${DOC}` });
    expect(p.cerrar).toHaveBeenCalledWith(DOC, null, 'No se pudo generar el documento');
  });

  it('una falla al armar el PDF cierra fallido con un motivo sanitizado y sale con 78', async () => {
    const p = puertos({ logo: vi.fn(async () => Buffer.from('no es imagen')) });
    // Datos corruptos: la plantilla revienta al leer las líneas.
    p.datos = vi.fn(async () => ({ ...datosDePrueba('factura'), lineas: undefined as never }));
    const salida = await generarDocumento(DOC, EJE, p);
    expect(salida).toEqual({ codigo: 78, stderr: `GENERACION_FALLIDA:${DOC}` });
    expect(p.cerrar).toHaveBeenCalledWith(DOC, null, 'No se pudo generar el documento');
    expect(p.subir).not.toHaveBeenCalled();
  });

  it('un logo ilegible no impide generar el documento', async () => {
    const p = puertos({ datos: vi.fn(async () => datosDePrueba('factura', { empresa: { ...datosDePrueba().empresa, logo_ruta: 'o/logo.png' } })), logo: vi.fn(async () => Buffer.from('basura')) });
    expect((await generarDocumento(DOC, EJE, p)).codigo).toBe(0);
  });

  it('una falla técnica de Storage se propaga (el flow reintenta) y no cierra el documento', async () => {
    const p = puertos({ subir: vi.fn(async () => { throw new Error('SUBIDA_FALLIDA:503'); }) });
    await expect(generarDocumento(DOC, EJE, p)).rejects.toThrow('SUBIDA_FALLIDA');
    expect(p.cerrar).not.toHaveBeenCalled();
  });

  it('una entrada inválida sale con 78 CONFIGURACION_INVALIDA', async () => {
    const crear = vi.fn();
    const salida = await ejecutarDesdeEntorno({ DOCUMENTO_ID: 'no-uuid', EJECUCION_ID: EJE, CONEXION_ID: 'c1' }, crear);
    expect(salida).toEqual({ codigo: 78, stderr: 'CONFIGURACION_INVALIDA:c1' });
    expect(crear).not.toHaveBeenCalled();
  });
});
