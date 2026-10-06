// Radar WNBA — función de Netlify que lee TeamRankings.com y devuelve JSON.
// Sin dependencias externas: usa fetch nativo (Node 18+) y un lector de tablas HTML propio.

const BASE = "https://www.teamrankings.com/wnba";
const URLS = {
  standings: `${BASE}/standings/`,
  q1: `${BASE}/stat/1st-quarter-points-per-game`,
  h1: `${BASE}/stat/1st-half-points-per-game`,
  pts: `${BASE}/stat/points-per-game`,
  reb: `${BASE}/stat/total-rebounds-per-game`,
};

const PLAYER_STATS = {
  pts: `${BASE}/player-stat/points`,
  ast: `${BASE}/player-stat/assists`,
  reb: `${BASE}/player-stat/rebounds`,
};
const TOP_PLAYERS = 5;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

// Alias por si la página abrevia nombres en alguna tabla
const ALIASES = {
  la: "losangeles", lasparks: "losangeles", ny: "newyork", nyliberty: "newyork",
  lv: "lasvegas", vegas: "lasvegas", gs: "goldenstate", gsvalkyries: "goldenstate",
  conn: "connecticut", wash: "washington", minn: "minnesota", phx: "phoenix",
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const key = (s) => { const k = norm(s); return ALIASES[k] || k; };
const cleanTeam = (s) => String(s || "").replace(/\(\d+-\d+(-\d+)?\)/g, "").replace(/^#\d+\s+/, "").trim();
const pkey = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function num(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------- descarga con reintento y límite de tiempo ----------
async function getHtml(url, tries = 2, timeoutMs = 3500) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (!/<table/i.test(html)) throw new Error("la página no trae tablas (posible bloqueo)");
      return html;
    } catch (e) {
      lastErr = e.name === "AbortError" ? new Error("tiempo de espera agotado") : e;
      if (i < tries - 1) await sleep(350);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastErr ? lastErr.message : "error desconocido");
}

// ---------- lector de tablas HTML ----------
function decode(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ")
    .trim();
}

function parseTables(html) {
  const out = [];
  const reTable = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = reTable.exec(html))) {
    const rows = [];
    const reRow = /<tr[\s\S]*?<\/tr>/gi;
    let r;
    while ((r = reRow.exec(m[0]))) {
      const cells = [];
      const reCell = /<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi;
      let c;
      while ((c = reCell.exec(r[0]))) cells.push(decode(c[2]));
      if (cells.length) rows.push(cells);
    }
    out.push({ index: m.index, rows });
  }
  return out;
}

// ---------- partidos del día ----------
function parseSchedule(html) {
  const isHdr = (r) => r.some((c) => /matchup/i.test(c));
  const t = parseTables(html).find((t) => t.rows.some(isHdr));
  if (!t) return [];
  const hdr = t.rows.find(isHdr);
  const idx = (re) => hdr.findIndex((c) => re.test(c));
  const iM = idx(/matchup/i), iTime = idx(/^time/i), iLoc = idx(/location/i), iHot = idx(/hotness/i);

  const games = [];
  for (const r of t.rows) {
    if (isHdr(r)) continue;
    const txt = (r[iM] || "").replace(/\(\d+-\d+\)/g, "").trim();
    const mm = txt.match(/^(?:#(\d+)\s+)?(.+?)\s+(at|vs\.?|@)\s+(?:#(\d+)\s+)?(.+)$/i);
    if (!mm) continue;
    // Partido jugado: marcador junto a cada equipo ("Minnesota 88 at Indiana 80")
    // o en otra celda ("88-80", "Final 88-80").
    const splitScore = (raw) => { const m = /^(.*?)\s+(\d{2,3})\s*$/.exec(raw.trim()); return m ? [m[1].trim(), +m[2]] : [raw.trim(), null]; };
    let [away, awayScore] = splitScore(mm[2]);
    let [home, homeScore] = splitScore(mm[5]);
    if (awayScore == null || homeScore == null) {
      awayScore = homeScore = null; away = mm[2].trim(); home = mm[5].trim();
    }
    let time = iTime >= 0 ? r[iTime] || "" : "";
    let result = "";
    const scoreCell = r.find((c, i) => i !== iM && /^\D*\d{2,3}\s*[-–]\s*\d{2,3}\D*$/.test(c) && !/\d{1,2}:\d{2}/.test(c));
    if (awayScore == null && scoreCell) result = scoreCell.trim();
    if (/final/i.test(time) || (scoreCell && time === scoreCell)) { if (!result && awayScore == null) result = time; time = ""; }
    games.push({
      away, home, awayScore, homeScore, result,
      awayRank: mm[1] ? +mm[1] : null,
      homeRank: mm[4] ? +mm[4] : null,
      neutral: !/^(at|@)$/i.test(mm[3]),
      time,
      location: iLoc >= 0 ? r[iLoc] || "" : "",
      hotness: iHot >= 0 ? num(r[iHot]) : null,
    });
  }
  return games;
}

// ---------- tabla de posiciones ----------
function parseStandings(html) {
  const isHdr = (r) => r.includes("Team") && r.some((c) => /streak/i.test(c));
  const tables = parseTables(html).filter((t) => t.rows.some(isHdr));
  const map = {};
  tables.forEach((t, ti) => {
    // Detecta la conferencia por el texto previo a la tabla; si no, por orden (1ª Este, 2ª Oeste)
    const before = html.slice(Math.max(0, t.index - 2500), t.index);
    const e = before.search(/eastern(?![\s\S]*eastern)/i);
    const w = before.search(/western(?![\s\S]*western)/i);
    let conf = ti === 0 ? "Este" : "Oeste";
    if (e >= 0 || w >= 0) conf = e > w ? "Este" : "Oeste";

    const hdr = t.rows.find(isHdr);
    const idx = (re) => hdr.findIndex((c) => re.test(c));
    const iT = hdr.indexOf("Team"), iRank = idx(/^rank$/i), iWL = idx(/overall/i),
      iPct = idx(/^pct$/i), iHome = idx(/^home$/i), iRoad = idx(/^road$/i), iStreak = idx(/streak/i);

    let pos = 0;
    for (const r of t.rows) {
      if (isHdr(r) || !r[iT]) continue;
      pos++;
      map[key(r[iT])] = {
        team: r[iT], pos, conf,
        powerRank: iRank >= 0 ? num(r[iRank]) : null,
        record: iWL >= 0 ? r[iWL] : "",
        pct: iPct >= 0 ? num(r[iPct]) : null,
        homeRecord: iHome >= 0 ? r[iHome] : "",
        roadRecord: iRoad >= 0 ? r[iRoad] : "",
        streak: iStreak >= 0 ? r[iStreak] : "",
      };
    }
  });
  if (!Object.keys(map).length) throw new Error("tabla de posiciones no encontrada");
  return map;
}

// ---------- páginas de estadística (Temporada, Last 3, Home, Away) ----------
function parseStat(html) {
  const isHdr = (r) => r.includes("Team") && r.includes("Home") && r.includes("Away");
  const t = parseTables(html).find((t) => t.rows.some(isHdr));
  if (!t) throw new Error("tabla de estadística no encontrada");
  const hdr = t.rows.find(isHdr);
  const iT = hdr.indexOf("Team"), iH = hdr.indexOf("Home"), iA = hdr.indexOf("Away"),
    iL3 = hdr.findIndex((c) => /last\s*3/i.test(c));
  let iS = hdr.findIndex((c, i) => i > iT && /^\d{4}$/.test(c)); // columna del año actual
  if (iS < 0) iS = iT + 1;

  const map = {};
  for (const r of t.rows) {
    if (isHdr(r) || !r[iT]) continue;
    map[key(r[iT])] = {
      season: num(r[iS]),
      last3: iL3 >= 0 ? num(r[iL3]) : null,
      home: num(r[iH]),
      away: num(r[iA]),
    };
  }
  return map;
}

// ---------- estadísticas de jugadores ----------
// Busca la tabla con columnas de jugador, equipo y valor. Si la cabecera no las nombra,
// las deduce del contenido (columna con nombres de personas, columna con equipos, última numérica).
const RE_PLAYER = /player|^name$|athlete/i;
const RE_TEAM = /team|school|college/i;
const RE_VALUE = /^value$|per\s*game|^avg|average|^ppg$|^apg$|^rpg$|^pts$|^ast$|^reb$|points|assists|rebounds/i;

function parsePlayers(html) {
  const tables = parseTables(html).filter((t) => t.rows.length >= 3);
  if (!tables.length) throw new Error("tabla de jugadores no encontrada");
  let best = null;
  for (const t of tables) {
    const hi = t.rows.findIndex((r) => r.some((c) => RE_PLAYER.test(c)) && r.some((c) => RE_TEAM.test(c)));
    let iP = -1, iT = -1, iV = -1, start = 0;
    if (hi >= 0) {
      const hdr = t.rows[hi];
      iP = hdr.findIndex((c) => RE_PLAYER.test(c));
      iT = hdr.findIndex((c, i) => i !== iP && RE_TEAM.test(c));
      iV = hdr.findIndex((c, i) => i !== iP && i !== iT && RE_VALUE.test(c));
      start = hi + 1;
    } else {
      // Deducción por contenido: texto sin dígitos en 2 columnas (jugador = la que tiene más palabras)
      const body = t.rows.filter((r) => r.length >= 3).slice(0, 30);
      if (body.length < 3) continue;
      const cols = Math.max(...body.map((r) => r.length));
      const textCols = [];
      for (let i = 0; i < cols; i++) {
        const vals = body.map((r) => r[i] || "");
        const txt = vals.filter((v) => /[a-z]/i.test(v) && !/\d/.test(v)).length;
        const avgLen = vals.reduce((n, v) => n + v.length, 0) / vals.length;
        // descarta columnas cortas tipo posición (G, F, C, G-F)
        if (txt >= body.length * 0.8 && avgLen > 3) textCols.push({ i, uniq: new Set(vals).size / vals.length });
      }
      if (textCols.length < 2) continue;
      // Jugador = la columna con más valores distintos (los equipos se repiten); empate = la primera
      textCols.sort((x, y) => y.uniq - x.uniq || x.i - y.i);
      iP = textCols[0].i; iT = textCols[1].i;
    }
    const byTeam = {};
    let n = 0;
    for (const r of t.rows.slice(start)) {
      if (!r[iP] || !r[iT] || RE_PLAYER.test(r[iP])) continue;
      let v = iV >= 0 ? num(r[iV]) : null;
      if (v == null) for (let i = r.length - 1; i >= 0; i--) { if (i === iP || i === iT) continue; v = num(r[i]); if (v != null) break; }
      if (v == null) continue;
      const tk = key(cleanTeam(r[iT]));
      (byTeam[tk] ||= {})[pkey(r[iP])] = { name: r[iP], team: r[iT], v };
      n++;
    }
    if (!best || n > best.n) best = { n, byTeam };
  }
  if (!best || !best.n) throw new Error("tabla de jugadores no encontrada");
  return best.byTeam;
}

// Las páginas de jugadores escriben el equipo con su apodo ("BYU Cougars", "Iowa State Cyclones",
// "North Carolina Tar Heels"). Se quita el apodo palabra por palabra desde el final hasta que el
// nombre coincide EXACTO con un equipo conocido; así "Iowa State Cyclones" nunca cae en "Iowa".
// La página de jugadores usa el nombre completo ("Las Vegas Aces", "Golden State Valkyries").
// Se quita el apodo (máx. 2 palabras) hasta que coincide EXACTO con un equipo conocido.
function teamFromPlayerPage(raw, known) {
  const words = cleanTeam(raw).split(/\s+/).filter(Boolean);
  for (let drop = 0; drop <= 2 && drop < words.length; drop++) {
    const k = key(words.slice(0, words.length - drop).join(" "));
    if (known.has(k)) return { k, drop };
  }
  return null;
}

// Reagrupa las 3 tablas de jugadores por la clave de equipo del calendario.
// Si dos equipos distintos de la página de jugadores apuntan al mismo equipo, gana el que
// necesitó quitar menos palabras (el otro se descarta en vez de mezclar jugadores).
function remapAllPlayers(players, known) {
  const raws = new Map(); // nombre crudo -> {k, drop}
  for (const map of Object.values(players)) {
    if (!map) continue;
    for (const [rawKey, plist] of Object.entries(map)) {
      const team = Object.values(plist)[0].team;
      if (raws.has(team)) continue;
      raws.set(team, known.has(rawKey) ? { k: rawKey, drop: 0 } : teamFromPlayerPage(team, known));
    }
  }
  const bestDrop = {};
  for (const r of raws.values()) if (r) bestDrop[r.k] = Math.min(bestDrop[r.k] ?? 9, r.drop);
  const out = {};
  for (const [name, map] of Object.entries(players)) {
    if (!map) { out[name] = null; continue; }
    const m = {};
    for (const plist of Object.values(map)) {
      const r = raws.get(Object.values(plist)[0].team);
      if (!r || r.drop !== bestDrop[r.k]) continue;
      Object.assign((m[r.k] ||= {}), plist);
    }
    out[name] = m;
  }
  return out;
}

function topPlayers(players, teamName) {
  const tk = key(teamName);
  const byPts = players.pts?.[tk];
  if (!byPts) return null;
  return Object.entries(byPts)
    .sort((a, b) => b[1].v - a[1].v)
    .slice(0, TOP_PLAYERS)
    .map(([pk, p]) => ({
      name: p.name,
      team: p.team,
      pts: p.v,
      ast: players.ast?.[tk]?.[pk]?.v ?? null,
      reb: players.reb?.[tk]?.[pk]?.v ?? null,
    }));
}

// Diagnóstico: /api/wnba?debug=players muestra cómo vienen las páginas de jugadores
async function debugPlayers() {
  const out = {};
  for (const [k, u] of Object.entries(PLAYER_STATS)) {
    try {
      const r = await fetch(u, { headers: HEADERS });
      const html = await r.text();
      const tables = parseTables(html);
      out[k] = {
        url: u, status: r.status, bytes: html.length, tables: tables.length,
        muestra: tables.slice(0, 4).map((t) => ({ filas: t.rows.length, primeras: t.rows.slice(0, 4) })),
        pistas: ["datatable", "tr-table", "json", "__NEXT_DATA__", "ajax", "player"].filter((w) => html.includes(w)),
      };
      try { const m = parsePlayers(html); out[k].equipos = Object.keys(m).length; out[k].ejemploEquipos = Object.keys(m).slice(0, 8); }
      catch (e) { out[k].error = e.message; }
    } catch (e) { out[k] = { url: u, error: e.message }; }
  }
  return out;
}

function find(map, name) {
  if (!map) return null;
  const k = key(name);
  if (map[k]) return map[k];
  const keys = Object.keys(map);
  const hit =
    keys.find((x) => x.startsWith(k) || k.startsWith(x)) ||
    keys.find((x) => x.includes(k) || k.includes(x));
  return hit ? map[hit] : null;
}

// ---------- fuerza relativa: últimos 5 resultados de cada equipo (página del equipo) ----------
// Respaldo si el calendario no trae el enlace del equipo
const TEAM_SLUGS = {
  atlanta: "atlanta-dream", chicago: "chicago-sky", connecticut: "connecticut-sun", dallas: "dallas-wings",
  goldenstate: "golden-state-valkyries", indiana: "indiana-fever", lasvegas: "las-vegas-aces",
  losangeles: "los-angeles-sparks", minnesota: "minnesota-lynx", newyork: "new-york-liberty",
  phoenix: "phoenix-mercury", seattle: "seattle-storm", washington: "washington-mystics",
  portland: "portland-fire", toronto: "toronto-tempo",
};
function teamSlugs(html) {
  const out = {};
  const re = /<a[^>]*href="[^"]*\/wnba\/team\/([a-z0-9-]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) { const k = key(cleanTeam(decode(m[2]))); if (k && !out[k]) out[k] = m[1]; }
  return out;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "10/04", "10/04/2026", "Oct 4", "2026-10-04" → "2026-10-04" (año del día consultado si no viene)
function isoFrom(txt, refIso) {
  const t = String(txt || "").trim();
  let y = null, mo = null, d = null, m;
  if ((m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t))) { mo = +m[1]; d = +m[2]; if (m[3]) y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; }
  else if ((m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/.exec(t)) && MONTHS[m[1].toLowerCase()]) { mo = MONTHS[m[1].toLowerCase()]; d = +m[2]; }
  if (!mo || !d) return null;
  if (!y) { const [ry, rm] = refIso.split("-").map(Number); y = mo - rm > 6 ? ry - 1 : ry; }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// Resultados jugados de la página del equipo: busca la columna de resultado ("W 88-80") y la de fecha
function parseForm(html, beforeIso) {
  const games = [];
  let order = 0;
  for (const t of parseTables(html)) {
    const hi = t.rows.findIndex((r) => r.some((c) => /^(result|w\/l)$/i.test(c.trim())));
    if (hi < 0) continue;
    const hdr = t.rows[hi];
    const iD = hdr.findIndex((c) => /^date$/i.test(c.trim()));
    const iR = hdr.findIndex((c) => /^result$/i.test(c.trim()));
    const iWL = hdr.findIndex((c) => /^w\/l$/i.test(c.trim()));
    for (const r of t.rows.slice(hi + 1)) {
      let wl = null;
      const rc = iR >= 0 ? (r[iR] || "").trim() : "";
      let m = /^([WL])\b\s*(\d+)\s*[-–]\s*(\d+)/i.exec(rc);
      if (m) wl = m[1].toUpperCase();
      else if (iWL >= 0 && /^[WL]$/i.test((r[iWL] || "").trim())) wl = r[iWL].trim().toUpperCase();
      if (!wl) continue;
      const date = iD >= 0 ? isoFrom(r[iD], beforeIso) : null;
      games.push({ date, wl, order: order++, score: m ? `${m[2]}-${m[3]}` : "" });
    }
  }
  const dated = games.every((g) => g.date);
  let list = dated ? games.filter((g) => g.date < beforeIso).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order) : games;
  const last = list.slice(-5);
  // Resultado del propio día consultado (el calendario de TeamRankings no trae el marcador de días pasados)
  const on = dated ? games.find((g) => g.date === beforeIso) : null;
  if (!last.length && !on) return null;
  return {
    fr: last.length ? last.reduce((n, g) => n + (g.wl === "W" ? 1 : -1), 0) : null,
    last: last.map((g) => ({ wl: g.wl, date: g.date, score: g.score })), dated,
    on: on ? { wl: on.wl, score: on.score } : null,
  };
}
async function teamForm(slug, beforeIso, timeoutMs) {
  const html = await getHtml(`${BASE}/team/${slug}`, 1, timeoutMs);
  return parseForm(html, beforeIso);
}
function ecToday() {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
async function debugTeam(slug) {
  const r = await fetch(`${BASE}/team/${slug}`, { headers: HEADERS });
  const html = await r.text();
  const tables = parseTables(html);
  return { status: r.status, bytes: html.length, tables: tables.map((t) => ({ filas: t.rows.length, primeras: t.rows.slice(0, 4) })).slice(0, 6), form: parseForm(html, ecToday()) };
}

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("debug") === "players")
    return json(await debugPlayers(), 200, { "Cache-Control": "no-store" });
  if (url.searchParams.get("debug") === "team")
    return json(await debugTeam(String(url.searchParams.get("slug") || "atlanta-dream").replace(/[^a-z0-9-]/g, "")), 200, { "Cache-Control": "no-store" });
  const T0 = Date.now();
  const date = url.searchParams.get("date");
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const scheduleUrl = `${BASE}/schedules/${validDate ? `?date=${validDate}` : ""}`;

  const names = ["schedule", "standings", "q1", "h1", "pts", "reb", "p_pts", "p_ast", "p_reb"];
  const refIso = validDate || ecToday();
  const schedP = getHtml(scheduleUrl);
  // Fuerza relativa: en cuanto llega el calendario se leen las páginas de los equipos del día
  const formsP = schedP.then(async (sh) => {
    const slugs = teamSlugs(sh), out = {}, errs = [];
    const keys = [...new Set(parseSchedule(sh).flatMap((g) => [key(g.home), key(g.away)]))];
    const left = Math.max(1200, Math.min(3500, 8800 - (Date.now() - T0)));
    await Promise.all(keys.map(async (k) => {
      const slug = slugs[k] || TEAM_SLUGS[k] || Object.entries(TEAM_SLUGS).find(([x]) => x.startsWith(k) || k.startsWith(x))?.[1];
      if (!slug) { errs.push(`${k}: sin enlace de equipo`); return; }
      try { out[k] = await teamForm(slug, refIso, left); if (!out[k]) errs.push(`${slug}: sin resultados`); }
      catch (e) { errs.push(`${slug}: ${e.message}`); }
    }));
    return { out, errs };
  }).catch(() => ({ out: {}, errs: [] }));
  const results = await Promise.allSettled([
    schedP,
    ...["standings", "q1", "h1", "pts", "reb"].map((k) => getHtml(URLS[k])),
    ...["pts", "ast", "reb"].map((k) => getHtml(PLAYER_STATS[k])),
  ]);

  const warnings = [];
  const html = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") html[names[i]] = r.value;
    else warnings.push(`${names[i]}: ${r.reason?.message || r.reason}`);
  });

  if (!html.schedule) {
    return json(
      { ok: false, error: "No se pudo leer el calendario de TeamRankings.", warnings },
      502,
      { "Cache-Control": "no-store" }
    );
  }

  const safe = (label, fn, src) => {
    if (!src) return null;
    try { return fn(src); } catch (e) { warnings.push(`${label}: ${e.message}`); return null; }
  };

  const games = safe("schedule", parseSchedule, html.schedule) || [];
  const standings = safe("standings", parseStandings, html.standings);
  const stats = {
    q1: safe("q1", parseStat, html.q1),
    h1: safe("h1", parseStat, html.h1),
    pts: safe("pts", parseStat, html.pts),
    reb: safe("reb", parseStat, html.reb),
  };

  // Jugadores: se leen las 3 tablas y se agrupan por el equipo del calendario
  let players = {};
  for (const k of ["pts", "ast", "reb"]) players[k] = safe(`p_${k}`, parsePlayers, html[`p_${k}`]);
  const known = new Set([
    ...Object.values(stats).flatMap((m) => Object.keys(m || {})),
    ...Object.keys(standings || {}),
    ...games.flatMap((g) => [key(g.home), key(g.away)]),
  ]);
  const rawPlayerTeams = players.pts ? Object.keys(players.pts).length : 0;
  const samplePlayerTeams = players.pts ? Object.values(players.pts).slice(0, 3).map((m) => Object.values(m)[0].team) : [];
  players = remapAllPlayers(players, known);
  // El equipo del calendario se busca con la misma tolerancia que las estadísticas de equipo
  const playersFor = (name) => {
    let k = key(name);
    if (!players.pts?.[k]) { const hit = find(Object.fromEntries(Object.keys(players.pts || {}).map((x) => [x, x])), name); if (hit) k = hit; }
    return topPlayers(players, k);
  };

  const forms = await formsP;
  if (forms.errs.length) warnings.push(`Fuerza relativa: ${forms.errs.join(" · ")}`);
  const team = (name, rank) => {
    const t = {
      name, rank,
      standing: find(standings, name),
      q1: find(stats.q1, name),
      h1: find(stats.h1, name),
      pts: find(stats.pts, name),
      reb: find(stats.reb, name),
      players: null,
      form: forms.out[key(name)] || null,
    };
    t.players = playersFor(name);
    const loaded = { standing: standings, q1: stats.q1, h1: stats.h1, pts: stats.pts, reb: stats.reb };
    const missing = Object.keys(loaded).filter((k) => loaded[k] && !t[k]);
    if (missing.length)
      warnings.push(`${name}: sin datos en ${missing.join(", ")}`);
    return t;
  };

  // Marcador de partidos ya jugados sacado de la página de cada equipo (W/L del local + puntos)
  for (const g of games) {
    if (g.homeScore != null || g.result) continue;
    const fh = forms.out[key(g.home)]?.on, fa = forms.out[key(g.away)]?.on;
    const src = fh || (fa && { wl: fa.wl === "W" ? "L" : "W", score: fa.score });
    const m = src && /(\d+)-(\d+)/.exec(src.score || "");
    if (!m) continue;
    const hi = Math.max(+m[1], +m[2]), lo = Math.min(+m[1], +m[2]);
    if (hi === lo) continue;
    [g.homeScore, g.awayScore] = src.wl === "W" ? [hi, lo] : [lo, hi];
  }
  const out = games.map((g) => ({
    time: g.time, location: g.location, hotness: g.hotness, neutral: g.neutral,
    homeScore: g.homeScore, awayScore: g.awayScore, result: g.result,
    home: team(g.home, g.homeRank),
    away: team(g.away, g.awayRank),
  }));

  if (players.pts && out.length && !out.some((g) => g.home.players || g.away.players))
    warnings.push(`Jugadores: la tabla cargó (${rawPlayerTeams} equipos) pero ningún equipo de esta fecha aparece en ella. Ej.: ${samplePlayerTeams.join(", ")}`);

  return json(
    { ok: true, date: validDate, updated: new Date().toISOString(), games: out, warnings },
    200,
    {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=900, stale-while-revalidate=3600",
      "Netlify-Vary": "query=date",
    }
  );
};

export const config = { path: "/api/wnba" };
