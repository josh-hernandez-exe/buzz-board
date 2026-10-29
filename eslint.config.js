import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";
import neverthrow from "eslint-plugin-neverthrow";

export default tseslint.config(
  {
    ignores: [
      ".next",
      "src/app/_components/ui/**/*.tsx", // This is external code
      "node_modules/", // Exclude the node_modules folder
      "dist/", // Exclude the dist folder
      "build/", // Exclude the build folder
      "next-env.d.ts",
      "playwright-report/",
      "test-results/",
      "scripts/k6/dist/",
    ],
  },
  ...nextCoreWebVitals,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    plugins: {
      neverthrow,
    },
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // `import { type X } from "m"` still loads "m"; in a client file that
      // pulls server modules into the browser bundle. Use `import type`.
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      // TODO: Turn this back on later
      // "neverthrow/must-use-result": "error",
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
