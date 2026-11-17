// Temporal: lista las obras más populares de AniList (manga, manhwa y manhua) para elegir cuáles sumar al catálogo.
const ANILIST = 'https://graphql.anilist.co';
const dormir = ms => new Promise(r => setTimeout(r, ms));
const Q = `query ($p:Int, $pais: CountryCode, $genero: String) { Page(page:$p, perPage:50) { pageInfo { hasNextPage }
  media(type: MANGA, format_in:[MANGA, ONE_SHOT], countryOfOrigin: $pais, genre: $genero, isAdult:false, sort: POPULARITY_DESC) {
    id idMal title { romaji english } format countryOfOrigin popularity meanScore status genres startDate { year } chapters } } }`;
async function pedir(variables){
  for (let i = 1; i <= 5; i++){
    const r = await fetch(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: Q, variables }) });
    if (r.status === 429 || r.status >= 500){ await dormir(15000 * i); continue; }
    const d = await r.json();
    if (d.errors) throw new Error(JSON.stringify(d.errors));
    return d.data.Page.media;
  }
  throw new Error('AniList no respondió');
}
const vistos = new Map();
const tandas = [['JP', null, 5], ['KR', null, 4], ['CN', null, 2],
  ['JP', 'Romance', 2], ['JP', 'Sports', 1], ['JP', 'Horror', 1], ['JP', 'Slice of Life', 1], ['JP', 'Mystery', 1], ['JP', 'Psychological', 1],
  ['KR', 'Romance', 2], ['KR', 'Horror', 1], ['CN', 'Romance', 1]];
for (const [pais, genero, paginas] of tandas){
  for (let p = 1; p <= paginas; p++){
    const lista = await pedir({ p, pais, genero });
    for (const m of lista){
      if (!vistos.has(m.id)) vistos.set(m.id, { id: m.id, mal: m.idMal, t: m.title.english || m.title.romaji, r: m.title.romaji, f: m.format, c: m.countryOfOrigin,
        pop: m.popularity, s: m.meanScore, st: m.status, y: m.startDate && m.startDate.year, ch: m.chapters, g: m.genres.join('|') });
    }
    await dormir(2500);
  }
}
console.log('CANDIDATAS_INICIO');
for (const v of [...vistos.values()].sort((a, b) => b.pop - a.pop)) console.log(JSON.stringify(v));
console.log('CANDIDATAS_FIN');
