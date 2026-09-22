import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// El plugin usa imports sin extensión; Node necesita resolver sus fuentes TS.
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) specifier += ".ts";
        return nextResolve(specifier, context);
    }
});
const { findWidgetHost, findCompactWidgetHost } = await import("./widgets.ts");
hooks.deregister();

function element(left, width, height, children = [], tabs = false) {
    const node = {
        children, parentElement: null, tabs,
        getBoundingClientRect: () => ({ left, right: left + width, width, height }),
        contains(other) { return this === other || this.children.some(child => child.contains(other)); },
        querySelectorAll() {
            return this.children.flatMap(child => [...(child.tabs ? [child] : []), ...child.querySelectorAll()]);
        }
    };
    children.forEach(child => child.parentElement = node);
    return node;
}

const card = element(0, 400, 700);
const tabs = element(430, 440, 40, [], true);
const right = element(414, 472, 700, [tabs]);
const root = element(0, 900, 700, [card, right]);
assert.equal(findWidgetHost(root, card), right, "elige la columna de las pestañas");
assert.equal(findWidgetHost(card, card), null, "no sale del perfil hacia un ancestro ancho");
assert.equal(findWidgetHost(root, element(0, 400, 700)), null, "rechaza tarjetas de otro perfil");
const popout = element(0, 300, 500, [element(0, 280, 40, [], true)]);
assert.equal(findWidgetHost(popout, popout), null, "no inserta widgets en popouts");
const sidebar = element(0, 320, 700, [element(10, 300, 40, [], true)]);
element(0, 1200, 700, [sidebar, root]);
assert.equal(findWidgetHost(root, card), right, "ignora el panel de edición externo");
const noTabs = element(0, 900, 700, [element(0, 400, 700), element(430, 440, 700)]);
assert.equal(findWidgetHost(noTabs, noTabs.children[0]), null, "no inventa contenedores sin pestañas");
console.log("widgets layout: 6 comprobaciones superadas");

const body = element(0, 280, 400);
const region = element(0, 280, 80);
region.parentElement = body;
body.children.push(region);
const compact = element(0, 300, 500, [body]);
compact.querySelector = selector => selector.includes("tablist") ? null : region;
assert.equal(findCompactWidgetHost(compact, compact), body);
const wide = element(0, 900, 700, [compact]);
wide.querySelector = () => null;
assert.equal(findCompactWidgetHost(wide, compact), null);
compact.querySelector = () => null;
assert.equal(findCompactWidgetHost(compact, compact), null);
compact.querySelector = () => tabs;
assert.equal(findCompactWidgetHost(compact, compact), null);
console.log("widgets compactos: 4 comprobaciones superadas");
