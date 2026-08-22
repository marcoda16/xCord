/**
 * Subida de archivos, en el proceso principal.
 *
 * Esto no vive en la interfaz por una razón concreta: la CSP de Discord bloquea
 * las peticiones a dominios externos desde el renderer. El proceso principal no
 * tiene esa restricción, así que la subida se hace aquí y solo viaja de vuelta
 * la URL resultante.
 *
 * Nada se sube por iniciativa propia: estas funciones solo se ejecutan cuando
 * el usuario pulsa el botón de subir en el editor.
 */

import { shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";

const CATBOX_API = "https://catbox.moe/user/api.php";

/** Límite de Catbox. Muy por encima de cualquier banner razonable. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Candidatos para el catálogo de la tienda, en orden de preferencia.
 *
 * Discord mantiene varias versiones de su API a la vez y mueve estas rutas entre
 * ellas. En vez de fijar una y fallar con un 404 opaco, probamos varias y el
 * resultado dice cuál respondió — así el diagnóstico viene con el error.
 */
const CATALOG_APIS = [
    "https://discord.com/api/v9/user-profile-effects",
    "https://discord.com/api/v10/user-profile-effects",
    "https://discord.com/api/v9/collectibles-categories",
    "https://discord.com/api/v10/collectibles-categories"
];

export interface ProfileEffectEntry {
    id: string;
    title: string;
}

/**
 * Extrae los efectos de una respuesta, sea cual sea su forma.
 *
 * `user-profile-effects` devuelve `{ profile_effect_configs: [...] }`, mientras
 * que `collectibles-categories` devuelve categorías con productos dentro. Cubrir
 * las dos evita tener que acertar la ruta a la primera.
 */
function extractEffects(body: any): ProfileEffectEntry[] {
    const configs = body?.profile_effect_configs;
    if (Array.isArray(configs))
        return configs.map((c: any) => ({ id: String(c.id), title: c.title || String(c.id) }));

    if (Array.isArray(body)) {
        const out: ProfileEffectEntry[] = [];
        for (const category of body) {
            for (const product of category?.products ?? category?.items ?? []) {
                const id = product?.id ?? product?.sku_id;
                if (id) out.push({ id: String(id), title: product?.name || String(id) });
            }
        }
        return out;
    }

    return [];
}

/**
 * Lista los efectos de perfil que Discord publica.
 *
 * Se pide desde el proceso principal porque la CSP del renderer bloquea las
 * peticiones a dominios externos. No lleva credenciales: es un catálogo público,
 * el mismo que alimenta la tienda.
 */
export async function fetchProfileEffects(
    _event: IpcMainInvokeEvent
): Promise<{ ok: boolean; effects?: ProfileEffectEntry[]; error?: string; }> {
    // Qué pasó con cada ruta, para poder informar en vez de decir solo "falló".
    const attempts: string[] = [];

    for (const url of CATALOG_APIS) {
        const path = url.replace("https://discord.com/api/", "");
        try {
            const res = await fetch(url);

            if (!res.ok) {
                attempts.push(`${path} → ${res.status}`);
                continue;
            }

            const effects = extractEffects(await res.json());
            if (!effects.length) {
                attempts.push(`${path} → 200 pero sin efectos`);
                continue;
            }

            return { ok: true, effects };
        } catch (err) {
            attempts.push(`${path} → ${err instanceof Error ? err.message : "error de red"}`);
        }
    }

    return { ok: false, error: `Ninguna ruta sirvió.\n\n${attempts.join("\n")}` };
}

/**
 * Sincronización de perfiles, contra el proyecto Supabase de xcord.
 *
 * Las lecturas son públicas (RLS: cualquiera puede leer). Las escrituras
 * pasan por dos funciones de Postgres —`xcord_publish_profile` y
 * `xcord_delete_profile`— que verifican un secreto antes de tocar nada; la
 * tabla en sí no admite INSERT/UPDATE/DELETE directos. El secreto se genera
 * una vez por instalación y se guarda en los ajustes del plugin — nunca en
 * texto plano en la base de datos, solo su hash.
 */
const SUPABASE_URL = "https://reiszfgtqtyumfaatajl.supabase.co";
const SUPABASE_KEY = "sb_publishable_0Bb4rGdNcrgcAeJTTSZvSg_gImsiVUb";

function supabaseHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...extra
    };
}

export interface RemoteProfile {
    profile: unknown;
    updatedAt: string;
}

/** El perfil publicado de un usuario, o `null` si no ha publicado ninguno. */
export async function fetchRemoteProfile(
    _event: IpcMainInvokeEvent,
    discordUserId: string
): Promise<{ ok: boolean; profile?: RemoteProfile | null; error?: string; }> {
    try {
        const url = `${SUPABASE_URL}/rest/v1/xcord_profiles` +
            `?discord_user_id=eq.${encodeURIComponent(discordUserId)}` +
            `&select=profile,updated_at&limit=1`;

        const res = await fetch(url, { headers: supabaseHeaders() });
        if (!res.ok) return { ok: false, error: `Supabase respondió ${res.status}.` };

        const rows = await res.json() as Array<{ profile: unknown; updated_at: string; }>;
        if (!rows.length) return { ok: true, profile: null };

        return { ok: true, profile: { profile: rows[0].profile, updatedAt: rows[0].updated_at } };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "No se pudo conectar con Supabase."
        };
    }
}

/**
 * Publica (o actualiza) el perfil propio.
 *
 * `secret` reclama el `discordUserId` la primera vez; en publicaciones
 * siguientes tiene que coincidir con el que ya quedó guardado, o la función
 * de Postgres rechaza la escritura.
 */
export async function publishProfile(
    _event: IpcMainInvokeEvent,
    discordUserId: string,
    secret: string,
    profile: unknown
): Promise<{ ok: boolean; error?: string; }> {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/xcord_publish_profile`, {
            method: "POST",
            headers: supabaseHeaders(),
            body: JSON.stringify({
                p_discord_user_id: discordUserId,
                p_secret: secret,
                p_profile: profile
            })
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { ok: false, error: `Supabase respondió ${res.status}: ${body.slice(0, 300)}` };
        }

        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "No se pudo conectar con Supabase."
        };
    }
}

/** Retira el perfil propio de la nube. Requiere el mismo secreto que lo publicó. */
export async function deleteRemoteProfile(
    _event: IpcMainInvokeEvent,
    discordUserId: string,
    secret: string
): Promise<{ ok: boolean; error?: string; }> {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/xcord_delete_profile`, {
            method: "POST",
            headers: supabaseHeaders(),
            body: JSON.stringify({ p_discord_user_id: discordUserId, p_secret: secret })
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { ok: false, error: `Supabase respondió ${res.status}: ${body.slice(0, 300)}` };
        }

        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "No se pudo conectar con Supabase."
        };
    }
}

/**
 * Login real de Discord, vía OAuth2 en tu navegador de verdad.
 *
 * Cierra el hueco del esquema "quien reclama primero, gana": el secreto que
 * queda ligado a tu id de Discord solo lo genera nuestro servidor, y solo
 * después de que Discord confirme —contra su propia API, con nuestro client
 * secret, que nunca sale de ahí— que de verdad eres tú. El plugin nunca ve el
 * client secret, ni el código de autorización: solo el resultado final.
 */
const DISCORD_CLIENT_ID = "1540619781378539601";
const OAUTH_CALLBACK_URL = `${SUPABASE_URL}/functions/v1/discord-oauth-callback`;
const OAUTH_POLL_URL = `${SUPABASE_URL}/functions/v1/discord-oauth-poll`;

/** Abre el login de Discord en el navegador del sistema y devuelve el `state` para sondear. */
export async function startDiscordLogin(
    _event: IpcMainInvokeEvent
): Promise<{ ok: boolean; state?: string; error?: string; }> {
    try {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        const state = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

        const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
        authorizeUrl.searchParams.set("client_id", DISCORD_CLIENT_ID);
        authorizeUrl.searchParams.set("redirect_uri", OAUTH_CALLBACK_URL);
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("scope", "identify");
        authorizeUrl.searchParams.set("state", state);

        await shell.openExternal(authorizeUrl.toString());
        return { ok: true, state };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "No se pudo abrir el navegador."
        };
    }
}

export interface OAuthPollResult {
    status: "pending" | "done" | "error";
    discord_user_id?: string;
    secret?: string;
    error?: string;
}

/** Pregunta si el login con ese `state` ya terminó. Se llama en bucle desde el editor. */
export async function pollDiscordLogin(
    _event: IpcMainInvokeEvent,
    state: string
): Promise<{ ok: boolean; result?: OAuthPollResult; error?: string; }> {
    try {
        const res = await fetch(`${OAUTH_POLL_URL}?state=${encodeURIComponent(state)}`, {
            headers: supabaseHeaders()
        });
        if (!res.ok) return { ok: false, error: `Supabase respondió ${res.status}.` };

        return { ok: true, result: await res.json() as OAuthPollResult };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "No se pudo conectar con Supabase."
        };
    }
}

export interface UploadResult {
    ok: boolean;
    /** URL pública del archivo, si la subida salió bien. */
    url?: string;
    /** Mensaje legible para mostrar en el editor, si falló. */
    error?: string;
}

/**
 * Sube un archivo a Catbox y devuelve su URL pública.
 *
 * Recibe el contenido en base64 porque es lo que sobrevive al paso por IPC
 * entre el renderer y el proceso principal.
 */
export async function uploadFile(
    _event: IpcMainInvokeEvent,
    base64: string,
    fileName: string,
    mimeType: string
): Promise<UploadResult> {
    try {
        const bytes = Buffer.from(base64, "base64");

        if (bytes.byteLength > MAX_UPLOAD_BYTES)
            return { ok: false, error: "El archivo supera los 200 MB que admite Catbox." };

        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", new Blob([bytes], { type: mimeType }), fileName);

        const res = await fetch(CATBOX_API, { method: "POST", body: form });
        const text = (await res.text()).trim();

        if (!res.ok)
            return { ok: false, error: `Catbox respondió ${res.status}: ${text.slice(0, 200)}` };

        // Catbox devuelve la URL en texto plano, sin JSON ni envoltorio. Si la
        // respuesta no es una URL, es un mensaje de error suyo.
        if (!text.startsWith("https://"))
            return { ok: false, error: text.slice(0, 200) || "Catbox devolvió una respuesta vacía." };

        return { ok: true, url: text };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "No se pudo conectar con Catbox."
        };
    }
}
