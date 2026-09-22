import type { ProfileWidgetHero, ProfileWidgetLink, ProfileWidgets } from "../types";

export const MAX_WIDGET_LINKS = 4;
const MAX_TITLE_LENGTH = 48;
const MAX_DESCRIPTION_LENGTH = 120;
const MAX_URL_LENGTH = 2048;

export function safeHttpsUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

    try {
        const url = new URL(trimmed);
        return url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}

function cleanText(value: unknown, max: number): string {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeHero(value: unknown): ProfileWidgetHero | undefined {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Partial<ProfileWidgetHero>;
    const title = cleanText(raw.title, MAX_TITLE_LENGTH);
    const url = safeHttpsUrl(raw.url);
    const imageUrl = safeHttpsUrl(raw.imageUrl);
    // La portada puede ser puramente visual. Antes exigíamos título y enlace,
    // por lo que el editor guardaba una imagen válida que el renderer descartaba.
    if (!title && !imageUrl) return undefined;

    return {
        title: title || undefined,
        url: url ?? undefined,
        imageUrl: imageUrl ?? undefined,
        description: cleanText(raw.description, MAX_DESCRIPTION_LENGTH) || undefined
    };
}

function normalizeLink(value: unknown, index: number): ProfileWidgetLink | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Partial<ProfileWidgetLink>;
    const title = cleanText(raw.title, MAX_TITLE_LENGTH);
    if (!title) return null;

    return {
        id: cleanText(raw.id, 80) || `link-${index}`,
        title,
        description: cleanText(raw.description ?? raw.url, MAX_DESCRIPTION_LENGTH) || undefined,
        imageUrl: safeHttpsUrl(raw.imageUrl) ?? undefined
    };
}

/** Normaliza datos remotos antes de convertirlos en nodos navegables. */
export function normalizeWidgets(value: unknown): ProfileWidgets | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Partial<ProfileWidgets>;
    const hero = normalizeHero(raw.hero);
    const links = Array.isArray(raw.links)
        ? raw.links.slice(0, MAX_WIDGET_LINKS).map(normalizeLink).filter((link): link is ProfileWidgetLink => !!link)
        : [];

    return hero || links.length ? { hero, links } : null;
}
