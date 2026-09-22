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

import { CspPolicies, ImageSrc } from "@main/csp";
import { shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { existsSync } from "fs";
import { join } from "path";

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

/**
 * Vencord filtra por CSP qué hosts pueden cargar imágenes en el renderer, y
 * su lista blanca trae `files.catbox.moe` pero no Supabase. Sin esta línea, un
 * banner guardado en Storage no carga y el perfil se ve negro — el archivo
 * está bien, es el cliente el que se niega a pedirlo.
 *
 * Vencord contempla justo esto: su `csp/index.ts` dice que un plugin puede
 * añadir sus dominios importando `CspPolicies` desde su native. Solo el host
 * de este proyecto, no `*.supabase.co`: no hay motivo para abrir el de nadie
 * más. Requiere reiniciar Discord del todo, porque la cabecera se aplica al
 * cargar la ventana.
 */
CspPolicies[new URL(SUPABASE_URL).host] = ImageSrc;
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

const IMAGES_URL = `${SUPABASE_URL}/functions/v1/xcord-images`;

export interface ImageSyncResult {
    ok: boolean;
    /** Tipo de imagen → URL pública en Storage. */
    urls?: Record<string, string>;
    /** Tipos que se borraron por dejar de aparecer en el perfil. */
    deleted?: string[];
    error?: string;
}

/**
 * Sube las imágenes locales del perfil a Storage y borra las que ya no usa.
 *
 * La escritura en el bucket exige la service role key, que no puede vivir
 * aquí: esta función solo habla con la Edge Function `xcord-images`, y es ella
 * quien comprueba el secreto del claim y escribe. Desde el plugin sale la
 * misma clave publicable que el resto de llamadas.
 *
 * `keep` son los tipos que siguen en uso tras esta publicación; todo lo demás
 * bajo el prefijo del usuario se borra.
 */
export async function syncProfileImages(
    _event: IpcMainInvokeEvent,
    discordUserId: string,
    secret: string,
    uploads: { kind: string; contentType: string; data: string; }[],
    keep: string[]
): Promise<ImageSyncResult> {
    try {
        const res = await fetch(IMAGES_URL, {
            method: "POST",
            headers: supabaseHeaders(),
            body: JSON.stringify({ discordUserId, secret, uploads, keep })
        });

        const body = await res.json().catch(() => null);

        if (!res.ok || !body?.ok) {
            return {
                ok: false,
                error: body?.error ?? `Supabase respondió ${res.status} al subir las imágenes.`
            };
        }

        return { ok: true, urls: body.urls ?? {}, deleted: body.deleted ?? [] };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "No se pudo conectar con Supabase."
        };
    }
}

/**
 * Consulta el manifiesto de versiones y lo devuelve sin interpretar.
 *
 * Vive aquí por la misma razón que el resto de llamadas externas, y además
 * porque el fallo tiene que ser silencioso: si no hay conexión, devuelve null
 * y el plugin no enseña nada. Un aviso de actualización que se convierte en
 * un error en pantalla es peor que no avisar.
 */
export async function fetchUpdateManifest(
    _event: IpcMainInvokeEvent,
    url: string
): Promise<unknown | null> {
    try {
        const target = new URL(url);
        if (target.protocol !== "https:") return null;

        // Sin caduca la petición, un servidor que no responde dejaría el
        // temporizador colgado hasta que el usuario cierre Discord.
        const res = await fetch(target.href, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
            cache: "no-store"
        });

        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Abre la página de descarga en el navegador del sistema.
 *
 * La URL sale de un archivo remoto, así que se vuelve a validar aquí aunque
 * el renderer ya lo haya hecho: esto abre una ventana fuera de Discord, y no
 * debe poder llevar a cualquier sitio porque alguien edite el manifiesto.
 */
export async function openUpdatePage(
    _event: IpcMainInvokeEvent,
    url: string
): Promise<{ ok: boolean; }> {
    try {
        const target = new URL(url);
        const allowed = ["github.com", "www.github.com", "marcoda16.github.io"];
        if (target.protocol !== "https:" || !allowed.includes(target.host)) return { ok: false };

        await shell.openExternal(target.href);
        return { ok: true };
    } catch {
        return { ok: false };
    }
}

/** Ejecuta solo el instalador incluido en este clon de xcord, nunca una ruta remota. */
export async function runXcordInstaller(
    _event: IpcMainInvokeEvent
): Promise<{ ok: boolean; error?: string; }> {
    if (process.platform !== "win32")
        return { ok: false, error: "La actualización automática con xcord.bat solo está disponible en Windows." };

    // native.ts se compila dentro de dist/; el repositorio está un nivel arriba.
    const installer = join(__dirname, "..", "src", "userplugins", "xcord", "xcord.bat");
    if (!existsSync(installer))
        return { ok: false, error: "No se encontró xcord.bat en el repositorio local. Descárgalo desde GitHub y ejecútalo manualmente." };

    try {
        const error = await shell.openPath(installer);
        return error ? { ok: false, error: `No se pudo abrir xcord.bat: ${error}` } : { ok: true };
    } catch {
        return { ok: false, error: "No se pudo abrir xcord.bat. Ejecútalo manualmente desde la carpeta de xcord." };
    }
}

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
