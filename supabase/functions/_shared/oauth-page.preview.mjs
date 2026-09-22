// Vista previa local de las páginas finales del OAuth, sin desplegar nada.
//
//   node oauth-page.preview.mjs
//
// Sirve el índice en http://127.0.0.1:4179/ y cada desenlace en /<nombre>.
// Acepta `?ref=a1b2c3d4` igual que la versión publicada.

import { createServer } from "node:http";
import { renderOAuthPage } from "./oauth-page.ts";
import { oauthOutcomes } from "./oauth-outcomes.ts";

const PORT = 4179;
const names = Object.keys(oauthOutcomes);

const index = `<!doctype html><meta charset="utf-8"><title>Vista previa OAuth · xcord</title>
<style>body{font-family:system-ui,sans-serif;background:#0d0f15;color:#f5f6f8;display:grid;place-items:center;min-height:100vh;margin:0}
ul{list-style:none;padding:0;line-height:2.2}a{color:#8b7cff}</style>
<div><h1>Vista previa OAuth</h1><ul>${names
    .map(n => `<li><a href="/${n}?ref=a1b2c3d4">${n}</a> — ${oauthOutcomes[n].title}</li>`)
    .join("")}</ul></div>`;

createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
    const name = url.pathname.replace(/^\/|\.html$/g, "");

    if (!name) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return response.end(index);
    }

    const options = oauthOutcomes[name];
    if (!options) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return response.end(`Desenlace desconocido. Prueba: ${names.join(", ")}`);
    }

    // Exactamente lo que genera el build para GitHub Pages.
    const html = renderOAuthPage({ ...options, referenceFromQuery: options.kind === "error" });
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
}).listen(PORT, "127.0.0.1", () => {
    console.log(`Vista previa OAuth en http://127.0.0.1:${PORT}`);
});
