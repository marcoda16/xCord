import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MAX_WIDGET_LINKS, normalizeWidgets, safeHttpsUrl } from "./widgetData.ts";

assert.equal(safeHttpsUrl("https://example.com/path"), "https://example.com/path");
assert.equal(safeHttpsUrl("http://example.com"), null);
assert.equal(safeHttpsUrl("javascript:alert(1)"), null);
assert.equal(safeHttpsUrl("not a url"), null);

const normalized = normalizeWidgets({
    hero: {
        title: "  Proyecto  ",
        url: "https://example.com",
        imageUrl: "javascript:alert(1)",
        description: "  Descripción  "
    },
    links: Array.from({ length: 8 }, (_, index) => ({
        id: `item-${index}`,
        title: `Enlace ${index}`,
        url: `https://example.com/${index}`
    }))
});

assert.ok(normalized);
assert.equal(normalized.hero.title, "Proyecto");
assert.equal(normalized.hero.imageUrl, undefined);
assert.equal(normalized.hero.description, "Descripción");
assert.equal(normalized.links.length, MAX_WIDGET_LINKS);

const imageOnly = normalizeWidgets({
    hero: { imageUrl: "https://example.com/portada.gif", title: "", url: "" },
    links: []
});
assert.ok(imageOnly);
assert.equal(imageOnly.hero.imageUrl, "https://example.com/portada.gif");
assert.equal(imageOnly.hero.title, undefined);
assert.equal(imageOnly.hero.url, undefined);

const invalid = normalizeWidgets({
    hero: { title: "", url: "" },
    links: [{ title: "", description: "Sin título" }]
});
assert.equal(invalid, null);

const cards = normalizeWidgets({ links: [
    { title: " prueba ", description: " Una descripción libre " },
    { title: "prueba2", imageUrl: "https://example.com/icon.png" },
    { title: "Anterior", url: "https://example.com" },
    { title: "Texto", description: "javascript:alert(1)", url: "https://example.com" }
] }).links;
assert.equal(cards.length, 4);
assert.equal(cards[0].title, "prueba");
assert.equal(cards[0].description, "Una descripción libre");
assert.equal(cards[0].url, undefined);
assert.equal(cards[1].description, undefined);
assert.equal(cards[2].description, "https://example.com");
assert.equal(cards[2].url, undefined);
assert.equal(cards[3].description, "javascript:alert(1)");
assert.equal(cards[3].url, undefined);
assert.equal(normalizeWidgets({ links: [{ title: "A", description: "x".repeat(200) }] }).links[0].description.length, 120);

const source = readFileSync(new URL("./widgets.ts", import.meta.url), "utf8");
assert.ok(!source.includes("innerHTML"));
assert.ok(!source.includes("z-index:-2"));
assert.ok(source.includes("widget-has-copy"));
assert.ok(source.includes('anchor.rel = "noopener noreferrer"'));
assert.ok(source.includes("title.textContent"));

console.log("widgets: comprobaciones superadas");
