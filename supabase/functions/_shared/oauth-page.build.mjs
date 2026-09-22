// Genera el sitio estático que sirve GitHub Pages, desde el mismo renderer que
// usa la vista previa local. No hay una segunda copia del HTML en ningún sitio:
// si cambias `oauth-page.ts`, vuelve a ejecutar esto y commitea el resultado.
//
//   node oauth-page.build.mjs [directorio-de-salida]

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderOAuthPage } from "./oauth-page.ts";
import { oauthOutcomes } from "./oauth-outcomes.ts";

const outDir = resolve(process.argv[2] ?? "dist/oauth");
mkdirSync(outDir, { recursive: true });

for (const [outcome, options] of Object.entries(oauthOutcomes)) {
    const html = renderOAuthPage({ ...options, referenceFromQuery: options.kind === "error" });
    writeFileSync(resolve(outDir, `${outcome}.html`), html, "utf8");
    console.log(`${outcome}.html  ${html.length} bytes`);
}

console.log(`\nGenerado en ${outDir}`);
