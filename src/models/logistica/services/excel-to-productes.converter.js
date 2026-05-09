import XLSX from 'xlsx';

// Normalitza qualsevol valor a text segur per mapatges i claus.
function text(valor) {
  if (valor == null) return '';
  return String(valor).trim();
}

// Converteix valors numerics d'entrada, evitant NaN.
function numero(valor) {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Converteix l'Excel a vector de productes/pedidos.
 * Permet injectar una funcio futura per obtenir caixes per unitat.
 */
export function convertirExcelAProductes(excelPath, options = {}) {
  const { obtenirCaixesPerUnitat } = options;
  const workbook = XLSX.readFile(excelPath, { cellDates: false });
  const primeraHoja = workbook.SheetNames[0];
  if (!primeraHoja) return [];

  const worksheet = workbook.Sheets[primeraHoja];
  const files = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: true });

  return files.map((fila) => {
    // Quantitat d'unitats reportada a l'Excel d'input.
    const quantitat = numero(fila.Cantidad);
    // Punt d'extensio per calcular volum real segons nom/tipus.
    const caixesPerUnitat = Number(
      obtenirCaixesPerUnitat?.({
        nom: text(fila.Nombre_Carga),
        tipus: text(fila.Tipo_Carga),
        quantitat,
        filaOriginal: fila,
      }) ?? 1,
    );

    return {
      // Referencia de quina entrega pertany aquest producte.
      identificadorEntrega: text(fila.ID_Pedido) || null,
      nom: text(fila.Nombre_Carga),
      tipus: text(fila.Tipo_Carga),
      quantitat,
      quantitatCaixes: quantitat,
      caixesPerUnitat: Number.isFinite(caixesPerUnitat) ? caixesPerUnitat : 1,
      volumCaixes: quantitat * (Number.isFinite(caixesPerUnitat) ? caixesPerUnitat : 1),
      filaOriginal: fila,
    };
  });
}
