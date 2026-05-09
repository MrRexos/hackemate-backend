import XLSX from 'xlsx';

function horaExcelAHhMm(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return XLSX.SSF.format('hh:mm', valor);
  if (typeof valor === 'string') return valor.trim() || null;
  return null;
}

function text(valor) {
  if (valor == null) return '';
  return String(valor).trim();
}

function numero(valor) {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : 0;
}

function creaPedidoDeFila(fila) {
  return {
    nom: text(fila.Nombre_Carga),
    tipus: text(fila.Tipo_Carga),
    // La unidad de volumen es "caja", por eso usamos Cantidad como cajas.
    quantitatCaixes: numero(fila.Cantidad),
    volumCaixes: numero(fila.Cantidad),
  };
}

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
export function convertirExcelAEntregas(excelPath) {
  const workbook = XLSX.readFile(excelPath, { cellDates: false });
  const primeraHoja = workbook.SheetNames[0];
  if (!primeraHoja) return [];

  const worksheet = workbook.Sheets[primeraHoja];
  const filas = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: true,
  });

  const entregasMap = new Map();

  for (const fila of filas) {
    const key = clauEntrega(fila);
    const pedido = creaPedidoDeFila(fila);

    if (!entregasMap.has(key)) {
      entregasMap.set(key, {
        identificador: text(fila.ID_Pedido) || null,
        nomEstabliment: text(fila.Nombre_Establecimiento),
        ubicacio: text(fila.Direccion),
        horaInici: horaExcelAHhMm(fila.Hora_Inicio),
        horaFinal: horaExcelAHhMm(fila.Hora_Fin),
        pedidos: [],
        volumTotalCaixes: 0,
      });
    }

    const entrega = entregasMap.get(key);
    entrega.pedidos.push(pedido);
    entrega.volumTotalCaixes += pedido.volumCaixes;
  }

  return Array.from(entregasMap.values());
}
