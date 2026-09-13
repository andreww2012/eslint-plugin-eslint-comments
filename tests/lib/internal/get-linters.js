"use strict"

const assert = require("assert")
const { spawnSync } = require("child_process")
const fs = require("fs")
const module_ = require("module")
const path = require("path")
const { pathToFileURL } = require("url")
const vm = require("vm")
const { Linter } = require("eslint")
const plugin = require("../../..")
const getLinters = require("../../../lib/internal/get-linters")

const getLintersPath = require.resolve("../../../lib/internal/get-linters")

// Returning the source of a CommonJS module makes Node run it with a `require`
// that has no `cache`, like Yarn PnP does
const LOADER_HOOKS_SOURCE = `
import { readFile } from "node:fs/promises"

export const load = async (url, context, nextLoad) => {
    const result = await nextLoad(url, context)

    return result.format === "commonjs" && result.source == null
        ? { ...result, source: await readFile(new URL(url)) }
        : result
}
`

const loaderHooksUrl = `data:text/javascript,${encodeURIComponent(
    LOADER_HOOKS_SOURCE
)}`
const pluginUrl = pathToFileURL(require.resolve("../../..")).href

const itIfLoaderHooksAreSupported =
    typeof module_.register === "function" ? it : it.skip

const loadGetLintersWithoutRequireCache = () => {
    const compiledWrapper = vm.runInThisContext(
        module_.wrap(fs.readFileSync(getLintersPath, "utf8")),
        { filename: getLintersPath }
    )
    const loadedModule = { exports: {} }
    const requireWithoutCache = module_.createRequire(getLintersPath)

    delete requireWithoutCache.cache

    compiledWrapper.call(
        loadedModule.exports,
        loadedModule.exports,
        requireWithoutCache,
        loadedModule,
        getLintersPath,
        path.dirname(getLintersPath)
    )

    return loadedModule.exports
}

describe("getLinters", () => {
    it("should find the loaded ESLint `Linter` class", () => {
        assert(getLinters().includes(Linter))
    })

    // https://github.com/eslint-community/eslint-plugin-eslint-comments/issues/322
    it("should return no linters when `require.cache` is unavailable", () => {
        assert.deepStrictEqual(loadGetLintersWithoutRequireCache()(), [])
    })

    itIfLoaderHooksAreSupported(
        "should not break importing the plugin through loader hooks providing CommonJS source",
        () => {
            const result = spawnSync(
                process.execPath,
                [
                    "--input-type=module",
                    "--eval",
                    `
                    import { register } from "node:module"

                    register(${JSON.stringify(loaderHooksUrl)})

                    const { default: plugin } = await import(${JSON.stringify(
                        pluginUrl
                    )})

                    console.log(JSON.stringify(Object.keys(plugin.rules)))
                    `,
                ],
                { encoding: "utf8" }
            )

            assert.strictEqual(result.status, 0, result.stderr)
            assert.deepStrictEqual(
                JSON.parse(result.stdout),
                Object.keys(plugin.rules)
            )
        }
    )
})
