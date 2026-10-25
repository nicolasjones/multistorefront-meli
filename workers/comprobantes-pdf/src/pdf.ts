// Motor de PDF A4 (pdfkit): dibuja un `ModeloDocumento`. No conoce ningún documento en particular.
import PDFDocument from 'pdfkit';
import type { ModeloDocumento } from './tipos.js';

const MARGEN = 40;
const ALTO_FILA_MIN = 18;

export async function renderizarPdf(modelo: ModeloDocumento, logo?: Buffer): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true, info: { Title: modelo.titulo } });
  const partes: Buffer[] = [];
  doc.on('data', (parte: Buffer) => partes.push(parte));
  const terminado = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });

  const ancho = doc.page.width - MARGEN * 2;
  const limite = () => doc.page.height - MARGEN - 24;

  // Encabezado: logo opcional a la izquierda y datos de la empresa.
  let x = MARGEN;
  const arriba = MARGEN;
  if (logo) {
    try {
      doc.image(logo, MARGEN, arriba, { fit: [64, 64] });
      x = MARGEN + 76;
    } catch {
      // Un logo ilegible no impide imprimir: se omite.
    }
  }
  doc.font('Helvetica-Bold').fontSize(13).text(modelo.empresa[0] ?? '', x, arriba, { width: ancho - (x - MARGEN) });
  doc.font('Helvetica').fontSize(9);
  for (const linea of modelo.empresa.slice(1)) doc.text(linea, x, undefined, { width: ancho - (x - MARGEN) });
  doc.y = Math.max(doc.y, arriba + (logo ? 68 : 0)) + 10;

  doc.font('Helvetica-Oblique').fontSize(9).text(modelo.leyenda, MARGEN, doc.y, { width: ancho, align: 'right' });
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(16).text(modelo.titulo, MARGEN, doc.y, { width: ancho });
  doc.font('Helvetica').fontSize(10);
  for (const [etiqueta, valor] of modelo.datos) doc.text(`${etiqueta}: ${valor}`, MARGEN, undefined, { width: ancho });
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(10).text('Cliente', MARGEN, doc.y, { width: ancho });
  doc.font('Helvetica');
  for (const linea of modelo.cliente) doc.text(linea, MARGEN, undefined, { width: ancho });
  doc.moveDown(0.8);

  // Tabla con el encabezado repetido en cada página.
  const anchos = modelo.columnas.map((c) => c.ancho * ancho);
  const titulos = modelo.columnas.map((c) => c.titulo);
  const dibujarFila = (celdas: string[], encabezado: boolean): void => {
    const medir = (negrita: boolean): number => {
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      return Math.max(ALTO_FILA_MIN, ...celdas.map((t, i) => doc.heightOfString(t, { width: anchos[i] - 8 }) + 8));
    };
    let alto = medir(encabezado);
    if (doc.y + alto > limite()) {
      // La tabla sigue en la página nueva con su encabezado.
      doc.addPage();
      if (!encabezado) {
        dibujarFila(titulos, true);
        alto = medir(false);
      }
    }
    const y = doc.y;
    if (encabezado) doc.rect(MARGEN, y, ancho, alto).fill('#eeeeee');
    doc.fillColor('black').font(encabezado ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    let cx = MARGEN;
    celdas.forEach((t, i) => {
      doc.text(t, cx + 4, y + 4, { width: anchos[i] - 8, align: modelo.columnas[i].alinear });
      cx += anchos[i];
    });
    doc
      .moveTo(MARGEN, y + alto)
      .lineTo(MARGEN + ancho, y + alto)
      .strokeColor('#cccccc')
      .stroke();
    doc.fillColor('black');
    doc.y = y + alto;
  };
  dibujarFila(titulos, true);
  for (const fila of modelo.filas) dibujarFila(fila, false);

  if (modelo.totales.length > 0) {
    doc.moveDown(0.8);
    for (const [etiqueta, valor] of modelo.totales) {
      if (doc.y + ALTO_FILA_MIN > limite()) doc.addPage();
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(etiqueta, MARGEN, y, { width: ancho - 110, align: 'right' });
      doc.text(valor, MARGEN + ancho - 100, y, { width: 100, align: 'right' });
    }
  }
  if (modelo.notas.length > 0) {
    doc.moveDown(0.8).font('Helvetica').fontSize(9);
    for (const nota of modelo.notas) doc.text(nota, MARGEN, undefined, { width: ancho });
  }

  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#666666');
    doc.text(`Página ${i - start + 1} de ${count}`, MARGEN, doc.page.height - MARGEN - 8, {
      width: ancho,
      align: 'center',
      lineBreak: false,
    });
  }
  doc.end();
  return terminado;
}
