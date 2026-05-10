import XLSX from 'xlsx';

import { Entrega } from '../classes/entrega.model.js';
import { Pedido } from '../classes/pedido.model.js';
import { geocodificarAdrecaNominatim } from './geocodificar-adreca.service.js';

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

/** Volum per unitat segons tipus de càrrega; si no hi ha mapa, retorna 1. */
function volumUnitariDesDeTipus(tipusCarrega, volumPerTipus) {
  const map = volumPerTipus && typeof volumPerTipus === 'object' ? volumPerTipus : null;
  const def = map && Number(map.default) > 0 ? Number(map.default) : 1;
  const key = String(tipusCarrega || '').trim();
  if (!key) return def;
  if (map && map[key] != null) {
    const v = Number(map[key]);
    return Number.isFinite(v) && v > 0 ? v : def;
  }
  if (map) {
    const found = Object.keys(map).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found != null) {
      const v = Number(map[found]);
      return Number.isFinite(v) && v > 0 ? v : def;
    }
  }
  return def;
}

/** Primera fila és capçalera (columnes ID entrega / direcció…). */
function esCapcaleraFilaPedidosPerEntrega(row) {
  if (!Array.isArray(row) || row.length === 0) return false;
  const c0 = text(row[0]).toLowerCase();
  return (c0.includes('id') && c0.includes('entrega')) || c0 === 'id_entrega' || c0 === 'identificador';
}

function registreDesDeArrayPedidosPerEntrega(row, volumPerTipus) {
  const r = [...row];
  while (r.length < 8) r.push(null);
  const idEntrega = text(r[0]);
  const nomEntrega = text(r[1]);
  const direccio = text(r[2]);
  const nomPedido = text(r[3]);
  const tipusCarrega = text(r[4]);
  const quantitat = numero(r[5]);
  const horaIniciEntrega = horaExcelAHhMm(r[6]);
  const horaIniciPedido = horaExcelAHhMm(r[7]);
  if (!idEntrega || !direccio) return null;

  return {
    idEntrega,
    nomEntrega,
    direccio,
    nomPedido,
    tipusCarrega,
    quantitat,
    horaIniciEntrega,
    horaIniciPedido,
    _volumUnitari: volumUnitariDesDeTipus(tipusCarrega, volumPerTipus),
  };
}

function parseFilaObjectePedidosPerEntrega(fila, volumPerTipus) {
  const idEntrega = text(
    obtenirCamp(
      fila,
      'ID_Entrega',
      'ID Entrega',
      'Id_Entrega',
      'IdEntrega',
      'ID_entrega',
      'Identificador_Entrega',
    ),
  );
  const nomEntrega = text(
    obtenirCamp(fila, 'Nom_Entrega', 'Nom Entrega', 'Nombre_Entrega', 'NomEntrega', 'Nom entrega'),
  );
  const direccio = text(
    obtenirCamp(fila, 'Direcció', 'Direccion', 'Dirección', 'Adreça', 'Adreca', 'Address'),
  );
  const nomPedido = text(
    obtenirCamp(fila, 'Nom_Pedido', 'Nom Pedido', 'Nombre_Pedido', 'NomPedido', 'Nom pedido'),
  );
  const tipusCarrega = text(
    obtenirCamp(
      fila,
      'Tipus_Càrrega',
      'Tipus_Carrega',
      'Tipus carrega',
      'Tipo_Carga',
      'Tipo carga',
      'TipusCarrega',
    ),
  );
  const quantitat = numero(obtenirCamp(fila, 'Quantitat', 'Cantidad', 'Qty'));
  const horaIniciEntrega = horaExcelAHhMm(
    obtenirCamp(fila, 'Hora_Inici_Entrega', 'Hora Inici Entrega', 'HoraIniciEntrega', 'Hora entrega inici'),
  );
  const horaIniciPedido = horaExcelAHhMm(
    obtenirCamp(fila, 'Hora_Inici_Pedido', 'Hora Inici Pedido', 'HoraIniciPedido', 'Hora pedido inici'),
  );

  if (!idEntrega || !direccio) return null;

  return {
    idEntrega,
    nomEntrega,
    direccio,
    nomPedido,
    tipusCarrega,
    quantitat,
    horaIniciEntrega,
    horaIniciPedido,
    _volumUnitari: volumUnitariDesDeTipus(tipusCarrega, volumPerTipus),
  };
}

function registresPedidosPerEntregaDesDeFulla(worksheet, volumPerTipus) {
  const matriu = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  if (Array.isArray(matriu) && matriu.length > 0) {
    let inici = 0;
    if (esCapcaleraFilaPedidosPerEntrega(matriu[0])) inici = 1;
    const extrets = [];
    for (let i = inici; i < matriu.length; i += 1) {
      const reg = registreDesDeArrayPedidosPerEntrega(matriu[i], volumPerTipus);
      if (reg) extrets.push(reg);
    }
    if (extrets.length > 0) return extrets;
  }

  const filas = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: true,
  });
  const extretsObj = [];
  for (const fila of filas) {
    const reg = parseFilaObjectePedidosPerEntrega(fila, volumPerTipus);
    if (reg) extretsObj.push(reg);
  }
  return extretsObj;
}

function agrupaRegistresPerIdEntrega(registres) {
  const ordenats = [...registres].sort((a, b) => a.idEntrega.localeCompare(b.idEntrega, 'ca'));
  /** @type {Array<{ identificador: string, nom: string, adreca: string, horaInici: string|null, horaFinal: string|null, pedidos: Pedido[] }>} */
  const blocs = [];

  for (const r of ordenats) {
    let bloc = blocs.find((b) => b.identificador === r.idEntrega);
    if (!bloc) {
      bloc = {
        identificador: r.idEntrega,
        nom: r.nomEntrega,
        adreca: r.direccio,
        horaInici: r.horaIniciEntrega,
        horaFinal: null,
        pedidos: [],
      };
      blocs.push(bloc);
    } else {
      if (normalitzaAdreca(bloc.adreca) !== normalitzaAdreca(r.direccio)) {
        throw new Error(
          `ID entrega "${r.idEntrega}" amb adreces diferents ("${bloc.adreca}" vs "${r.direccio}").`,
        );
      }
      if (bloc.horaInici !== r.horaIniciEntrega && r.horaIniciEntrega != null && bloc.horaInici != null) {
        throw new Error(`ID entrega "${r.idEntrega}" amb Hora Inici Entrega inconsistent.`);
      }
      if (bloc.horaInici == null && r.horaIniciEntrega != null) bloc.horaInici = r.horaIniciEntrega;
    }

    bloc.pedidos.push(
      new Pedido({
        nom: r.nomPedido || 'Producte',
        volum: r._volumUnitari,
        quantitat: r.quantitat,
      }),
    );
  }

  return blocs;
}

function pausaMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function excelToEntregasPedidosPerIdEntrega(filePath, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pausaEntreGeocodificacionsMs =
    options.pausaEntreGeocodificacionsMs != null ? Number(options.pausaEntreGeocodificacionsMs) : 1100;
  const volumPerTipus = options.volumPerTipus;

  const geocodificar =
    typeof options.geocodificar === 'function'
      ? options.geocodificar
      : (adreca) => geocodificarAdrecaNominatim(adreca, fetchImpl);

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const primeraHoja = workbook.SheetNames[0];
  if (!primeraHoja) return [];

  const worksheet = workbook.Sheets[primeraHoja];
  const registres = registresPedidosPerEntregaDesDeFulla(worksheet, volumPerTipus);
  if (!registres.length) return [];

  const preparades = agrupaRegistresPerIdEntrega(registres);

  const entregues = [];
  for (let g = 0; g < preparades.length; g += 1) {
    const bloc = preparades[g];

    if (g > 0 && pausaEntreGeocodificacionsMs > 0) {
      await pausaMs(pausaEntreGeocodificacionsMs);
    }

    const coordenades = await geocodificar(bloc.adreca);

    entregues.push(
      new Entrega({
        identificador: bloc.identificador,
        nom: bloc.nom,
        adreca: bloc.adreca,
        pedidos: bloc.pedidos,
        horaInici: bloc.horaInici,
        horaFinal: bloc.horaFinal,
        coordenades,
      }),
    );
  }

  return entregues;
}

/**
 * Excel → array d’**`Entrega`** amb **`Pedido`** agrupats per **ID d’entrega** (per defecte).
 *
 * Primera fulla — columnes (amb o sense capçalera): ID entrega, Nom entrega, Direcció, Nom pedido,
 * Tipus càrrega, Quantitat, Hora inici entrega, Hora inici pedido.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {'pedidos-per-entrega'} [options.format='pedidos-per-entrega']
 * @param {Record<string, number>} [options.volumPerTipus]
 */
export async function excelToEntregas(filePath, options = {}) {
  const { format = 'pedidos-per-entrega', ...rest } = options;
  if (format === 'motor') {
    throw new Error(
      'El format Excel "motor" no està implementat en aquesta branca; usa columnes ID Entrega / Pedido per fila.',
    );
  }
  return excelToEntregasPedidosPerIdEntrega(filePath, rest);
}

export { geocodificarAdrecaNominatim } from './geocodificar-adreca.service.js';
