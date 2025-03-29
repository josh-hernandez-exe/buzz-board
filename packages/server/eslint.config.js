import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import neverthrow from "eslint-plugin-neverthrow";
import tseslintParser from "@typescript-eslint/parser";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      neverthrow.config.recommended,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      neverthrow,
    },
    rules: {
      "neverthrow/must-use-result": "error",
    },
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
  }
);
