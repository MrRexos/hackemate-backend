# hackemate-backend

## Pipeline principal: Excel → rutes

Genera `output/excel-rutes.json` i `output/excel-rutes.html` a partir de comandes Excel, horaris i geocodificació.

```bash
npm install
npm run excel:entregues-geocode
```

Opcions i variables d’entorn: vegeu el capçalament de `src/scripts/excel-a-entregues-geocodificar.js`.

**Entrada per defecte:** `fixtures/excel/comandes.xlsx`, `fixtures/excel/horaris.XLSX`.  
**Sortida:** carpeta `output/` (JSON, HTML, memòria cau de geocodificació opcional).

## API Express (opcional)

`npm run dev` — endpoints sota `/api` (salut, usuaris). No calen per al script Excel.

## Documentació

- Flux Excel → rutes (passos i ordre dels mòduls): `docs/flux-excel-rutes.md`

## Altres

- `hackemate-frontend/` (arrel del monorepositori) és una UI Vite/React independent del pipeline Excel.
