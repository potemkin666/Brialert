import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "data/albertalert.sqlite", "live-alerts.json"],
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        L: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
    },
  },
];
