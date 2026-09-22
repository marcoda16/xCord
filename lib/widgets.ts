import type { ProfileWidgetHero, ProfileWidgetLink, ProfileWidgets } from "../types";

import { NS } from "./css";
import { normalizeWidgets } from "./widgetData";

const WIDGETS_CLASS = `${NS}-widgets`;
const STYLE_ID = `${NS}-widgets-style`;

function ensureWidgetStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.${WIDGETS_CLASS}{position:relative;display:flex;flex-direction:column;gap:12px;margin:16px;min-width:0;max-width:100%;flex:0 0 auto;box-sizing:border-box;color:var(--text-normal);font-family:var(--font-primary)}
.${WIDGETS_CLASS} a{color:inherit;text-decoration:none}
.${WIDGETS_CLASS}.${NS}-widgets-compact{margin:12px 0;align-self:stretch}
.${NS}-widgets-compact .${NS}-widget-hero{min-height:112px;border-radius:10px}
.${NS}-widgets-compact .${NS}-widget-hero-copy{padding:12px}
.${NS}-widgets-compact .${NS}-widget-title{font-size:16px}
.${NS}-widget-hero{position:relative;display:flex;align-items:flex-end;min-height:148px;overflow:hidden;border:1px solid var(--background-modifier-accent);border-radius:14px;background:linear-gradient(135deg,var(--background-secondary),var(--background-tertiary));isolation:isolate}
.${NS}-widget-hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.${NS}-widget-hero.${NS}-widget-has-copy:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 25%,rgba(0,0,0,.88));z-index:1;pointer-events:none}
.${NS}-widget-hero-copy{position:relative;z-index:2;padding:18px;min-width:0;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7)}
.${NS}-widget-title{font-size:20px;font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${NS}-widget-description{margin-top:5px;color:rgba(255,255,255,.78);font-size:13px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.${NS}-widget-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.${NS}-widget-link{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:11px;padding:9px;border:1px solid transparent;border-radius:12px;transition:background-color .15s,border-color .15s}
.${NS}-widget-link:hover{background:var(--background-modifier-hover);border-color:var(--background-modifier-accent)}
.${NS}-widget-icon{display:grid;place-items:center;width:48px;height:48px;overflow:hidden;border-radius:11px;background:var(--background-secondary);color:var(--text-muted);font-size:19px;font-weight:700}
.${NS}-widget-icon img{width:100%;height:100%;object-fit:cover}
.${NS}-widget-link-copy{min-width:0}
.${NS}-widget-link-title{overflow:hidden;color:var(--header-primary);font-size:14px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.${NS}-widget-link-subtitle{margin-top:3px;overflow:hidden;color:var(--text-muted);font-size:12px;line-height:1.35;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.${NS}-widget-host{min-width:300px;flex:1 1 360px;overflow:auto}
@media(max-width:760px){.${NS}-widget-grid{grid-template-columns:1fr}}
`;
    document.head.appendChild(style);
}

function externalLink(url: string, className: string): HTMLAnchorElement {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.className = className;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    return anchor;
}

function appendImage(parent: Element, src: string | undefined, alt: string) {
    if (!src) return;
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    parent.appendChild(image);
}

function renderHero(hero: ProfileWidgetHero): HTMLElement {
    const hasCopy = !!(hero.title || hero.description);
    const card = hero.url
        ? externalLink(hero.url, `${NS}-widget-hero`)
        : document.createElement("div");
    card.className = `${NS}-widget-hero${hasCopy ? ` ${NS}-widget-has-copy` : ""}`;
    appendImage(card, hero.imageUrl, "");

    if (hasCopy) {
        const copy = document.createElement("div");
        copy.className = `${NS}-widget-hero-copy`;

        if (hero.title) {
            const title = document.createElement("div");
            title.className = `${NS}-widget-title`;
            title.textContent = hero.title;
            copy.appendChild(title);
        }

        if (hero.description) {
            const description = document.createElement("div");
            description.className = `${NS}-widget-description`;
            description.textContent = hero.description;
            copy.appendChild(description);
        }

        card.appendChild(copy);
    }

    return card;
}

function renderLink(link: ProfileWidgetLink): HTMLElement {
    const anchor = document.createElement("div");
    anchor.className = `${NS}-widget-link`;
    const icon = document.createElement("div");
    icon.className = `${NS}-widget-icon`;
    if (link.imageUrl) appendImage(icon, link.imageUrl, "");
    else icon.textContent = link.title.slice(0, 1).toUpperCase();

    const copy = document.createElement("div");
    copy.className = `${NS}-widget-link-copy`;
    const title = document.createElement("div");
    title.className = `${NS}-widget-link-title`;
    title.textContent = link.title;
    const address = document.createElement("div");
    address.className = `${NS}-widget-link-subtitle`;
    address.textContent = link.description ?? "";
    copy.append(title);
    if (link.description) copy.append(address);
    anchor.append(icon, copy);
    return anchor;
}

/**
 * Localiza la columna ancha del perfil completo. En popouts pequeños no
 * inserta nada: es el mismo alcance de los Profile Widgets nativos.
 */
export function findWidgetHost(root: Element, card: Element): Element | null {
    if (!root.contains(card)) return null;

    // La barra de pestañas identifica la columna de contenido del perfil.
    // Nunca subimos fuera de root ni creamos una columna en un ancestro:
    // el editor de Discord también tiene envoltorios anchos y barras laterales.
    const bounds = root.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    for (const tabs of root.querySelectorAll('[role="tablist"]')) {
        const tabBounds = tabs.getBoundingClientRect();
        if (tabBounds.width < 260 || tabBounds.left < bounds.left + bounds.width * 0.35) continue;

        for (let host = tabs.parentElement; host && host !== root; host = host.parentElement) {
            if (!root.contains(host)) break;
            const rect = host.getBoundingClientRect();
            // Al alcanzar el envoltorio de ambas columnas dejamos de buscar.
            if (rect.left < tabBounds.left - 48 || rect.right > tabBounds.right + 48) break;
            if (rect.width < 260 || rect.height < tabBounds.height + 80) continue;
            return host;
        }
    }
    return null;
}

export function renderWidgets(root: Element, card: Element, value: unknown) {
    const widgets = normalizeWidgets(value);
    const existing = root.querySelector<HTMLElement>(`:scope .${WIDGETS_CLASS}`);
    if (!widgets) {
        existing?.remove();
        root.querySelector(`:scope .${NS}-widget-host`)?.remove();
        return;
    }

    const fullHost = findWidgetHost(root, card);
    const compact = !fullHost;
    const host = fullHost ?? (widgets.hero ? findCompactWidgetHost(root, card) : null);
    if (!host) {
        existing?.remove();
        return;
    }
    const visibleWidgets = compact ? { hero: widgets.hero, links: [] } : widgets;
    const signature = JSON.stringify({ compact, widgets: visibleWidgets });
    if (existing?.dataset.signature === signature) {
        placeWidgets(host, existing, compact);
        return;
    }
    existing?.remove();
    ensureWidgetStyles();

    const container = document.createElement("section");
    container.className = `${WIDGETS_CLASS}${compact ? ` ${NS}-widgets-compact` : ""}`;
    container.dataset.signature = signature;
    container.setAttribute("aria-label", "Widgets de xcord");

    if (widgets.hero) container.appendChild(renderHero(widgets.hero));
    if (visibleWidgets.links.length) {
        const grid = document.createElement("div");
        grid.className = `${NS}-widget-grid`;
        for (const link of visibleWidgets.links) grid.appendChild(renderLink(link));
        container.appendChild(grid);
    }

    placeWidgets(host, container, compact);
}

export function findCompactWidgetHost(root: Element, card: Element): Element | null {
    if (!root.contains(card) || root.querySelector('[role="tablist"]')) return null;
    const width = root.getBoundingClientRect().width;
    if (width < 240 || width > 480) return null;
    // Insertar en el cuerpo que contiene la información del perfil, dentro
    // de su scroll, sin añadir nada al envoltorio flotante ni a sus efectos.
    const region = card.querySelector('[role="region"], section[aria-labelledby], section[aria-label]');
    const host = region?.parentElement;
    return host && card.contains(host) ? host : null;
}

function placeWidgets(host: Element, container: HTMLElement, compact = false) {
    if (compact) {
        const regions = [...host.children].filter(child => !child.classList.contains(WIDGETS_CLASS) && child.matches('[role="region"], section[aria-labelledby], section[aria-label]'));
        const next = regions.at(-1)?.nextElementSibling ?? null;
        if (next !== container && !(next === null && host.lastElementChild === container)) host.insertBefore(container, next);
        return;
    }
    let tabs = host.querySelector('[role="tablist"]');
    while (tabs?.parentElement && tabs.parentElement !== host) tabs = tabs.parentElement;
    const next = tabs?.nextElementSibling ?? null;
    // Mantener la barra de pestañas arriba y no volver a mover el nodo en
    // cada pasada del observador (eso provocaría nuevas mutaciones).
    if (next === container) return;
    host.insertBefore(container, next);
}

export function removeAllWidgets() {
    for (const element of document.querySelectorAll(`.${WIDGETS_CLASS}, .${NS}-widget-host`))
        element.remove();
    document.getElementById(STYLE_ID)?.remove();
}
