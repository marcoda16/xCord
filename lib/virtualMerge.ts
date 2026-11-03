/*!
 * virtual-merge
 * Copyright (c) 2023 Vendicated
 * SPDX-License-Identifier: MIT
 *
 * Copia del paquete `virtual-merge` 1.0.2, con un único cambio: `ownKeys` ya
 * no devuelve claves repetidas (ver abajo).
 *
 * xcord lo importaba sin declararlo: funcionaba porque Vencord lo traía entre
 * sus dependencias. En la v1.15.15 Vencord dejó de usarlo y lo quitó, y desde
 * entonces xcord no compilaba. Tenerlo aquí elimina esa dependencia invisible.
 */

/**
 * Une varios objetos en una vista, sin copiarlos. Ante una misma propiedad
 * gana el último que la tenga. Los getters se ejecutan contra la vista, así
 * que los métodos del objeto original de Discord siguen funcionando sobre ella.
 */
export default function virtualMerge<T extends object>(...objects: object[]): T {
    const fallback = {};

    function findObjectByProp(prop: PropertyKey): object {
        for (let i = objects.length - 1; i >= 0; i--) {
            if (prop in objects[i]) return objects[i];
        }
        return fallback;
    }

    const handler: ProxyHandler<object> = {
        // El original concatenaba las claves de todos los objetos. Si dos
        // compartían una —y xcord fusiona justo objetos que se solapan, como
        // el perfil y sus `overrides`, que llevan `banner` los dos—, enumerar
        // la vista con `Object.keys` o un spread lanzaba "trap returned
        // duplicate entries". El Set lo evita sin alterar nada más.
        ownKeys() {
            const keys = new Set<string | symbol>(Reflect.ownKeys(fallback));
            for (const obj of objects)
                for (const key of Reflect.ownKeys(obj)) keys.add(key);
            return [...keys];
        }
    };

    for (const method of ["defineProperty", "deleteProperty", "get", "getOwnPropertyDescriptor", "has", "set"] as const) {
        (handler as any)[method] = function (_: object, ...args: any[]) {
            return (Reflect as any)[method](findObjectByProp(args[0]), ...args);
        };
    }

    return new Proxy(fallback, handler) as T;
}
