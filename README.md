# Radar WNBA

Web que muestra los partidos WNBA del día con datos de TeamRankings.com:
posición, % de victorias y racha; puntos 1er cuarto, 1ª mitad, juego y rebotes
(local en casa / visita fuera); 3 marcadores posibles, total y hándicap (spread).

## Estructura
- `public/index.html` — la página
- `netlify/functions/wnba.mjs` — lee TeamRankings y entrega `/api/wnba`
- `netlify.toml` — configuración de Netlify (no cambiar)

## Publicar
1. Crear repositorio nuevo en GitHub y subir TODO respetando las carpetas.
2. Netlify → Add new site → Import from GitHub → elegir el repositorio.
3. Dejar vacíos Build command y Publish directory (los toma de netlify.toml) → Deploy.
