import XLSX from 'xlsx';
import { Entrega } from '../classes/entrega.model.js';
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

function horaIguals(a, b) {
  return String(a ?? '') === String(b ?? '');
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

/**
 * Llegeix la primera fulla: ordre fix de columnes en mode array, o objectes amb capçaleres.
 * Ordre columnes (sense capçalera): ID entrega, Nom entrega, Direcció, Nom pedido, Tipus càrrega, Quantitat,
 * Hora inici entrega, Hora inici pedido.
 */
function registresPedidosPerEntregaDesDeFulla(worksheet, volumPerTipus) {
  const rowsArr = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });
  const registres = [];

  if (Array.isArray(rowsArr) && rowsArr.length > 0) {
    let start = 0;
    if (esCapcaleraFilaPedidosPerEntrega(rowsArr[0])) start = 1;
    for (let i = start; i < rowsArr.length; i += 1) {
      const row = rowsArr[i];
      if (!Array.isArray(row)) continue;
      const rec = registreDesDeArrayPedidosPerEntrega(row, volumPerTipus);
      if (rec) registres.push(rec);
    }
  }

  if (registres.length > 0) return registres;

  const filas = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: true });
  for (const fila of filas) {
    const rec = parseFilaObjectePedidosPerEntrega(fila, volumPerTipus);
    if (rec) registres.push(rec);
  }
  return registres;
}

function agrupaRegistresPerIdEntrega(registres) {
  /** @type {Map<string, { identificador: string, nom: string|null, adreca: string, horaInici: *, horaFinal: null, pedidos: object[] }>} */
  const map = new Map();

  for (const rec of registres) {
    const key = normalitzaIdGrup(rec.idEntrega);
    if (!key) {
      throw new Error(`Fila sense ID d’entrega vàlid (pedido «${rec.nomPedido || '?'}»).`);
    }

    if (!map.has(key)) {
      map.set(key, {
        identificador: String(rec.idEntrega).trim(),
        nom: rec.nomEntrega ? String(rec.nomEntrega).trim() : null,
        adreca: String(rec.direccio).trim(),
        horaInici: rec.horaIniciEntrega,
        horaFinal: null,
        pedidos: [],
      });
    }

    const bloc = map.get(key);

    if (normalitzaAdreca(bloc.adreca) !== normalitzaAdreca(rec.direccio)) {
      throw new Error(
        `ID entrega «${bloc.identificador}»: adreces inconsistents («${bloc.adreca}» vs «${rec.direccio}»).`,
      );
    }

    if (!horaIguals(bloc.horaInici, rec.horaIniciEntrega)) {
      throw new Error(`ID entrega «${bloc.identificador}»: «Hora inici entrega» diferent entre files.`);
    }

    bloc.pedidos.push({
      nom: rec.nomPedido || 'Pedido',
      volum: rec._volumUnitari,
      quantitat: rec.quantitat,
      tipusCarrega: rec.tipusCarrega || null,
      horaIniciPedido: rec.horaIniciPedido ?? null,
    });
  }

  return [...map.values()].sort((a, b) => a.identificador.localeCompare(b.identificador));
}

async function excelToEntregasPedidosPerIdEntrega(filePath, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pausaEntreGeocodificacionsMs =
    options.pausaEntreGeocodificacionsMs != null ? Number(options.pausaEntreGeocodificacionsMs) : 1100;
  const volumPerTipus = options.volumPerTipus ?? null;

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

/** Union-find per agrupar files que comparteixen ID o adreça. */
class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(i) {
    const p = this.parent[i];
    if (p !== i) this.parent[i] = this.find(p);
    return this.parent[i];
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function normalitzaIdGrup(valor) {
  return text(valor).toLowerCase();
}

function parseFilaComandesMotor(fila) {
  const id = text(obtenirCamp(fila, 'ID', 'Id', 'Identificador'));
  const adreca = text(
    obtenirCamp(fila, 'Adreça', 'Adreca', 'Direccion', 'Dirección', 'Address', 'Adresa'),
  );
  const nomProducte = text(
    obtenirCamp(fila, 'Producte', 'Producto', 'Nom', 'Nombre', 'Nombre_Carga', 'Nom_Producte'),
  );
  const quantitat = numero(obtenirCamp(fila, 'Quantitat', 'Cantidad', 'Qty', 'Quantity'));
  let volumUnitari = numero(obtenirCamp(fila, 'VolumUnitari', 'Volum_Unitari', 'VolumUnitario', 'Volumen_Unidad'));
  if (!Number.isFinite(volumUnitari) || volumUnitari <= 0) {
    volumUnitari = quantitat > 0 ? 1 : 0;
  }

  const horaInici = horaExcelAHhMm(obtenirCamp(fila, 'HoraInici', 'Hora_Inici', 'HoraInicio', 'Inicio'));
  const horaFinal = horaExcelAHhMm(obtenirCamp(fila, 'HoraFinal', 'Hora_Fi', 'HoraFin', 'Fin'));

  return { id, adreca, nomProducte, quantitat, volumUnitari, horaInici, horaFinal };
}

function pausaMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fusionaFranjaGrup(files) {
  const signatura = (r) => `${r.horaInici ?? ''}|${r.horaFinal ?? ''}`;
  const uniques = new Set(files.map(signatura));
  if (uniques.size > 1) {
    throw new Error(
      'Hi ha files agrupades (mateix ID o mateixa adreça) amb HoraInici/HoraFinal diferents; unifica la finestra.',
    );
  }
  return { horaInici: files[0].horaInici, horaFinal: files[0].horaFinal };
}

function identificadorGrup(files, adrecaRepresentativa) {
  const ids = [...new Set(files.map((r) => r.id).filter(Boolean))];
  if (ids.length > 0) return ids.join(', ');
  return adrecaRepresentativa || 'sense-id';
}

function pedidosDesDeFiles(files) {
  return files.map((r) => ({
    nom: r.nomProducte || 'Producte',
    volum: r.volumUnitari > 0 ? r.volumUnitari : 1,
    quantitat: r.quantitat,
  }));
}

function validaAdrecaUnicaGrup(files) {
  const norms = [...new Set(files.map((r) => normalitzaAdreca(r.adreca)).filter(Boolean))];
  if (norms.length > 1) {
    throw new Error(
      `Grup amb IDs/adreces enllaçades però adreces físiques diferents (${norms.slice(0, 3).join(' · ')}…).`,
    );
  }
  const raw = files.map((r) => r.adreca.trim()).find(Boolean);
  if (!raw) throw new Error('Fila sense adreça vàlida dins el grup.');
  return raw;
}

/**
 * Format antic **motor**: union-find per ID o adreça + `VolumUnitari`, `HoraFinal`, etc.
 * Crida’l amb `{ format: 'motor' }` des de {@link excelToEntregas}.
 */
async function excelToEntregasFormatMotor(filePath, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pausaEntreGeocodificacionsMs =
    options.pausaEntreGeocodificacionsMs != null ? Number(options.pausaEntreGeocodificacionsMs) : 1100;

  const geocodificar =
    typeof options.geocodificar === 'function'
      ? options.geocodificar
      : (adreca) => geocodificarAdrecaNominatim(adreca, fetchImpl);

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const primeraHoja = workbook.SheetNames[0];
  if (!primeraHoja) return [];

  const worksheet = workbook.Sheets[primeraHoja];
  const filas = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: true,
  });

  const parsed = [];
  for (const fila of filas) {
    const row = parseFilaComandesMotor(fila);
    if (!row.adreca) continue;
    parsed.push(row);
  }

  if (parsed.length === 0) return [];

  const uf = new UnionFind(parsed.length);

  const perId = new Map();
  const perAdreca = new Map();

  parsed.forEach((row, idx) => {
    const na = normalitzaAdreca(row.adreca);
    if (!perAdreca.has(na)) perAdreca.set(na, []);
    perAdreca.get(na).push(idx);

    if (row.id) {
      const nid = normalitzaIdGrup(row.id);
      if (!perId.has(nid)) perId.set(nid, []);
      perId.get(nid).push(idx);
    }
  });

  function unionAll(indices) {
    for (let k = 1; k < indices.length; k += 1) {
      uf.union(indices[0], indices[k]);
    }
  }

  for (const indices of perId.values()) {
    if (indices.length > 1) unionAll(indices);
  }
  for (const indices of perAdreca.values()) {
    if (indices.length > 1) unionAll(indices);
  }

  const grups = new Map();
  for (let i = 0; i < parsed.length; i += 1) {
    const root = uf.find(i);
    if (!grups.has(root)) grups.set(root, []);
    grups.get(root).push(parsed[i]);
  }

  const preparades = Array.from(grups.values()).map((files) => {
    const adrecaRep = validaAdrecaUnicaGrup(files);
    const { horaInici, horaFinal } = fusionaFranjaGrup(files);
    const identificador = identificadorGrup(files, adrecaRep);
    const pedidos = pedidosDesDeFiles(files);
    return { adrecaRep, horaInici, horaFinal, identificador, pedidos };
  });

  preparades.sort((a, b) => a.identificador.localeCompare(b.identificador));

  const entregues = [];
  for (let g = 0; g < preparades.length; g += 1) {
    const { adrecaRep, horaInici, horaFinal, identificador, pedidos } = preparades[g];

    if (g > 0 && pausaEntreGeocodificacionsMs > 0) {
      await pausaMs(pausaEntreGeocodificacionsMs);
    }

    const coordenades = await geocodificar(adrecaRep);

    entregues.push(
      new Entrega({
        adreca: adrecaRep,
        pedidos,
        horaInici,
        horaFinal,
        identificador,
        coordenades,
      }),
    );
  }

  return entregues;
}

/**
 * Excel → array d’**`Entrega`** amb **`Pedido`** agrupats per **ID d’entrega** (per defecte).
 *
 * **Primera fulla** — ordre de columnes (sense capçalera o amb fila de títols detectada):
 * 1. ID entrega · 2. Nom entrega · 3. Direcció · 4. Nom pedido · 5. Tipus càrrega · 6. Quantitat ·
 * 7. Hora inici entrega · 8. Hora inici pedido.
 *
 * També accepta capçaleres tipus `ID Entrega`, `Nom Entrega`, `Dirección`, etc.
 *
 * **`volumPerTipus`**: mapa opcional `{ default: 1, palet: 80, caixa: 2 }` per derivar el volum unitari del pedido
 * (si no, volum = 1). `horaIniciPedido` es guarda al `Pedido` però l’optimizer de rutes actual no la usa.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {'pedidos-per-entrega'|'motor'} [options.format='pedidos-per-entrega'] — `motor` = format antic amb `VolumUnitari` i union-find.
 * @param {Record<string, number>} [options.volumPerTipus] — Només format `pedidos-per-entrega`.
 * @returns {Promise<import('../classes/entrega.model.js').Entrega[]>}
 */
export async function excelToEntregas(filePath, options = {}) {
  const { format = 'pedidos-per-entrega', ...rest } = options;
  if (format === 'motor') {
    return excelToEntregasFormatMotor(filePath, rest);
  }
  return excelToEntregasPedidosPerIdEntrega(filePath, rest);
}

export { geocodificarAdrecaNominatim } from './geocodificar-adreca.service.js';
