// Discord redirige aquí tras el login. Sin verify_jwt: es una navegación
// directa del navegador del usuario, sin forma de mandar un token de Supabase.
// La autenticación real la hace Discord: solo aceptamos lo que llega con un
// `code` de verdad, intercambiable por un token con NUESTRO client secret.
//
// Esta función no devuelve HTML: redirige a una página estática en GitHub
// Pages. El gateway de Supabase reescribe las respuestas `text/html` de los
// proyectos sin dominio propio a `text/plain`, así que el navegador enseñaba
// el código fuente en vez de la página. Los motivos y el contrato de la
// redirección están en ../_shared/oauth-outcomes.ts.
//
// En la URL de destino solo viaja el desenlace y una referencia de 8 hex.
// Nunca el `code`, el `state`, el secreto del claim, el token de Discord ni
// el texto de una excepción: eso solo va a la fila de sesión, que el plugin
// consume una vez y borra.

import { oauthRedirect } from "../_shared/oauth-outcomes.ts";

const DISCORD_CLIENT_ID = "1540619781378539601";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISCORD_CLIENT_SECRET = Deno.env.get("DISCORD_CLIENT_SECRET")!;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/discord-oauth-callback`;

/** Guarda (o reemplaza) el resultado de esta sesión, para que el plugin lo recoja al sondear. */
async function recordSession(state: string, fields: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/xcord_oauth_sessions`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({ state, ...fields })
  });
}

Deno.serve(async req => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // Referencia corta y opaca. Viaja en la URL de la página final y se antepone
  // al `error` de la fila de sesión, para casar lo que vio el usuario con el
  // detalle real sin exponer nada de ese detalle.
  const requestId = crypto.randomUUID().slice(0, 8);

  if (!state) {
    return oauthRedirect("incomplete", requestId);
  }

  if (oauthError) {
    await recordSession(state, { status: "error", error: `[${requestId}] Discord: ${oauthError}` });
    return oauthRedirect("cancelled", requestId);
  }

  if (!code) {
    await recordSession(state, { status: "error", error: `[${requestId}] Discord no envió un código.` });
    return oauthRedirect("expired", requestId);
  }

  try {
    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI
      })
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      await recordSession(state, { status: "error", error: `[${requestId}] Token: ${tokenRes.status} ${body.slice(0, 200)}` });
      return oauthRedirect("discord", requestId);
    }

    const { access_token } = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    if (!userRes.ok) {
      await recordSession(state, { status: "error", error: `[${requestId}] users/@me: ${userRes.status}` });
      return oauthRedirect("discord", requestId);
    }

    const discordUser = await userRes.json();
    const discordUserId = String(discordUser.id);

    // El secreto que va a quedar reclamando este id. Se genera aquí, tras
    // confirmar la identidad — nunca antes.
    const secretBytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = Array.from(secretBytes, b => b.toString(16).padStart(2, "0")).join("");

    const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/xcord_oauth_set_secret`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_discord_user_id: discordUserId, p_secret: secret })
    });

    if (!claimRes.ok) {
      const body = await claimRes.text();
      await recordSession(state, { status: "error", error: `[${requestId}] claim: ${claimRes.status} ${body.slice(0, 200)}` });
      return oauthRedirect("failed", requestId);
    }

    await recordSession(state, { status: "done", discord_user_id: discordUserId, secret });

    // En el éxito no hace falta referencia: no hay nada que diagnosticar.
    return oauthRedirect("ok");
  } catch (err) {
    await recordSession(state, { status: "error", error: `[${requestId}] ${String(err)}` });
    return oauthRedirect("failed", requestId);
  }
});
