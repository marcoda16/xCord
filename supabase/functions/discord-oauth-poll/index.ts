// El plugin sondea aquí mientras esperas a que termines de aprobar en el
// navegador. Devuelve el estado de una sesión, y borra la fila al entregar
// un resultado final — consumo único, no queda ningún secreto guardado ahí
// después de que el plugin lo recoge.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async req => {
  let state: string | null = null;

  if (req.method === "GET") {
    state = new URL(req.url).searchParams.get("state");
  } else {
    try {
      const body = await req.json();
      state = body?.state ?? null;
    } catch { /* cuerpo vacío o inválido */ }
  }

  if (!state) return json({ status: "error", error: "Falta state." }, 400);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/xcord_oauth_sessions?state=eq.${encodeURIComponent(state)}&select=status,discord_user_id,secret,error`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
  );

  if (!res.ok) return json({ status: "error", error: `lectura falló: ${res.status}` }, 502);

  const rows = await res.json();
  if (!rows.length) return json({ status: "pending" });

  const row = rows[0];

  if (row.status === "done" || row.status === "error") {
    await fetch(`${SUPABASE_URL}/rest/v1/xcord_oauth_sessions?state=eq.${encodeURIComponent(state)}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }
    });
  }

  return json(row);
});
