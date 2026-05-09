import XLSX from 'xlsx';
import { convertirExcelAProductes } from './excel-to-productes.converter.js';

// Converteix hora Excel (decimal) al format HH:mm.
function horaExcelAHhMm(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return XLSX.SSF.format('hh:mm', valor);
  if (typeof valor === 'string') return valor.trim() || null;
  return null;
}

// Normalitza qualsevol valor a text segur.
function text(valor) {
  if (valor == null) return '';
  return String(valor).trim();
}

// Clau estable per agrupar files en la mateixa entrega.
function clauEntrega(fila) {
  const id = text(fila.ID_Pedido);
  if (id) return id;
  return [
    text(fila.Nombre_Establecimiento),
    text(fila.Direccion),
    horaExcelAHhMm(fila.Hora_Inicio),
    horaExcelAHhMm(fila.Hora_Fin),
  ].join('|');
}

/**
 * Convierte un Excel de input en un vector de entregas, agrupando pedidos por entrega.
 * Cada pedido usa "Cantidad" como volumen en cajas.
 */
export function convertirExcelAEntregas(excelPath, options = {}) {
  const workbook = XLSX.readFile(excelPath, { cellDates: false });
  const primeraHoja = workbook.SheetNames[0];
  if (!primeraHoja) return [];

  const worksheet = workbook.Sheets[primeraHoja];
  const filas = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: true,
  });
  // Reutilitzem la capa de productes per mantenir una unica logica de parsing.
  const productes = convertirExcelAProductes(excelPath, options);
  const productesPerEntrega = new Map();

  for (const producte of productes) {
    // Agrupacio de productes per entrega per construir el vector final.
    const key = producte.identificadorEntrega || clauEntrega(producte.filaOriginal);
    if (!productesPerEntrega.has(key)) productesPerEntrega.set(key, []);
    productesPerEntrega.get(key).push({
      nom: producte.nom,
      tipus: producte.tipus,
      quantitatCaixes: producte.quantitatCaixes,
      volumCaixes: producte.volumCaixes,
    });
  }

  const entregasMap = new Map();

  for (const fila of filas) {
    const key = clauEntrega(fila);

    if (!entregasMap.has(key)) {
      const pedidos = productesPerEntrega.get(key) || [];
      entregasMap.set(key, {
        identificador: text(fila.ID_Pedido) || null,
        nomEstabliment: text(fila.Nombre_Establecimiento),
        ubicacio: text(fila.Direccion),
        horaInici: horaExcelAHhMm(fila.Hora_Inicio),
        horaFinal: horaExcelAHhMm(fila.Hora_Fin),
        pedidos,
        volumTotalCaixes: pedidos.reduce((total, p) => total + Number(p.volumCaixes || 0), 0),
      });
    }
  }

  return Array.from(entregasMap.values());
}
