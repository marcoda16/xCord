export type OAuthPageKind = "success" | "error";

export interface OAuthPageOptions {
    kind: OAuthPageKind;
    title: string;
    message: string;
    /** Texto corto opcional, por ejemplo el usuario de Discord verificado. */
    identity?: string;
    /** Solo se muestra en errores para ayudar a soporte sin revelar secretos. */
    reference?: string;
    /**
     * Para la versión estática: el hueco de la referencia se rellena desde
     * `?ref=` en el navegador, porque el HTML se genera una sola vez en build.
     */
    referenceFromQuery?: boolean;
}

const escapeHtml = (value: string): string => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

/**
 * Página final del OAuth de xcord.
 *
 * No carga recursos ni analítica de terceros. Esto evita que
 * el callback filtre parámetros de la URL y hace que la página siga funcionando
 * incluso si un bloqueador de contenido está activo.
 */
export function renderOAuthPage(options: OAuthPageOptions): string {
    const success = options.kind === "success";
    const title = escapeHtml(options.title);
    const message = escapeHtml(options.message);
    const identity = options.identity?.trim()
        ? `<div class="identity"><span class="identity-dot" aria-hidden="true"></span><span>${escapeHtml(options.identity.trim())}</span></div>`
        : "";
    const reference = options.referenceFromQuery
        ? '<p class="reference" id="ref-line" hidden>Referencia: <code id="ref-code"></code></p>'
        : options.reference?.trim()
            ? `<p class="reference">Referencia: <code>${escapeHtml(options.reference.trim())}</code></p>`
            : "";
    // Solo acepta el formato exacto que emite el callback: 8 hex. Cualquier
    // otra cosa en `?ref=` se ignora, y se escribe con textContent, nunca
    // como HTML.
    const referenceScript = options.referenceFromQuery
        ? '<script>(function(){var r=new URLSearchParams(location.search).get("ref");if(r&&/^[0-9a-f]{8}$/.test(r)){document.getElementById("ref-code").textContent=r;document.getElementById("ref-line").hidden=false}})();</script>'
        : "";

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>${title} · xcord</title>
  <style>
    :root{color-scheme:dark;--bg:#0d0f15;--card:#171922;--line:#2a2e3c;--text:#f5f6f8;--muted:#aeb3c2;--brand:#8b7cff;--brand2:#5865f2;--ok:#3ddc97;--danger:#ff6b7a}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);background:radial-gradient(circle at 18% 8%,rgba(139,124,255,.18),transparent 34%),radial-gradient(circle at 90% 92%,rgba(88,101,242,.12),transparent 30%),var(--bg)}
    .shell{width:min(100%,480px)}
    .brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:18px;font-size:18px;font-weight:760;letter-spacing:-.02em}
    .mark{display:grid;place-items:center;width:34px;height:34px;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:linear-gradient(145deg,var(--brand),var(--brand2));box-shadow:0 10px 28px rgba(88,101,242,.25)}
    .mark svg{width:19px;height:19px;stroke:white;stroke-width:2.4;fill:none;stroke-linecap:round}
    .card{position:relative;overflow:hidden;padding:34px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(160deg,rgba(255,255,255,.045),transparent 42%),var(--card);box-shadow:0 24px 70px rgba(0,0,0,.42)}
    .card:before{content:"";position:absolute;inset:0 0 auto;height:3px;background:${success ? "linear-gradient(90deg,var(--ok),#55b9ff,var(--brand))" : "linear-gradient(90deg,var(--danger),#ff9b70,var(--brand))"}}
    .card:after{content:"";position:absolute;z-index:1;top:0;left:-38%;width:38%;height:3px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.95),transparent);filter:drop-shadow(0 0 5px ${success ? "var(--ok)" : "var(--danger)"});pointer-events:none}
    .status{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 20px;border-radius:18px;color:${success ? "var(--ok)" : "var(--danger)"};background:${success ? "rgba(61,220,151,.1)" : "rgba(255,107,122,.1)"};border:1px solid currentColor}
    .status svg{width:28px;height:28px;stroke:currentColor;stroke-width:2.3;fill:none;stroke-linecap:round;stroke-linejoin:round}
    h1{margin:0;text-align:center;font-size:25px;line-height:1.2;letter-spacing:-.035em}
    .message{margin:12px auto 0;max-width:370px;text-align:center;color:var(--muted);font-size:15px;line-height:1.58}
    .identity{display:flex;align-items:center;justify-content:center;gap:9px;width:max-content;max-width:100%;margin:20px auto 0;padding:9px 13px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.035);font-size:13px;font-weight:650;overflow:hidden}
    .identity span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .identity-dot{width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px rgba(61,220,151,.12)}
    .trust{display:grid;grid-template-columns:auto 1fr;gap:11px;margin-top:24px;padding-top:21px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;line-height:1.5}
    .trust svg{width:19px;height:19px;margin-top:1px;stroke:var(--ok);stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .trust strong{display:block;margin-bottom:2px;color:var(--text);font-size:13px}
    .reference{text-align:center;margin:17px 0 0;color:#858b9e;font-size:11px}
    code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    .footer{margin:15px 0 0;text-align:center;color:#7f8495;font-size:11.5px;line-height:1.5}
    @media(max-width:520px){body{padding:16px}.card{padding:28px 22px;border-radius:18px}h1{font-size:22px}}
    @media(prefers-reduced-motion:no-preference){.card{animation:arrive .42s ease-out both}.card:after{animation:wave 2.8s ease-in-out infinite}@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes wave{0%{transform:translateX(0);opacity:0}12%{opacity:1}88%{opacity:1}100%{transform:translateX(365%);opacity:0}}}
    @media(prefers-reduced-motion:reduce){.card:after{display:none}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="brand" aria-label="xcord">
      <span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></span>
      <span>xcord</span>
    </div>
    <section class="card" aria-labelledby="result-title">
      <div class="status" aria-hidden="true">
        ${success
            ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>'}
      </div>
      <h1 id="result-title">${title}</h1>
      <p class="message">${message}</p>
      ${identity}
      <div class="trust">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>
        <div><strong>Tu contraseña nunca se comparte con xcord</strong>La autorización ocurre directamente en Discord. xcord solo recibe la identidad necesaria para verificar que esta cuenta te pertenece.</div>
      </div>
      ${reference}
    </section>
    <p class="footer">Puedes cerrar esta pestaña con seguridad. El plugin terminará la vinculación automáticamente.</p>
  </main>
  ${referenceScript}
</body>
</html>`;
}

export const oauthHtmlHeaders: Readonly<Record<string, string>> = {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
};

export function oauthHtmlResponse(options: OAuthPageOptions, status = options.kind === "success" ? 200 : 400): Response {
    return new Response(renderOAuthPage(options), {
        status,
        headers: oauthHtmlHeaders
    });
}
