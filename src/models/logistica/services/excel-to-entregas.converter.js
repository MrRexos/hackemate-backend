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

/** Primer camp no buit entre els noms possibles (capçaleres Excel). */
function obtenirCamp(fila, ...noms) {
  for (const nom of noms) {
    if (nom in fila && fila[nom] != null && fila[nom] !== '') return fila[nom];
  }
  return null;
}

function normalitzaAdreca(valor) {
  return text(valor).toLowerCase().replace(/\s+/g, ' ').trim();
}

function creaPedidoDeFila(fila) {
  const q = numero(obtenirCamp(fila, 'Cantidad', 'Quantitat', 'Qty'));
  const volumUnitari = numero(obtenirCamp(fila, 'Volumen_Caja', 'Volumen_Unidad', 'Volum', 'Volum_Unitat')) || 1;

  return {
    nom: text(obtenirCamp(fila, 'Nombre_Carga', 'Nombre', 'Nom_Carrega')),
    tipus: text(obtenirCamp(fila, 'Tipo_Carga', 'Tipo', 'Tipus')),
    volum: volumUnitari,
    quantitat: q,
  };
}

/**
 * Llegeix un Excel de catàleg de franges horàries (primera fulla).
 * Columnes esperades (qualsevol d'aquestes variants per cada concepte):
 * - Codi: Codigo_Franja, Codigo, ID_Franja, ID
 * - Inici: Hora_Inicio, Inicio, HoraDesde
 * - Fi: Hora_Fin, Fin, HoraHasta
 *
 * @returns {Map<string, { horaInici: string|null, horaFinal: string|null }>}
 */
export function llegeixMapaFrangesExcel(excelPath) {
  const workbook = XLSX.readFile(excelPath, { cellDates: false });
  const primeraHoja = workbook.SheetNames[0];
  if (!primeraHoja) return new Map();

  const worksheet = workbook.Sheets[primeraHoja];
  const filas = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: true,
  });

  const mapa = new Map();

  for (const fila of filas) {
    const codi = text(obtenirCamp(fila, 'Codigo_Franja', 'Codigo', 'ID_Franja', 'ID', 'Codi_Franja'));
    if (!codi) continue;

    const horaInici = horaExcelAHhMm(obtenirCamp(fila, 'Hora_Inicio', 'Inicio', 'HoraDesde', 'Hora_Inici'));
    const horaFinal = horaExcelAHhMm(obtenirCamp(fila, 'Hora_Fin', 'Fin', 'HoraHasta', 'Hora_Fi'));

    mapa.set(codi, { horaInici, horaFinal });
  }

  return mapa;
}

/**
 * Resol horaInici / horaFinal: referència a catàleg (Codigo_Franja…) o columnes de la fila.
 */
function resolFranjaFila(fila, mapaFranges) {
  const codiFranja = text(
    obtenirCamp(fila, 'Codigo_Franja', 'ID_Franja', 'Ref_Franja', 'Codi_Franja', 'Franja'),
  );

  if (codiFranja) {
    if (!mapaFranges || !mapaFranges.has(codiFranja)) {
      throw new Error(
        `Fila amb Codigo_Franja="${codiFranja}" però aquest codi no existeix al catàleg de franges.`,
      );
    }
    return { ...mapaFranges.get(codiFranja), codiFranja };
  }

  return {
    horaInici: horaExcelAHhMm(obtenirCamp(fila, 'Hora_Inicio', 'Hora_Inici', 'Inicio')),
    horaFinal: horaExcelAHhMm(obtenirCamp(fila, 'Hora_Fin', 'Hora_Fi', 'Fin')),
    codiFranja: '',
  };
}

/**
 * Clau d'agrupació: mateixa adreça normalitzada + mateixa finestra horària (ja resolta).
 */
function clauPerUbicacioIFranjaDesDe(fila, franja) {
  const direccion = normalitzaAdreca(obtenirCamp(fila, 'Direccion', 'Dirección', 'Adreca', 'Adreça'));
  return `${direccion}|${franja.horaInici ?? ''}|${franja.horaFinal ?? ''}`;
}

/** Comportament anterior: una entrega per ID_Pedido si ve informat; si no, ubicació + franja. */
function clauLegacyDesDe(fila, franja) {
  const id = text(obtenirCamp(fila, 'ID_Pedido', 'ID', 'Id_Pedido'));
  if (id) return id;
  return clauPerUbicacioIFranjaDesDe(fila, franja);
}

/**
 * Converteix un Excel de comandes en entregues agrupades.
 *
 * @param {string} excelPath - Ruta al Excel de línies de càrrega / pedidos.
 * @param {object} [options]
 * @param {string} [options.frangesExcelPath] - Excel apart amb catàleg de franges (codi → hores).
 * @param {'ubicacio_i_hora'|'id_o_ubicacio'} [options.agrupacio='ubicacio_i_hora']
 *        - ubicacio_i_hora: agrupa totes les línies amb mateixa adreça i mateixa franja.
 *        - id_o_ubicacio: si hi ha ID_Pedido, una entrega per id; si no, ubicació + franja.
 * @returns {Array<object>} Llista d'objectes entrega (plain) amb pedidos[], adreça, hores, etc.
 */
export function convertirExcelAEntregas(excelPath, options = {}) {
  const mapaFranges = options.frangesExcelPath ? llegeixMapaFrangesExcel(options.frangesExcelPath) : null;
  const agrupacio = options.agrupacio === 'id_o_ubicacio' ? 'id_o_ubicacio' : 'ubicacio_i_hora';

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
    const franja = resolFranjaFila(fila, mapaFranges);
    const { horaInici, horaFinal } = franja;

    const clau =
      agrupacio === 'id_o_ubicacio' ? clauLegacyDesDe(fila, franja) : clauPerUbicacioIFranjaDesDe(fila, franja);

    const pedido = creaPedidoDeFila(fila);
    const idFila = text(obtenirCamp(fila, 'ID_Pedido', 'ID', 'Id_Pedido'));
    const adrecaFila = text(obtenirCamp(fila, 'Direccion', 'Dirección', 'Adreca', 'Adreça'));

    if (!entregasMap.has(clau)) {
      entregasMap.set(clau, {
        identificador: idFila || null,
        idsPedidos: idFila ? [idFila] : [],
        nomEstabliment: text(obtenirCamp(fila, 'Nombre_Establecimiento', 'Establecimiento', 'Nom_Establiment')),
        adreca: adrecaFila,
        horaInici,
        horaFinal,
        pedidos: [],
        volumTotalCaixes: 0,
      });
    }

    const entrega = entregasMap.get(clau);

    if (agrupacio === 'id_o_ubicacio' && idFila) {
      if (normalitzaAdreca(entrega.adreca) !== normalitzaAdreca(adrecaFila)) {
        throw new Error(
          `ID_Pedido "${idFila}" repetit amb adreces diferents ("${entrega.adreca}" vs "${adrecaFila}").`,
        );
      }
      if (entrega.horaInici !== horaInici || entrega.horaFinal !== horaFinal) {
        throw new Error(`ID_Pedido "${idFila}" repetit amb franges horàries diferents.`);
      }
    }
    if (idFila && !entrega.idsPedidos.includes(idFila)) {
      entrega.idsPedidos.push(idFila);
    }
    if (!entrega.identificador && idFila) {
      entrega.identificador = idFila;
    }

    entrega.pedidos.push(pedido);
    entrega.volumTotalCaixes += pedido.quantitat * pedido.volum;
  }

  for (const entrega of entregasMap.values()) {
    if (entrega.idsPedidos.length > 1) {
      entrega.identificador = entrega.idsPedidos.join(', ');
    } else if (entrega.idsPedidos.length === 1) {
      entrega.identificador = entrega.idsPedidos[0];
    }
    delete entrega.idsPedidos;
  }

  return Array.from(entregasMap.values());
}
