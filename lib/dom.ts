/**
 * Marcado del DOM.
 *
 * El CSS generado está acotado a `[data-xcord-user="<id>"]`, así que alguien
 * tiene que poner ese atributo en los nodos del perfil. Lo hacemos con un
 * MutationObserver en vez de con patches de webpack por una razón concreta:
 * los patches se rompen cada vez que Discord recompila su bundle y hay que
 * reescribir un regex; esto se rompe cuando Discord renombra una clase, y
 * arreglarlo es editar una cadena en SELECTORS.
 *
 * El id del usuario sale de la URL del avatar, que siempre lo lleva:
 *   cdn.discordapp.com/avatars/<userId>/<hash>.png
 * Es el único dato de identidad que leemos, y no sale de este archivo.
 */

import { NS } from "./css";
import { lookupUserIdByAvatarUrl } from "./store";
import { removeAllWidgets, renderWidgets } from "./widgets";
import type { CardBorder, ProfileWidgets } from "../types";

/**
 * Selectores por clase parcial. Discord ofusca los nombres de clase con un
 * sufijo de hash (`banner_a1b2c3`) pero conserva el prefijo entre versiones,
 * que es lo que hace viable esta técnica — es la misma en la que se apoyan
 * todos los temas de Discord.
 *
 * Si algo deja de aplicarse tras una actualización, es aquí donde hay que mirar.
 */
const SELECTORS = {
    // `avatar__` con doble guión bajo, no `avatar`: así cae en el contenedor
    // (`avatar__75742`) y no en `avatarStack__` ni en `avatarDecoration__`. El
    // `:not(img)` es porque el anillo se dibuja con ::after y un <img> no tiene
    // pseudo-elementos.
    avatar: '[class*="avatar__"]:not(img)',
    // Un solo guión bajo: las clases reales son `banner_f7e69e` y `banner__68edb`,
    // y `banner_` cubre las dos. Tampoco excluimos `bannerOverlay`, porque el
    // nodo que lleva la imagen es precisamente `fill_ banner__ bannerOverlay_`.
    // Los selectores de atributo distinguen mayúsculas, así que esto sigue sin
    // caer en `profileHeaderBannerContainer__` (B mayúscula).
    banner: '[class*="banner_"]',
    // El fondo ampliado y desenfocado detrás de la columna derecha del perfil
    // v2. Discord lo alimenta con la URL del banner; lo replicamos para los
    // casos que él no puede cubrir (banner incrustado, o solo degradado).
    dynamicBg: '[class*="backgroundImage__"]',
    // El fondo de la tarjeta. `custom-theme-background` no lleva hash: es una
    // de las clases semánticas de Discord, de las que no renombra.
    background: '[class*="custom-theme-background"], [class*="profileContentInner"], [class*="overlayBackground"]',
    // Sin verificar: no apareció ninguna clase con "bio" en el perfil de
    // pruebas. Se queda como intento inofensivo hasta poder confirmarlo.
    bio: '[class*="userBio"], [class*="bio__"]'
} as const;

/**
 * Un ancestro es la raíz de un perfil si su clase habla de perfil o de popout.
 * Discord mezcla clases hasheadas (`profileHeader__9c3be`) con semánticas sin
 * hash (`user-profile-modal-v2`); estas últimas son las que sobreviven a los
 * renombrados, y ambas caen bajo este patrón.
 */
const PROFILE_ROOT = /profile|popout/i;

/** Mínimo entre repasos completos, en milisegundos. */
const RETAG_INTERVAL_MS = 250;

/** Cuántos niveles subimos desde el avatar antes de rendirnos. */
const MAX_DEPTH = 12;

const USER_ID_FROM_URL = /\/(?:avatars|banners|guilds\/\d+\/users)\/(\d+)\//;

/** Marca de "ya procesado", para no recorrer el mismo nodo en cada mutación. */
const STAMPED = `data-${NS}-stamped`;

function extractUserId(img: HTMLImageElement): string | null {
    const fromDiscordUrl = USER_ID_FROM_URL.exec(img.src)?.[1];
    if (fromDiscordUrl) return fromDiscordUrl;

    // Un avatar puesto por xcord no es una URL de Discord —puede ser
    // cualquier dominio—, así que el patrón de arriba nunca coincide. Sin
    // este respaldo, un perfil con avatar propio nunca se identificaba como
    // tal, y el resto de las personalizaciones (nombre, bio, fondo) se
    // quedaban sin aplicar aunque el avatar sí se viera bien.
    return lookupUserIdByAvatarUrl(img.src) ?? null;
}

/**
 * Si esta imagen es (probablemente) un avatar: de Discord por la forma de su
 * URL, o de xcord porque coincide con un avatar propio ya conocido.
 *
 * Reemplaza al viejo selector CSS `img[src*='/avatars/']` — ese filtraba por
 * patrón de URL antes de intentar identificar al usuario, así que un avatar
 * de xcord (que puede venir de cualquier dominio) nunca llegaba siquiera a
 * `extractUserId`. Sin este cambio, el respaldo de ahí arriba no servía de
 * nada: el nodo nunca se consideraba candidato para empezar.
 */
function isAvatarImg(img: HTMLImageElement): boolean {
    return USER_ID_FROM_URL.test(img.src) || lookupUserIdByAvatarUrl(img.src) !== undefined;
}

/**
 * Sube desde un avatar hasta la raíz de su perfil.
 *
 * Nos quedamos con el ancestro *más alto* que encaje, no con el primero: el
 * primero suele ser la cabecera (`profileHeader__`), que no contiene ni la bio
 * ni el nombre. El más alto envuelve el perfil entero.
 *
 * Devuelve null si el avatar no está dentro de un perfil — por ejemplo, los de
 * la lista de miembros o los de cada mensaje del chat.
 */
function findProfileRoot(img: Element): Element | null {
    let root: Element | null = null;
    let el: Element | null = img;

    for (let i = 0; el && i < MAX_DEPTH; i++, el = el.parentElement) {
        // SVG y foreignObject tienen className de tipo SVGAnimatedString, que
        // no es una cadena. De ahí el toString().
        if (PROFILE_ROOT.test((el.className || "").toString())) root = el;
    }

    return root;
}

/** Añade las clases que el motor de CSS espera, sin quitar las de Discord. */
function tagElements(root: Element) {
    // Las listas de amigos también contienen avatar__: solo personalizar el principal.
    const mainAvatar = findMainAvatar(root);
    const avatar = mainAvatar?.closest(SELECTORS.avatar);
    for (const el of root.querySelectorAll(`.${NS}-avatar`))
        if (el !== avatar) el.classList.remove(`${NS}-avatar`);
    if (avatar && root.contains(avatar)) avatar.classList.add(`${NS}-avatar`);

    const map: Array<[string, string]> = [
        [SELECTORS.banner, `${NS}-banner`],
        [SELECTORS.background, `${NS}-bg`],
        [SELECTORS.dynamicBg, `${NS}-dynamic-bg`],
        [SELECTORS.bio, `${NS}-bio`]
    ];

    for (const [selector, className] of map) {
        for (const el of root.querySelectorAll(selector))
            el.classList.add(className);
    }
}

/**
 * Borde de tarjeta: compositor propio.
 *
 * Discord no lo pinta con solo tenerlo en `collectibles` —lo probamos y no
 * hace nada—, así que montamos las capas con elementos reales. Cada capa es
 * una pieza PNG servida por su CDN público en
 * `.../collectibles-shop/<skuId>/<idDeCapa>/static`, verificado con
 * peticiones HTTP directas contra ese dominio.
 *
 * Es una aproximación, no una réplica exacta del renderer nativo: no tenemos
 * forma de ver cómo lo pinta Discord para compararlo con precisión. El
 * posicionamiento vertical usa `anchor` (arriba/abajo) escalado por el
 * cociente overflow entre innerWidth, como porcentaje del ancho real de la tarjeta —
 * asumiendo escala isotrópica, razonable para arte decorativo pero sin
 * verificar pixel a pixel. El orden usa `order` (delante/detrás) mediante la
 * posición en el DOM: las capas "back" van primero, las "front" al final.
 */
const BORDER_LAYERS_CLASS = `${NS}-border-layers`;
const BORDER_CDN = "https://cdn.discordapp.com/media/v1/collectibles-shop";

/** Identifica un borde por su contenido, para saber si hay que reconstruirlo. */
function borderSignature(border: CardBorder | null | undefined): string {
    return border ? `${border.skuId}:${border.layers.map(l => l.id).join(",")}` : "";
}

/**
 * Ancho mínimo, en píxeles, para que un nodo cuente como tarjeta de perfil.
 *
 * Sin este filtro el compositor también se disparaba sobre widgets pequeños
 * cuya clase también contiene "popout" —el panel de tu cuenta en la esquina
 * inferior izquierda, por ejemplo—, porque `findProfileRoot` solo mira el
 * nombre de la clase, no el tamaño real del nodo.
 */
const MIN_BORDER_ROOT_WIDTH = 250;

function renderCardBorder(root: Element, border: CardBorder | null | undefined) {
    const existing = root.querySelector(`:scope > .${BORDER_LAYERS_CLASS}`);

    // Descarta falsos positivos por tamaño antes de calcular nada.
    if (border && root.getBoundingClientRect().width < MIN_BORDER_ROOT_WIDTH)
        border = null;

    const signature = borderSignature(border);

    // Ya está construido con este mismo borde: no hay nada que rehacer.
    if (existing?.getAttribute("data-signature") === signature) return;
    existing?.remove();
    if (!border) return;

    // Sin esto los hijos absolutos se ubicarían respecto a un ancestro
    // cualquiera, no respecto a la tarjeta.
    (root as HTMLElement).style.setProperty("position", "relative");

    const container = document.createElement("div");
    container.className = BORDER_LAYERS_CLASS;
    container.setAttribute("data-signature", signature);
    // `container-type: inline-size` habilita las unidades `cqw` en los hijos:
    // 1cqw es el 1% del ANCHO de este contenedor. Lo necesitamos porque el
    // desplazamiento vertical de cada capa está pensado como proporción del
    // ancho de la tarjeta —así lo describe Discord con overflow/innerWidth—,
    // y `top`/`bottom` en porcentaje normal se miden contra la ALTURA del
    // contenedor, no el ancho: con eso, la pieza de arriba quedaba mal
    // calculada en cualquier tarjeta cuya altura no coincidiera con su ancho,
    // que es el caso normal.
    container.style.cssText =
        "position:absolute; inset:0; pointer-events:none; overflow:visible; z-index:1; " +
        "container-type:inline-size;";

    const scale = 100 / border.innerWidth;
    const topPct = border.overflowTop * scale;
    const bottomPct = border.overflowBottom * scale;
    const horizPct = border.overflowHorizontal * scale;

    // Las de atrás van primero en el DOM para quedar debajo por apilamiento
    // natural; las de delante, al final para quedar encima.
    const ordered = [...border.layers].sort((a, b) => (a.order === "front" ? 1 : 0) - (b.order === "front" ? 1 : 0));

    for (const layer of ordered) {
        const img = document.createElement("img");
        img.src = `${BORDER_CDN}/${border.skuId}/${layer.id}/static`;
        img.alt = "";
        img.draggable = false;
        img.loading = "lazy";

        const vertical = layer.anchor === "top"
            ? `top:calc(-1 * ${topPct}cqw);`
            : `bottom:calc(-1 * ${bottomPct}cqw);`;
        img.style.cssText =
            `position:absolute; left:${-horizPct}%; right:${-horizPct}%; ${vertical} ` +
            `width:${100 + horizPct * 2}%; height:auto; display:block;`;

        container.appendChild(img);
    }

    root.appendChild(container);
}

/**
 * Raíces ya detectadas, para re-marcarlas cuando Discord monte más partes.
 *
 * Marcar una sola vez no basta: el perfil no aparece entero de golpe. El avatar
 * llega primero (es lo que nos permite identificar al usuario) y el banner, la
 * bio o el nombre pueden montarse después. Sin repasar, esos nodos se quedan
 * para siempre sin su clase — que es justo por lo que el banner salía en el
 * popout pequeño pero no en el modal grande, donde carga más tarde.
 *
 * Es un WeakSet: si Discord desmonta el perfil, la entrada se recoge sola.
 */
const knownRoots = new WeakSet<Element>();
/** Los mismos nodos, en una lista que sí podemos recorrer. */
let roots: Element[] = [];

/**
 * Consulta el borde de un usuario. Vive en index.tsx, que sabe resolver
 * perfiles (propio, ajeno cacheado, borrador del editor); se registra aquí
 * para no crear un ciclo de imports entre index.tsx y dom.ts.
 */
let getBorderFor: ((userId: string) => CardBorder | null | undefined) | null = null;
let getWidgetsFor: ((userId: string) => ProfileWidgets | null | undefined) | null = null;
let getEditActionFor: ((userId: string) => (() => void) | null) | null = null;

const PROFILE_EDIT_BUTTON_CLASS = `${NS}-profile-entry`;

export function setBorderResolver(fn: typeof getBorderFor) {
    getBorderFor = fn;
}

export function setWidgetResolver(fn: typeof getWidgetsFor) {
    getWidgetsFor = fn;
}

function findMainAvatar(root: Element): HTMLImageElement | undefined {
    return [...root.querySelectorAll<HTMLImageElement>("img")].find(img =>
        isAvatarImg(img) && findProfileRoot(img) === root
    );
}

export function setProfileEditAction(fn: typeof getEditActionFor) {
    getEditActionFor = fn;
    retagAll();
}

/** Añade el acceso a xcord al final de las acciones del perfil propio. */
function renderProfileEditButton(root: Element, userId: string) {
    const existing = root.querySelector<HTMLButtonElement>(`.${PROFILE_EDIT_BUTTON_CLASS}`);
    const onEdit = getEditActionFor?.(userId);
    if (!onEdit) {
        existing?.remove();
        return;
    }

    // Discord cambia los sufijos de sus clases; el prefijo y el botón de
    // mensaje son dos maneras de encontrar esta misma fila de acciones.
    let row: HTMLElement | null = null;
    const message = [...root.querySelectorAll<HTMLButtonElement>("button")]
        .find(button => /^(Enviar mensaje|Send Message|Message)$/i.test(button.textContent?.trim() ?? ""));
    for (let parent = message?.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
        if (parent.querySelectorAll("button").length >= 3) {
            row = parent;
            break;
        }
    }
    row ??= root.querySelector<HTMLElement>('[class*="actionButtons"]');
    if (!row) return;

    // React puede reemplazar solo la fila sin desmontar el perfil entero.
    if (existing && existing.parentElement === row) return;
    existing?.remove();

    const reference = [...row.querySelectorAll<HTMLButtonElement>("button")].at(-1);
    const button = document.createElement("button");
    button.type = "button";
    button.className = [reference?.className, PROFILE_EDIT_BUTTON_CLASS,
        reference?.className ? "" : `${PROFILE_EDIT_BUTTON_CLASS}--fallback`].filter(Boolean).join(" ");
    button.title = "Editar perfil en xcord";
    button.setAttribute("aria-label", "Editar perfil en xcord");

    // Las clases del botón no bastan: Discord da el tamaño 32×32 mediante
    // buttonChildrenWrapper/buttonChildren. Clonamos solo ese contenido,
    // sin los atributos ni manejadores del botón "Más".
    const content = reference?.firstElementChild?.cloneNode(true) as Element | undefined;
    const nativeIcon = content?.querySelector<SVGSVGElement>("svg");
    const svg = nativeIcon ?? document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.replaceChildren();
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "m13.96 5.46 4.58 4.58a1 1 0 0 0 1.42 0l1.38-1.38a2 2 0 0 0 0-2.82l-3.18-3.18a2 2 0 0 0-2.82 0l-1.38 1.38a1 1 0 0 0 0 1.42ZM2.11 20.16l.73-4.22a3 3 0 0 1 .83-1.61l7.87-7.87a1 1 0 0 1 1.42 0l4.58 4.58a1 1 0 0 1 0 1.42l-7.87 7.87a3 3 0 0 1-1.6.83l-4.23.73a1.5 1.5 0 0 1-1.73-1.73Z");
    svg.appendChild(path);
    if (nativeIcon && content) button.appendChild(content);
    else {
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        button.appendChild(svg);
    }
    button.addEventListener("click", onEdit);
    row.appendChild(button);
}

/**
 * Límite real de la tarjeta, más angosto que `root` cuando el perfil completo
 * trae un panel de widgets al lado.
 *
 * `root` sigue siendo el nivel más alto que coincide con "profile"/"popout"
 * —lo necesitan el banner, el nombre y el fondo, que viven en nodos por
 * *fuera* de la tarjeta angosta—, pero ese mismo nivel también incluye el
 * panel de widgets en el perfil completo, así que el borde se salía de la
 * tarjeta y envolvía el modal entero.
 *
 * Verificado con datos reales: subiendo desde el avatar, el ancho se mantiene
 * en 400px hasta el `<main class="profile__…">` que contiene toda la
 * tarjeta, y salta a 879px en cuanto se suma la columna de widgets. Nos
 * detenemos justo antes de ese salto. En el popout, sin panel lateral, no hay
 * salto y el resultado coincide con `root`.
 */
function findCardBoundary(root: Element, avatarImg: Element): Element {
    const candidates: Element[] = [];
    for (let el: Element | null = avatarImg; el && el !== root; el = el.parentElement) {
        if (PROFILE_ROOT.test((el.className || "").toString())) candidates.push(el);
    }
    candidates.push(root);

    let chosen = candidates[0] ?? root;
    for (let i = 1; i < candidates.length; i++) {
        const prevWidth = chosen.getBoundingClientRect().width;
        const nextWidth = candidates[i].getBoundingClientRect().width;
        // Salto grande: nos pasamos de la tarjeta. Nos quedamos con el anterior.
        if (prevWidth > 0 && nextWidth > prevWidth * 1.3) break;
        chosen = candidates[i];
    }
    return chosen;
}

function applyDecorations(root: Element, userId: string) {
    const avatarImg = findMainAvatar(root);
    if (!avatarImg) return;

    const cardBoundary = findCardBoundary(root, avatarImg);

    // Siempre se llama, incluso sin borde: si el usuario lo quitó, hay que
    // limpiar el que hubiera quedado de antes.
    renderCardBorder(cardBoundary, getBorderFor?.(userId));
    renderWidgets(root, cardBoundary, getWidgetsFor?.(userId));
    renderProfileEditButton(cardBoundary, userId);
}

/** Vuelve a aplicar las clases, el borde y el anillo en todos los perfiles vivos. */
function retagAll() {
    roots = roots.filter(root => root.isConnected);
    for (const root of roots) {
        tagElements(root);
        const userId = root.getAttribute(`data-${NS}-user`);
        if (userId) applyDecorations(root, userId);
    }
}

/** Fuerza una pasada cuando cambia un perfil sin que Discord remonte su DOM. */
export function refreshProfileDom() {
    retagAll();
}

export type OnProfileSeen = (userId: string) => void;

function processAvatar(img: HTMLImageElement, onSeen: OnProfileSeen) {
    const userId = extractUserId(img);
    if (!userId) return;

    const root = findProfileRoot(img);
    if (!root) return;
    // Un amigo en común no puede reasignar el modal a otro usuario.
    if (findMainAvatar(root) !== img) return;

    // Re-marcamos si el perfil cambió de usuario: Discord reutiliza el mismo
    // nodo al pasar de un perfil a otro sin cerrar el popout.
    if (root.getAttribute(`data-${NS}-user`) === userId) return;

    root.setAttribute(STAMPED, "");
    root.setAttribute(`data-${NS}-user`, userId);
    tagElements(root);
    applyDecorations(root, userId);

    if (!knownRoots.has(root)) {
        knownRoots.add(root);
        roots.push(root);
    }

    onSeen(userId);
}

let observer: MutationObserver | null = null;

/** Temporizador del repaso pendiente, a nivel de módulo para poder cancelarlo. */
let pendingRetag = 0;
let lastRetag = 0;

/**
 * Las mutaciones del chat son, con diferencia, las más frecuentes de Discord.
 * Solo justifican repasar perfiles si el nodo añadido pertenece a uno de los
 * perfiles que ya identificamos (o si envuelve uno al reorganizar el modal).
 */
function touchesKnownProfile(node: Element): boolean {
    return roots.some(root => root.isConnected && (
        root === node || root.contains(node) || node.contains(root)
    ));
}

/**
 * Empieza a marcar perfiles. `onSeen` se llama una vez por perfil detectado,
 * y es el disparador para pedir el perfil de ese usuario al servidor.
 */
export function startObserver(onSeen: OnProfileSeen) {
    if (observer) return;

    const scan = (node: ParentNode) => {
        for (const img of node.querySelectorAll<HTMLImageElement>("img"))
            if (isAvatarImg(img)) processAvatar(img, onSeen);
    };

    scan(document);

    /**
     * El repaso es caro y casi siempre innecesario, así que se limita a una vez
     * cada RETAG_INTERVAL_MS en vez de una por frame. Un perfil que monta sus
     * piezas tarde se marca como mucho un cuarto de segundo después, que no se
     * percibe; hacerlo a 60 por segundo sí se percibía.
     */
    const scheduleRetag = () => {
        // Sin perfiles abiertos no hay nada que repasar, que es el caso normal.
        if (pendingRetag || !roots.length) return;

        const wait = Math.max(0, RETAG_INTERVAL_MS - (Date.now() - lastRetag));
        pendingRetag = window.setTimeout(() => {
            pendingRetag = 0;
            lastRetag = Date.now();
            retagAll();
        }, wait);
    };

    observer = new MutationObserver(mutations => {
        let touchedProfile = false;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;

                if (!touchedProfile && touchesKnownProfile(node))
                    touchedProfile = true;

                if (node instanceof HTMLImageElement) {
                    // El nodo añadido es la propia imagen.
                    if (isAvatarImg(node)) processAvatar(node, onSeen);
                } else if (node.getElementsByTagName("img").length) {
                    // Solo bajamos al subárbol si contiene imágenes.
                    // `getElementsByTagName` es una colección viva y comparar su
                    // longitud es mucho más barato que lanzar un
                    // querySelectorAll con selector de atributos sobre cada nodo
                    // añadido — y Discord añade miles al escribir en el chat.
                    scan(node);
                }
            }
        }

        if (touchedProfile) scheduleRetag();
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

export function stopObserver() {
    observer?.disconnect();
    observer = null;
    roots = [];
    if (pendingRetag) clearTimeout(pendingRetag);
    pendingRetag = 0;

    for (const el of document.querySelectorAll(`[${STAMPED}]`)) {
        el.removeAttribute(STAMPED);
        el.removeAttribute(`data-${NS}-user`);
    }
    for (const className of [`${NS}-avatar`, `${NS}-banner`, `${NS}-bio`, `${NS}-bg`, `${NS}-dynamic-bg`]) {
        for (const el of document.querySelectorAll(`.${className}`))
            el.classList.remove(className);
    }
    for (const el of document.querySelectorAll(`.${BORDER_LAYERS_CLASS}`))
        el.remove();
    for (const el of document.querySelectorAll(`.${PROFILE_EDIT_BUTTON_CLASS}`))
        el.remove();
    removeAllWidgets();
}
