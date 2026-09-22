// Sube las imágenes de un perfil a Storage y devuelve sus URL públicas.
//
// Por qué existe: el perfil viaja a Postgres como jsonb, y una imagen local
// incrustada como `data:` URI lo hacía pesar decenas de kB — un banner medido
// ocupaba 65 kB, el 99% de su perfil, frente a los 80 bytes de un enlace. Aquí
// las imágenes se van a Storage y el perfil guarda solo la URL.
//
// Por qué una función y no subir desde el plugin: escribir en el bucket exige
// la service role key, y esa clave no puede salir del servidor. El plugin
// manda el secreto del claim —lo mismo que ya necesita para publicar— y esta
// función lo comprueba antes de tocar nada.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET = "xcord-images";
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Rutas fijas por usuario y tipo: `<id>/avatar`, `<id>/banner`,
 * `<id>/widget-hero`, `<id>/widget-link-<id de la tarjeta>`. Volver a subir
 * pisa el objeto anterior en vez de acumular copias, y como el nombre no
 * lleva extensión, cambiar de PNG a JPEG tampoco deja huérfanos: el tipo va
 * en la cabecera del objeto.
 */
const KIND = /^(avatar|banner|widget-hero|widget-link-[A-Za-z0-9_-]{1,32})$/;

/** Solo lo que acepta el bucket. Se comprueba aquí para dar un error legible. */
const TYPES: Record<string, (b: Uint8Array) => boolean> = {
    "image/png": b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    "image/jpeg": b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    "image/gif": b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
    "image/webp": b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
    });

const storageHeaders = (extra?: Record<string, string>) => ({
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    ...extra
});

/** El mismo bcrypt que guarda el claim, sin que el hash salga de Postgres. */
async function secretIsValid(discordUserId: string, secret: string): Promise<boolean> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/xcord_verify_secret`, {
        method: "POST",
        headers: { ...storageHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ p_discord_user_id: discordUserId, p_secret: secret })
    });
    if (!res.ok) return false;
    return await res.json() === true;
}

/** Ocho hex del contenido. Va en `?v=` para que cambiar la imagen invalide la caché. */
async function contentTag(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest).slice(0, 4), b => b.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(data: string): Uint8Array | null {
    try {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
}

async function listOwned(discordUserId: string): Promise<string[]> {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: { ...storageHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: `${discordUserId}/`, limit: 100 })
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows.map((r: { name: string; }) => r.name) : [];
}

Deno.serve(async req => {
    if (req.method !== "POST") return json({ ok: false, error: "Solo POST." }, 405);

    let body: {
        discordUserId?: string;
        secret?: string;
        uploads?: { kind?: string; contentType?: string; data?: string; }[];
        keep?: string[];
    };
    try {
        body = await req.json();
    } catch {
        return json({ ok: false, error: "Cuerpo inválido." }, 400);
    }

    const discordUserId = String(body.discordUserId ?? "");
    const secret = String(body.secret ?? "");
    const uploads = Array.isArray(body.uploads) ? body.uploads : [];
    const keep = Array.isArray(body.keep) ? body.keep.filter(k => KIND.test(k)) : [];

    // Solo dígitos: es un snowflake de Discord. Cierra de paso cualquier
    // intento de salirse del prefijo del usuario con `..` o `/`.
    if (!/^\d{5,25}$/.test(discordUserId)) return json({ ok: false, error: "Id de Discord inválido." }, 400);
    if (secret.length < 16) return json({ ok: false, error: "Secreto ausente o demasiado corto." }, 400);
    if (uploads.length > 8) return json({ ok: false, error: "Demasiadas imágenes en una publicación." }, 400);

    if (!await secretIsValid(discordUserId, secret))
        return json({ ok: false, error: "Secreto incorrecto para este usuario." }, 403);

    const urls: Record<string, string> = {};

    for (const upload of uploads) {
        const kind = String(upload.kind ?? "");
        const contentType = String(upload.contentType ?? "");

        if (!KIND.test(kind)) return json({ ok: false, error: `Tipo de imagen desconocido: ${kind}` }, 400);
        if (!(contentType in TYPES)) return json({ ok: false, error: `Formato no admitido: ${contentType}` }, 400);

        const bytes = decodeBase64(String(upload.data ?? ""));
        if (!bytes || !bytes.length) return json({ ok: false, error: `${kind}: contenido ilegible.` }, 400);
        if (bytes.length > MAX_BYTES) return json({ ok: false, error: `${kind}: supera los 4 MB.` }, 413);

        // El tipo declarado tiene que coincidir con lo que hay dentro: si no,
        // el bucket aceptaría cualquier cosa etiquetada como imagen.
        if (!TYPES[contentType](bytes))
            return json({ ok: false, error: `${kind}: el contenido no es ${contentType}.` }, 400);

        const path = `${discordUserId}/${kind}`;
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
            method: "POST",
            headers: storageHeaders({
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=31536000, immutable",
                "x-upsert": "true"
            }),
            body: bytes
        });

        if (!res.ok) {
            const detail = await res.text().catch(() => "");
            return json({ ok: false, error: `${kind}: Storage respondió ${res.status}. ${detail.slice(0, 200)}` }, 502);
        }

        urls[kind] = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}?v=${await contentTag(bytes)}`;
    }

    // Lo que el perfil ya no usa se borra. `keep` lo manda el plugin con los
    // tipos que siguen vivos tras esta publicación, subidos ahora o de antes.
    const existing = await listOwned(discordUserId);
    const orphans = existing.filter(name => !keep.includes(name));

    if (orphans.length) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
            method: "DELETE",
            headers: { ...storageHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ prefixes: orphans.map(name => `${discordUserId}/${name}`) })
        });
    }

    return json({ ok: true, urls, deleted: orphans });
});
