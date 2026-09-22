// node lib/updates.test.mjs

import assert from "node:assert/strict";
import {
    CHECK_INTERVAL_MS,
    compareVersions,
    isNewer,
    parseManifest,
    parseVersion,
    shouldCheck,
    shouldNotify,
    XCORD_VERSION
} from "./updates.ts";

let checks = 0;
const ok = (c, d) => { assert.ok(c, d); checks++; };
const eq = (a, b, d) => { assert.deepEqual(a, b, d); checks++; };

// ── Versiones ───────────────────────────────────────────────────────────────

eq(parseVersion("1.2.3"), [1, 2, 3]);
eq(parseVersion("v1.2.3"), [1, 2, 3], "tolera el prefijo v");
eq(parseVersion("1.2.3-beta.1"), [1, 2, 3], "el sufijo no cuenta para el número");
eq(parseVersion("1.2"), [1, 2], "acepta menos componentes");
eq(parseVersion("no-es-una-version"), null);
eq(parseVersion(""), null);
eq(parseVersion(null), null);
eq(parseVersion(1.2), null, "solo cadenas");

// Lo que motiva comparar numéricamente: como texto, "1.10.0" < "1.9.0".
ok("1.10.0" < "1.9.0", "comparado como texto, 1.10.0 parece menor");
ok(isNewer("1.10.0", "1.9.0"), "comparado por componentes, es mayor");

eq(compareVersions("1.0.0", "1.0.0"), 0);
eq(compareVersions("2.0.0", "1.9.9"), 1);
eq(compareVersions("1.0.1", "1.0.0"), 1);
eq(compareVersions("1.0", "1.0.0"), 0, "los componentes que faltan valen cero");
eq(compareVersions("1.1", "1.0.9"), 1);
eq(compareVersions("1.2.0-beta", "1.2.0"), -1, "una prerelease va antes que la final");
eq(compareVersions("1.2.0", "1.2.0-beta"), 1);
eq(compareVersions("basura", "1.0.0"), 0, "ante algo ilegible, no opinamos");

ok(!isNewer(XCORD_VERSION, XCORD_VERSION), "la instalada nunca es más nueva que sí misma");

// ── Manifiesto ──────────────────────────────────────────────────────────────

const valido = {
    latest: "1.1.0",
    title: "Nueva versión de xcord",
    message: "Ahora las imágenes locales se publican correctamente.",
    downloadUrl: "https://github.com/marcoda16/xCord/releases/latest"
};

const m = parseManifest(valido);
ok(m !== null);
eq(m.latest, "1.1.0");
eq(m.notes, [], "sin viñetas es válido");

eq(parseManifest({ ...valido, latest: "mañana" }), null, "versión ilegible");
eq(parseManifest({ ...valido, downloadUrl: "http://github.com/x" }), null, "http no");
eq(parseManifest({ ...valido, downloadUrl: "javascript:alert(1)" }), null);
eq(parseManifest({ ...valido, downloadUrl: "https://evil.example/x" }), null,
    "un host fuera de la lista no puede secuestrar el botón");
eq(parseManifest({ ...valido, downloadUrl: "https://github.com.evil.example/x" }), null,
    "ni parecerse al host permitido");
eq(parseManifest(null), null);
eq(parseManifest("texto"), null);
eq(parseManifest({}), null);

// Los textos vienen de un archivo remoto: se recortan, no se confía en ellos.
const largo = parseManifest({ ...valido, title: "T".repeat(500), message: "M".repeat(900) });
ok(largo.title.length <= 80 && largo.message.length <= 300, "títulos y mensajes acotados");

const muchasNotas = parseManifest({ ...valido, notes: Array(50).fill("nota"), });
ok(muchasNotas.notes.length <= 6, "la lista de viñetas tiene tope");
eq(parseManifest({ ...valido, notes: "no es lista" }).notes, []);
eq(parseManifest({ ...valido, notes: ["a", "", "  ", "b"] }).notes, ["a", "b"], "sin viñetas vacías");
eq(parseManifest({ ...valido, title: "" }).title, "Nueva versión de xcord", "título por defecto");

// ── Cuándo consultar ────────────────────────────────────────────────────────

const ahora = 1_700_000_000_000;
ok(shouldCheck(undefined, ahora), "sin marca previa, se consulta");
ok(shouldCheck(0, ahora));
ok(shouldCheck("basura", ahora));
ok(!shouldCheck(ahora - 1000, ahora), "hace un segundo, no");
ok(!shouldCheck(ahora - CHECK_INTERVAL_MS + 1000, ahora), "aún no han pasado 24 h");
ok(shouldCheck(ahora - CHECK_INTERVAL_MS, ahora), "justo a las 24 h, sí");
ok(shouldCheck(ahora + 999999, ahora), "una marca en el futuro no bloquea para siempre");

// ── Cuándo avisar ───────────────────────────────────────────────────────────

ok(shouldNotify(m, "1.0.0", undefined), "hay versión nueva y nada descartado");
ok(!shouldNotify(m, "1.1.0", undefined), "misma versión, no se avisa");
ok(!shouldNotify(m, "1.2.0", undefined), "instalada más nueva que la publicada");
ok(!shouldNotify(m, "1.0.0", "1.1.0"), "ya se descartó justo esta");
ok(shouldNotify(m, "1.0.0", "1.0.5"), "se descartó una anterior: vuelve a avisar");
ok(shouldNotify(m, "1.0.0", ""), "un descarte vacío no cuenta — es el valor inicial del ajuste");
ok(shouldNotify(m, "1.0.0", "basura"), "un descarte ilegible tampoco");
ok(!shouldNotify(m, "1.0.0", "2.0.0"), "descartada una posterior, no insistimos");

console.log(`updates: ${checks} comprobaciones superadas`);
