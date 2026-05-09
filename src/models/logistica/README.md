# Modulo de Logistica

Aquest modul concentra la preparacio de dades de logistica abans d'executar l'algoritme de rutes.

## Flux recomanat

1. `Excel input -> productes`
2. `Productes -> entregues`
3. `Flota fixa -> camions disponibles`
4. `Entregues + camions -> algoritme de rutes`

## Estructura

- `classes/`
  - `pedido.model.js`: model base d'un pedido.
  - `entrega.model.js`: model d'entrega amb pedidos, volum i coordenades.
  - `ruta.model.js`: model de ruta associada a un camio.
- `config/`
  - `camions.constants.js`: constants de flota i conversio pales/caixes.
- `services/`
  - `excel-to-productes.converter.js`: converteix Excel a vector de productes.
  - `excel-to-entregas.converter.js`: agrupa productes en vector d'entregues.
  - `camions-fixos.service.js`: genera el vector de camions disponibles.
  - `ruta.service.js`: utilitats de calcul per rutes i ordenacio angular.
- `utils/`
  - helpers de coordenades i construccio d'entregues.
- `validators/`
  - validacions d'entrada per serveis i models.
- `index.js`
  - punt d'entrada public del modul.

## API publica (index.js)

```js
import {
  convertirExcelAProductes,
  convertirExcelAEntregas,
  crearCamionsFixos,
  FROTA_BASE_AMB_CAIXES,
  CAIXES_PER_PALE,
} from './models/logistica/index.js';
```

## Exemples d'us

### 1) Excel -> productes

```js
const productes = convertirExcelAProductes(pathExcel, {
  obtenirCaixesPerUnitat: ({ nom, tipus }) => {
    // TODO: connectar amb el vostre excel/catalog de volumetrics
    return 1;
  },
});
```

### 2) Excel -> entregues

```js
const entregues = convertirExcelAEntregas(pathExcel, {
  obtenirCaixesPerUnitat: ({ nom, tipus }) => 1,
});
```

### 3) Flota fixa -> camions

```js
const camions = crearCamionsFixos();
```

### 4) Payload per l'algoritme de rutes

```js
const payload = {
  entregues,
  camions,
};
```

L'algoritme del teu company pot consumir directament aquest `payload`.

## Configuracio de flota hardcodeada

La flota es configura en un sol fitxer global:

- `src/models/logistica/config/camions.constants.js`

Per canviar quantitats o capacitats, modifiqueu `FROTA_BASE` i, si cal, `CAIXES_PER_PALE`.
