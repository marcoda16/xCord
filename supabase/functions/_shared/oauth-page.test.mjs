// node oauth-page.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { oauthHtmlHeaders, renderOAuthPage } from "./oauth-page.ts";
import { OAUTH_PAGE_BASE, oauthOutcomes, oauthRedirect } from "./oauth-outcomes.ts";

let checks = 0;
const ok = (condition, detail) => {
    assert.ok(condition, detail);
    checks++;
};

// ── Renderer ────────────────────────────────────────────────────────────────

const success = renderOAuthPage({
    kind: "success",
    title: "Cuenta vinculada correctamente",
    message: "Ya puedes volver a Discord.",
    identity: "usuario_demo"
});

ok(success.startsWith("<!doctype html>"));
ok(success.includes("usuario_demo"));
ok(success.includes("M5 12.5"), "icono de éxito");
ok(!success.includes("close-btn"), "sin botón de cierre");
ok(!success.includes("window.close"), "sin intento de cierre bloqueado");
ok(!success.includes("Cerrar y volver a Discord"), "sin llamada a una acción imposible");
ok(success.includes("@keyframes wave"), "la franja tiene animación wave");
ok(success.includes("translateX(365%)"), "la onda recorre la franja de izquierda a derecha");
ok(success.includes("prefers-reduced-motion:reduce"), "respeta movimiento reducido");

const error = renderOAuthPage({
    kind: "error",
    title: "Enlace inválido",
    message: "Inténtalo de nuevo.",
    reference: "req-123"
});

ok(error.includes("req-123"));
ok(error.includes('<circle cx="12"'), "icono de error");

const unsafe = "<script>alert(1)</script>";
const escaped = renderOAuthPage({
    kind: "error",
    title: unsafe,
    message: unsafe,
    identity: unsafe,
    reference: unsafe
});

ok(!escaped.includes(unsafe), "no debe inyectarse HTML");
ok(escaped.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));

ok(success.includes("Puedes cerrar esta pestaña con seguridad"));

// Hueco de referencia para la versión estática: vacío en el HTML, rellenado
// desde `?ref=` solo si encaja con el formato que emite el callback.
const slot = renderOAuthPage({ kind: "error", title: "X", message: "Y", referenceFromQuery: true });
ok(slot.includes('id="ref-code"></code>'), "el hueco se genera vacío");
ok(slot.includes("/^[0-9a-f]{8}$/"), "valida el formato de ref");
ok(slot.includes("textContent"), "escribe como texto, no como HTML");
ok(!slot.includes("innerHTML"), "ninguna página usa innerHTML");

ok(!slot.includes("onclick="), "sin manejadores en atributos");

ok(oauthHtmlHeaders["Cache-Control"] === "no-store, max-age=0");
ok(/frame-ancestors 'none'/.test(oauthHtmlHeaders["Content-Security-Policy"]));

// ── Contrato de la redirección ──────────────────────────────────────────────

ok(OAUTH_PAGE_BASE.startsWith("https://"), "la página final va por HTTPS");

// oauthOutcomes no está anotado (ver el comentario allí), así que la forma se
// comprueba aquí: cada desenlace debe seguir sirviendo como OAuthPageOptions.
for (const [outcome, options] of Object.entries(oauthOutcomes)) {
    ok(["success", "error"].includes(options.kind), `${outcome}: kind válido`);
    ok(renderOAuthPage(options).includes("<h1"), `${outcome}: se renderiza`);
}

for (const [outcome, options] of Object.entries(oauthOutcomes)) {
    const res = oauthRedirect(outcome, "a1b2c3d4");
    ok(res.status === 302, `${outcome}: 302`);
    const location = new URL(res.headers.get("Location"));
    ok(location.pathname.endsWith(`/${outcome}.html`), `${outcome}: destino`);
    ok([...location.searchParams.keys()].every(k => k === "ref"), `${outcome}: solo ref en la URL`);
    ok(res.headers.get("Referrer-Policy") === "no-referrer", `${outcome}: sin referente`);
    ok(options.title.length > 0 && options.message.length > 0, `${outcome}: tiene texto`);
}

ok(!oauthRedirect("ok").headers.get("Location").includes("?"), "el éxito no lleva query");

// ── El callback no puede filtrar ────────────────────────────────────────────

const callback = readFileSync(new URL("../discord-oauth-callback/index.ts", import.meta.url), "utf8");
const calls = callback.match(/oauthRedirect\([^)]*\)/g) ?? [];
ok(calls.length >= 8, `se esperaban >=8 redirecciones, hay ${calls.length}`);

for (const call of calls) {
    const args = call.slice("oauthRedirect(".length, -1).split(",").map(a => a.trim()).filter(Boolean);
    const [outcome, ref] = args;
    ok(Object.keys(oauthOutcomes).includes(JSON.parse(outcome)), `desenlace conocido: ${outcome}`);
    ok(ref === undefined || ref === "requestId", `solo requestId puede viajar: ${call}`);
}

ok(!callback.includes("<!doctype"), "el callback no construye HTML");
ok(!callback.includes("oauthHtmlResponse"), "el callback ya no devuelve HTML");

console.log(`oauth-page: ${checks} comprobaciones superadas`);
