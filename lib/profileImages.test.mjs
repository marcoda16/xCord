// node lib/profileImages.test.mjs

import assert from "node:assert/strict";
import {
    collectLocalImages,
    imageTag,
    isDataUri,
    parseDataUri,
    withUploadedImages
} from "./profileImages.ts";

let checks = 0;
const ok = (condition, detail) => { assert.ok(condition, detail); checks++; };
const eq = (a, b, detail) => { assert.deepEqual(a, b, detail); checks++; };

const PNG = "iVBORw0KGgo=";
const dataUri = `data:image/png;base64,${PNG}`;

// ── parseDataUri ────────────────────────────────────────────────────────────

eq(parseDataUri(dataUri), { contentType: "image/png", data: PNG });
eq(parseDataUri("https://example.com/a.png"), null, "una URL no es un data URI");
eq(parseDataUri("data:image/png,sin-base64"), null, "solo base64");
eq(parseDataUri("data:image/PNG;base64,QQ=="), { contentType: "image/png", data: "QQ==" }, "mime en minúsculas");
ok(isDataUri(dataUri) && !isDataUri("https://x/y.png") && !isDataUri(undefined));

// ── Recolección ─────────────────────────────────────────────────────────────

const profile = {
    version: 1,
    userId: "750756131785408623",
    avatar: { image: { url: dataUri, fit: "cover" } },
    banner: { image: { url: "https://files.catbox.moe/abc.png" } },
    widgets: {
        hero: { title: "Hola", imageUrl: `data:image/gif;base64,${PNG}` },
        links: [
            { id: "uno", title: "Uno", imageUrl: dataUri },
            { id: "dos", title: "Dos", imageUrl: "https://example.com/i.png" },
            { id: "con/barra", title: "Malo", imageUrl: dataUri }
        ]
    }
};

const collected = collectLocalImages(profile);
eq(collected.ok.map(i => i.kind), ["avatar", "widget-hero", "widget-link-uno"],
    "solo lo local que se puede subir");
eq(collected.ok[0], { kind: "avatar", contentType: "image/png", data: PNG });
eq(collected.unsupported, ["widget-link-con/barra"],
    "un id que no vale como ruta se avisa, no se descarta en silencio");

const bmp = collectLocalImages({ ...profile, avatar: { image: { url: "data:image/bmp;base64,QQ==" } } });
eq(bmp.unsupported, ["avatar", "widget-link-con/barra"],
    "un formato que el bucket no acepta se detecta antes de publicar");
ok(!bmp.ok.some(i => i.kind === "avatar"));

// ── Sustitución ─────────────────────────────────────────────────────────────

const urls = {
    avatar: "https://s/avatar?v=1",
    "widget-hero": "https://s/hero?v=2",
    "widget-link-uno": "https://s/uno?v=3"
};
// El perfil publicable es el mismo sin la tarjeta de id inválido.
const publishable = structuredClone(profile);
publishable.widgets.links = publishable.widgets.links.filter(l => l.id !== "con/barra");

const remote = withUploadedImages(publishable, urls);

ok(remote !== null);
eq(remote.avatar.image.url, urls.avatar);
eq(remote.avatar.image.fit, "cover", "el resto del ImageSource se conserva");
eq(remote.banner.image.url, "https://files.catbox.moe/abc.png", "lo que ya era URL no se toca");
eq(remote.widgets.hero.imageUrl, urls["widget-hero"]);
eq(remote.widgets.links[0].imageUrl, urls["widget-link-uno"]);
eq(remote.widgets.links[1].imageUrl, "https://example.com/i.png");

// Ni un solo data: URI puede quedar en lo que viaja al servidor.
ok(!JSON.stringify(remote).includes("data:"), "a Postgres no llega base64");
eq(profile.avatar.image.url, dataUri, "el perfil local conserva su imagen para la vista previa");

// Si falta una URL se aborta entero, en vez de publicar base64 a medias.
eq(withUploadedImages(publishable, { avatar: urls.avatar }), null, "sin todas las URL no se publica");
eq(withUploadedImages(profile, urls), null, "un id no subible también aborta la publicación");
eq(withUploadedImages({ version: 1, userId: "1" }, {})?.userId, "1", "un perfil sin imágenes pasa igual");

// ── Huella ──────────────────────────────────────────────────────────────────

const tag = await imageTag(PNG);
ok(/^[0-9a-f]{8}$/.test(tag), `la huella son 8 hex: ${tag}`);
eq(await imageTag(PNG), tag, "misma imagen, misma huella — permite saltarse la subida");
ok(await imageTag("QQ==") !== tag, "imágenes distintas, huellas distintas");

console.log(`profileImages: ${checks} comprobaciones superadas`);
