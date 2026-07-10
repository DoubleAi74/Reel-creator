import js from "@eslint/js";
import react from "eslint-plugin-react";
import globals from "globals";

export default [
  {
    ignores: [".next/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
    },
    rules: {
      "react/jsx-uses-vars": "error",
    },
  },
];
