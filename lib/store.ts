/**
 * Almacén de perfiles.
 *
 * Dos niveles: el perfil propio vive en los settings de Vencord (persistente,
 * editable); los ajenos se piden al servidor y se cachean en memoria con TTL.
 * Todo funciona sin servidor — simplemente no verás los perfiles de otros.
 */

import type { PluginNative } from "@utils/types";

import { buildProfileCss, GLOBAL_KEYFRAMES, NS } from "./css";
import { type XcordProfile, SCHEMA_VERSION } from "../types";

const Native = VencordNative.pluginHelpers.xcord as PluginNative<typeof import("../native")>;

const CACHE_TTL = 5 * 60 * 1000;
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
        cache.delete(userId);
        return undefined;
    }

    entry.lastAccessed = now;
    return entry.profile;
}

function cacheProfile(userId: string, profile: XcordProfile | null) {
    const now = Date.now();
    cache.set(userId, { profile, fetchedAt: now, lastAccessed: now });

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
export function fetchProfile(userId: string): Promise<XcordProfile | null> {
    const cached = getCached(userId);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = inFlight.get(userId);
    if (existing) return existing;

    const request = (async () => {
        try {
            const result = await Native.fetchRemoteProfile(userId);
            const body = result.ok ? result.profile?.profile ?? null : null;
            const profile = isValid(body) ? body : null;
            cacheProfile(userId, profile);
            if (profile) applyProfile(profile);
            return profile;
        } catch {
            // Sin red: cacheamos el fallo brevemente para no martillear el servidor.
            cacheProfile(userId, null);
            return null;
        } finally {
            inFlight.delete(userId);
        }
    })();

    inFlight.set(userId, request);
    return request;
}
