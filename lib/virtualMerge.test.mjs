// node lib/virtualMerge.test.mjs

import assert from "node:assert/strict";
import virtualMerge from "./virtualMerge.ts";

let checks = 0;
const ok = (c, d) => { assert.ok(c, d); checks++; };

class User {
    constructor() { this.id = "1"; this.name = "Ana"; }
    greet() { return `hola ${this.name}`; }
}

const user = new User();
const merged = virtualMerge(user, { name: "Bea", extra: 42 });

ok(merged.name === "Bea", "gana el último objeto");
ok(merged.id === "1", "conserva lo que solo tiene el primero");
ok(merged.extra === 42, "añade lo que solo tiene el segundo");
ok(merged.greet() === "hola Bea", "los métodos se ejecutan contra la vista");
ok(user.name === "Ana", "el original no se toca");
ok("extra" in merged && "id" in merged, "`in` ve las propiedades de todos");

// El fallo del paquete original: claves compartidas rompían la enumeración.
const keys = Object.keys(merged).sort();
ok(JSON.stringify(keys) === JSON.stringify(["extra", "id", "name"]), `claves sin duplicar: ${keys}`);
ok(JSON.stringify({ ...merged }) === JSON.stringify({ id: "1", name: "Bea", extra: 42 }), "el spread funciona");

// Mismo caso que en index.tsx: perfil y overrides comparten `banner`.
const perfil = virtualMerge({ banner: "a", bio: "x" }, { banner: "b" });
ok(Object.keys(perfil).length === 2, "perfil + overrides se puede enumerar");

console.log(`virtualMerge: ${checks} comprobaciones superadas`);
