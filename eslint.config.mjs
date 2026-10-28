/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ESLint is only used to REPORT problems. Never run it with --fix: the header rule would rewrite
// the original headers and credits of plugins adapted from other projects. There is no lint:fix script on purpose.

import stylistic from "@stylistic/eslint-plugin";
import simpleHeader from "eslint-plugin-simple-header";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

export default [
    { ignores: ["dist/**", "node_modules/**", "docs/**", "probe/**"] },

    ...tseslint.configs.recommended,

    {
        files: ["**/*.{ts,tsx,mjs}"],
        plugins: {
            "@stylistic": stylistic,
            "simple-header": simpleHeader,
            "simple-import-sort": simpleImportSort,
            "unused-imports": unusedImports
        },
        rules: {
            // Header of our own files. Adapted plugins keep their original header (see the override below).
            "simple-header/header": ["error", {
                text: [
                    "Amiricord, a Discord client mod",
                    "Copyright (c) {year} szlcx404 and Neversleeper",
                    "SPDX-License-Identifier: GPL-3.0-or-later"
                ]
            }],

            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
            "unused-imports/no-unused-imports": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

            // Dynamic code must be a conscious, declared exception (see design 01, permissions.code.dynamic).
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",

            "eqeqeq": ["error", "always"],
            "no-var": "error",
            "prefer-const": "error",

            "@stylistic/indent": ["error", 4, { SwitchCase: 1 }],
            "@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/comma-dangle": ["error", "never"],
            "@stylistic/arrow-parens": ["error", "as-needed"],
            "@stylistic/object-curly-spacing": ["error", "always"],
            "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
            "@stylistic/member-delimiter-style": ["error", {
                multiline: { delimiter: "semi", requireLast: true },
                singleline: { delimiter: "semi", requireLast: true }
            }],
            "@stylistic/eol-last": "error",
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0, maxBOF: 0 }],
            "@stylistic/space-infix-ops": "error",
            "@stylistic/keyword-spacing": "error",
            "@stylistic/comma-spacing": "error",
            "@stylistic/space-before-blocks": "error",
            "@stylistic/key-spacing": "error"
        }
    },

    {
        // Plugins adapted from other projects keep their original header and credits untouched.
        files: ["src/vencordplugins/**", "src/equicordplugins/**", "src/testcordplugins/**", "src/betterdiscordplugins/**"],
        rules: { "simple-header/header": "off" }
    }
];
