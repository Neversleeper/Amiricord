/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { JSX_BUILD_OPTIONS } from "../scripts/build/jsxOptions";
import type { ReactLike } from "../src/api/common";
import { Fragment, jsx, jsxs, setReactSource } from "../src/api/jsxRuntime";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

interface Made { type: unknown; props: Record<string, unknown>; children: unknown[]; }

const react: ReactLike = {
    createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies Made),
    Fragment: Symbol("react.fragment"),
    useState: initial => [typeof initial === "function" ? (initial as () => never)() : initial, () => undefined],
    useEffect: () => undefined,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
};

describe("the JSX runtime", () => {
    it("makes elements with the React it was given, passing children as arguments", () => {
        setReactSource(() => react);
        const one = jsx("div", { className: "a", children: "hi" }) as Made;
        assert.deepEqual(one, { type: "div", props: { className: "a" }, children: ["hi"] });
        const none = jsx("hr", { id: "x" }) as Made;
        assert.deepEqual(none.children, []);
        assert.deepEqual((jsx("p", null) as Made).props, {});
    });

    it("spreads children written one by one (jsxs) but keeps a single list child as one argument (jsx)", () => {
        setReactSource(() => react);
        const list = ["a", "b"];
        assert.deepEqual((jsxs("ul", { children: list }) as Made).children, ["a", "b"]);
        assert.deepEqual((jsx("ul", { children: list }) as Made).children, [list]);
    });

    it("passes the key as a prop and swaps the fragment marker for React's own fragment", () => {
        setReactSource(() => react);
        assert.deepEqual((jsx("li", { children: "x" }, "k1") as Made).props, { key: "k1" });
        assert.equal((jsxs(Fragment, { children: ["a", "b"] }) as Made).type, react.Fragment);
    });

    it("asks for React when drawing, so it may be found after the plugin loaded, and says so clearly when it is missing", () => {
        const holder: { current?: ReactLike; } = {};
        setReactSource(() => holder.current);
        assert.throws(() => jsx("div", {}), /React was not found yet/);
        holder.current = react;
        assert.equal((jsx("div", {}) as Made).type, "div");
        setReactSource(undefined);
        assert.throws(() => jsx("div", {}), /React was not found yet/);
    });
});

describe("JSX in a plugin file, compiled with the build's own settings", () => {
    it("turns <Component/> and fragments into calls of the runtime, through the import source of the project", async () => {
        const result = await build({
            ...JSX_BUILD_OPTIONS,
            stdin: {
                contents: [
                    "import { setReactSource } from \"@amiricord/jsx/jsx-runtime\";",
                    "export { setReactSource };",
                    "const Card = (p: { title: string; children?: unknown; }) => <section title={p.title}>{p.children}</section>;",
                    "export const screen = () => <><Card title=\"t\"><b>one</b><i>two</i></Card>{[1, 2].map(n => <span key={n}>{n}</span>)}</>;"
                ].join("\n"),
                loader: "tsx",
                resolveDir: projectRoot,
                sourcefile: "plugin.tsx"
            },
            bundle: true,
            write: false,
            format: "cjs",
            platform: "node",
            logLevel: "silent",
            absWorkingDir: projectRoot
        });
        const module = { exports: {} as { setReactSource(g: () => ReactLike): void; screen(): unknown; } };
        // eslint-disable-next-line no-new-func -- runs the code just compiled from the test's own source text
        new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
        module.exports.setReactSource(() => react);
        const tree = module.exports.screen() as Made;
        assert.equal(tree.type, react.Fragment);
        const [card, list] = tree.children as [Made, Made[]];
        assert.equal(typeof card.type, "function");
        assert.equal(card.props.title, "t");
        assert.equal(card.children.length, 2);
        assert.equal((card.children[0] as Made).type, "b");
        assert.equal(list.length, 2);
        assert.equal(list[0].props.key, 1);
    });
});
