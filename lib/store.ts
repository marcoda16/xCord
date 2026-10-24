/**
 * Almacén de perfiles.
 *
 * Dos niveles: el perfil propio vive en los settings de Vencord (persistente,
 * editable); los ajenos se piden al servidor y se cachean en memoria con TTL.
 * Todo funciona sin servidor — simplemente no verás los perfiles de otros.
 */

import * as DataStore from "@api/DataStore";
import type { PluginNative } from "@utils/types";

import { buildProfileCss, GLOBAL_KEYFRAMES, NS } from "./css";
import { type XcordProfile, SCHEMA_VERSION } from "../types";

const Native = VencordNative.pluginHelpers.xcord as PluginNative<typeof import("../native")>;

const CACHE_TTL = 5 * 60 * 1000;
/** Tras un fallo, esperar antes de reintentar sin ocultar el perfil anterior. */
const RETRY_TTL = 60 * 1000;
/** Usuarios que ya consultamos y no tienen perfil: no volvemos a preguntar tan pronto. */
const NEGATIVE_TTL = 30 * 60 * 1000;
/** Evita que recorrer muchos servidores deje perfiles en memoria toda la sesión. */
const MAX_CACHE_ENTRIES = 250;

interface CacheEntry {
    profile: XcordProfile | null;
    fetchedAt: number;
    lastAccessed: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<XcordProfile | null>>();

/**
 * El borrador sin guardar del editor, mientras está abierto.
 *
 * `profileHook` en index.tsx lee esto antes que el perfil guardado. Sin este
 * puente, cosas que dependen del store —banner, tema de color, efecto de
 * perfil, borde— no se veían en el preview hasta pulsar Guardar: solo el CSS
 * (degradados de texto) se actualizaba en vivo, porque ese sí se reinyecta en
 * cada cambio. Esto le da la misma inmediatez a lo que no es CSS.
 */
let draftOverride: XcordProfile | null = null;

/**
 * Sube con cada cambio del borrador y con cada guardado.
 *
 * Los `useMemo` de Discord que parcheamos solo recalculan si cambian sus
 * dependencias —el usuario, el servidor—, y ninguna cambia al elegir otra
 * placa. Este contador entra como dependencia extra para forzar el recálculo.
 */
let profileVersion = 0;

export function bumpProfileVersion() {
    profileVersion++;
}

export function getProfileVersion(): number {
    return profileVersion;
}

export function setDraftOverride(profile: XcordProfile | null) {
    if (draftOverride === profile) return;
    draftOverride = profile;
    // El preview del editor lee el borrador, no lo guardado: sin esto, el
    // useMemo seguiría devolviendo lo de antes mientras editas.
    profileVersion++;
}

export function getDraftOverride(): XcordProfile | null {
    return draftOverride;
}

let globalStyleEl: HTMLStyleElement | null = null;
let profilesStyleEl: HTMLStyleElement | null = null;
let previewStyleEl: HTMLStyleElement | null = null;
let profilesFlushFrame = 0;
let previewFlushFrame = 0;
let pendingPreview: XcordProfile | null = null;
/** CSS ya inyectado, por usuario, para poder reemplazarlo sin reconstruir todo. */
const injected = new Map<string, string>();

function ensureStyleElement(current: HTMLStyleElement | null, suffix: string): HTMLStyleElement {
    if (current?.isConnected) return current;
    const style = document.createElement("style");
    style.id = `${NS}-${suffix}`;
    document.head.appendChild(style);
    return style;
}

function ensureGlobalStyles() {
    globalStyleEl = ensureStyleElement(globalStyleEl, "keyframes");
    if (globalStyleEl.textContent !== GLOBAL_KEYFRAMES)
        globalStyleEl.textContent = GLOBAL_KEYFRAMES;
}

/** Los perfiles remotos cambian poco; solo reconstruimos esta hoja si uno cambió. */
function flushProfiles() {
    if (profilesFlushFrame) return;
    profilesFlushFrame = requestAnimationFrame(() => {
        profilesFlushFrame = 0;
        profilesStyleEl = ensureStyleElement(profilesStyleEl, "profiles");
        const css = [...injected.values()].join("\n");
        if (profilesStyleEl.textContent !== css) profilesStyleEl.textContent = css;
    });
}

/**
 * Avatar personalizado → id del usuario dueño.
 *
 * `dom.ts` identifica de quién es un perfil leyendo el id directo de la URL
 * del avatar (`.../avatars/<id>/...`), el mismo dato que siempre trae la
 * imagen real de Discord. Un avatar de xcord no sigue ese patrón —es una URL
 * cualquiera, de cualquier dominio—, así que sin este mapa `dom.ts` nunca
 * reconoce el perfil como tal y el resto de las personalizaciones (nombre,
 * bio, fondo) se queda sin aplicar aunque el avatar sí se vea bien.
 */
const avatarUrlToUserId = new Map<string, string>();
const avatarUrlByUserId = new Map<string, string>();

export function lookupUserIdByAvatarUrl(url: string): string | undefined {
    return avatarUrlToUserId.get(url);
}

/** Aplica (o reemplaza) los estilos de un usuario en el documento. */
export function applyProfile(profile: XcordProfile) {
    const scope = `[data-${NS}-user="${profile.userId}"]`;
    const css = buildProfileCss(profile, scope);
    const changed = injected.get(profile.userId) !== css;
    if (changed) injected.set(profile.userId, css);

    const previousAvatar = avatarUrlByUserId.get(profile.userId);
    const nextAvatar = profile.avatar?.image?.url;
    if (previousAvatar && previousAvatar !== nextAvatar) avatarUrlToUserId.delete(previousAvatar);
    if (nextAvatar) {
        avatarUrlToUserId.set(nextAvatar, profile.userId);
        avatarUrlByUserId.set(profile.userId, nextAvatar);
    } else {
        avatarUrlByUserId.delete(profile.userId);
    }

    ensureGlobalStyles();
    if (changed) flushProfiles();
}

/** Clase del contenedor del preview. El CSS del editor se acota aquí. */
export const PREVIEW_CLASS = `${NS}-preview`;

/**
 * Pinta un perfil sin guardarlo, acotado al contenedor del editor.
 *
 * Usa el mismo generador que la capa real — solo cambia el scope. Por eso el
 * preview no puede mentir: si difiere del resultado final, el bug está en el
 * generador y afecta a ambos por igual.
 */
export function applyPreview(profile: XcordProfile) {
    ensureGlobalStyles();
    pendingPreview = profile;
    if (previewFlushFrame) return;
    previewFlushFrame = requestAnimationFrame(() => {
        previewFlushFrame = 0;
        if (!pendingPreview) return;
        previewStyleEl = ensureStyleElement(previewStyleEl, "preview");
        const css = buildProfileCss(pendingPreview, `.${PREVIEW_CLASS}`);
        if (previewStyleEl.textContent !== css) previewStyleEl.textContent = css;
        pendingPreview = null;
    });
}

export function clearPreview() {
    if (previewFlushFrame) cancelAnimationFrame(previewFlushFrame);
    previewFlushFrame = 0;
    pendingPreview = null;
    previewStyleEl?.remove();
    previewStyleEl = null;
}

export function clearProfile(userId: string) {
    if (injected.delete(userId)) flushProfiles();
    const avatarUrl = avatarUrlByUserId.get(userId);
    if (avatarUrl) avatarUrlToUserId.delete(avatarUrl);
    avatarUrlByUserId.delete(userId);
}

export function teardown() {
    if (profilesFlushFrame) cancelAnimationFrame(profilesFlushFrame);
    if (previewFlushFrame) cancelAnimationFrame(previewFlushFrame);
    profilesFlushFrame = 0;
    previewFlushFrame = 0;
    pendingPreview = null;
    injected.clear();
    globalStyleEl?.remove();
    profilesStyleEl?.remove();
    previewStyleEl?.remove();
    globalStyleEl = null;
    profilesStyleEl = null;
    previewStyleEl = null;
    cache.clear();
    inFlight.clear();
    avatarUrlToUserId.clear();
    avatarUrlByUserId.clear();
}

/**
 * Caché en disco de los perfiles ajenos.
 *
 * La caché en memoria desaparece al cerrar Discord, así que en cada arranque
 * la primera vez que veías a alguien salía sin personalizar hasta que volvía
 * la petición. Guardarla hace que al abrir Discord los perfiles de la gente
 * que ya has visto estén puestos desde el primer fotograma, y la consulta al
 * servidor pasa a ser una revalidación en segundo plano que nadie nota.
 *
 * Solo se guardan los positivos. Los negativos —"esta persona no tiene
 * perfil"— se vuelven a averiguar solos y persistirlos retrasaría media hora
 * la aparición de alguien que acaba de publicar el suyo.
 */
const PERSIST_KEY = "xcordProfileCache";
const PERSIST_DEBOUNCE_MS = 5000;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Trae la caché del arranque anterior. Llamar una vez, al iniciar el plugin. */
export async function hydrateCache(): Promise<number> {
    try {
        const saved = await DataStore.get<Record<string, { profile: unknown; fetchedAt: number; }>>(PERSIST_KEY);
        if (!saved) return 0;

        const now = Date.now();
        let restored = 0;

        for (const [userId, entry] of Object.entries(saved)) {
            if (!isValid(entry?.profile)) continue;

            // `fetchedAt` se conserva tal cual: así queda caducado y el flujo
            // normal lo revalida, pero mientras tanto ya hay algo que pintar.
            cache.set(userId, { profile: entry.profile, fetchedAt: entry.fetchedAt, lastAccessed: now });
            applyProfile(entry.profile);
            restored++;
        }

        if (restored) bumpProfileVersion();
        return restored;
    } catch {
        // Una caché ilegible no es motivo para que el plugin no arranque.
        return 0;
    }
}

function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        void persistCache();
    }, PERSIST_DEBOUNCE_MS);
}

async function persistCache() {
    try {
        const out: Record<string, { profile: XcordProfile; fetchedAt: number; }> = {};
        for (const [userId, entry] of cache)
            if (entry.profile) out[userId] = { profile: entry.profile, fetchedAt: entry.fetchedAt };

        await DataStore.set(PERSIST_KEY, out);
    } catch {
        /* Que no se pueda guardar no debe romper nada en marcha. */
    }
}

/** Olvida lo guardado en disco, además de lo que haya en memoria. */
export async function clearPersistedCache(): Promise<void> {
    try {
        await DataStore.del(PERSIST_KEY);
    } catch { /* nada que hacer */ }
}

function isValid(p: unknown): p is XcordProfile {
    return !!p && typeof p === "object"
        && (p as XcordProfile).version === SCHEMA_VERSION
        && typeof (p as XcordProfile).userId === "string";
}

/**
 * Devuelve el perfil cacheado de un usuario, o `undefined` si aún no lo tenemos.
 * Es síncrono a propósito: el render nunca espera por la red.
 */
export function getCached(userId: string): XcordProfile | null | undefined {
    const entry = cache.get(userId);
    if (!entry) return undefined;
    const now = Date.now();
    const ttl = entry.profile ? CACHE_TTL : NEGATIVE_TTL;
    if (now - entry.fetchedAt > ttl) {
        // Una placa visible no debe desaparecer solo porque toque renovar
        // la caché. La petición nueva se dispara desde resolveProfile.
        if (!entry.profile) {
            cache.delete(userId);
            return undefined;
        }
    }

    entry.lastAccessed = now;
    return entry.profile;
}

export function needsProfileRefresh(userId: string): boolean {
    const entry = cache.get(userId);
    return !!entry?.profile && Date.now() - entry.fetchedAt > CACHE_TTL && !inFlight.has(userId);
}

function cacheProfile(userId: string, profile: XcordProfile | null) {
    const now = Date.now();
    cache.set(userId, { profile, fetchedAt: now, lastAccessed: now });
    schedulePersist();

    while (cache.size > MAX_CACHE_ENTRIES) {
        let oldest: string | undefined;
        let oldestAccess = Infinity;
        for (const [id, entry] of cache) {
            if (entry.lastAccessed < oldestAccess) {
                oldest = id;
                oldestAccess = entry.lastAccessed;
            }
        }
        if (!oldest) break;
        cache.delete(oldest);
        if (injected.has(oldest)) clearProfile(oldest);
    }
}

/**
 * Pide el perfil de un usuario a Supabase. Deduplica peticiones concurrentes
 * para el mismo usuario — abrir un popout dispara varios renders.
 *
 * Va por el proceso principal (`Native.fetchRemoteProfile`): la CSP del
 * renderer bloquea peticiones a dominios externos, y `supabase.co` es uno.
 */
/**
 * Ventana en la que se juntan los usuarios vistos antes de preguntar por
 * ellos. Lo bastante corta para no retrasar nada perceptible, y suficiente
 * para que una lista entera quepa en una sola petición.
 */
const BATCH_WINDOW_MS = 60;

type PendingResult = { ok: boolean; profile?: { profile: unknown; updatedAt: string; } | null; };

const pending = new Map<string, ((r: PendingResult) => void)[]>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Apunta a un usuario a la próxima petición en lote.
 *
 * Antes cada perfil era su propio viaje al servidor: abrir la lista de amigos
 * con treinta personas visibles disparaba treinta peticiones, y hasta que no
 * volvían se veían los avatares sin personalizar. Ahora salen todas juntas.
 */
function enqueue(userId: string): Promise<PendingResult> {
    return new Promise(resolve => {
        const waiting = pending.get(userId);
        if (waiting) {
            waiting.push(resolve);
            return;
        }

        pending.set(userId, [resolve]);
        batchTimer ??= setTimeout(flushBatch, BATCH_WINDOW_MS);
    });
}

async function flushBatch() {
    batchTimer = null;
    const batch = new Map(pending);
    pending.clear();
    if (!batch.size) return;

    const ids = [...batch.keys()];

    try {
        const result = await Native.fetchRemoteProfiles(ids);
        for (const [id, resolvers] of batch) {
            const row = result.ok ? result.profiles?.[id] ?? null : null;
            for (const resolve of resolvers) resolve({ ok: result.ok, profile: row });
        }
    } catch {
        for (const resolvers of batch.values())
            for (const resolve of resolvers) resolve({ ok: false });
    }
}

/**
 * Cuántos ids por consulta al precargar. Cien ids caben de sobra en una URL
 * (~2 kB), y alguien con mil amigos sale en diez peticiones en vez de mil.
 */
const PREFETCH_CHUNK = 100;

/**
 * Trae de golpe los perfiles de una lista de usuarios, sin esperar a verlos.
 *
 * Se usa al arrancar con la lista de amigos: así, la primera vez que alguien
 * aparece en pantalla, su perfil ya está en caché y sale personalizado desde
 * el primer fotograma, en vez de tras un viaje al servidor.
 *
 * Se salta a quien ya tenga una entrada vigente o una petición en marcha, así
 * que lo restaurado del disco no se pide dos veces. Las tandas van una detrás
 * de otra a propósito: no hay prisa, y no tiene sentido saturar el servidor al
 * arrancar.
 */
export async function prefetchProfiles(userIds: string[]): Promise<number> {
    const now = Date.now();
    const todo = [...new Set(userIds)].filter(id => {
        if (inFlight.has(id)) return false;
        const entry = cache.get(id);
        if (!entry) return true;
        return now - entry.fetchedAt > (entry.profile ? CACHE_TTL : NEGATIVE_TTL);
    });

    let found = 0;
    let changed = false;

    for (let i = 0; i < todo.length; i += PREFETCH_CHUNK) {
        const chunk = todo.slice(i, i + PREFETCH_CHUNK);
        try {
            const result = await Native.fetchRemoteProfiles(chunk);
            if (!result.ok) continue;

            for (const id of chunk) {
                const body = result.profiles?.[id]?.profile ?? null;
                const profile = isValid(body) ? body : null;
                const before = cache.get(id)?.profile ?? null;

                cacheProfile(id, profile);
                if (profile) {
                    applyProfile(profile);
                    found++;
                } else if (before) {
                    clearProfile(id);
                }

                if (profile?.updatedAt !== before?.updatedAt || !!profile !== !!before) changed = true;
            }
        } catch {
            // Una tanda fallida no detiene las demás: esos perfiles se pedirán
            // por el camino normal cuando aparezcan en pantalla.
        }
    }

    if (changed) bumpProfileVersion();
    return found;
}

export function fetchProfile(userId: string): Promise<XcordProfile | null> {
    const existing = inFlight.get(userId);
    if (existing) return existing;

    const cached = getCached(userId);
    const entry = cache.get(userId);
    if (cached !== undefined && entry && Date.now() - entry.fetchedAt <= (entry.profile ? CACHE_TTL : NEGATIVE_TTL))
        return Promise.resolve(cached);

    const request = (async () => {
        try {
            const result = await enqueue(userId);
            if (!result.ok) throw new Error("No se pudo actualizar el perfil remoto");
            const body = result.profile?.profile ?? null;
            const profile = isValid(body) ? body : null;
            cacheProfile(userId, profile);
            if (profile) applyProfile(profile);
            else if (cached) clearProfile(userId);
            if (profile?.updatedAt !== cached?.updatedAt || !!profile !== !!cached) bumpProfileVersion();
            return profile;
        } catch {
            // Sin red: conservar la última placa válida y reintentar luego.
            if (cached) {
                const stale = cache.get(userId);
                if (stale) stale.fetchedAt = Date.now() - CACHE_TTL + RETRY_TTL;
                return cached;
            }
            cacheProfile(userId, null);
            return null;
        } finally {
            inFlight.delete(userId);
        }
    })();

    inFlight.set(userId, request);
    return request;
}
