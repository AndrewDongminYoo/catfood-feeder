import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".remember/**",
    ".trunk/**",
    "node_modules/**",
    "src/types/supabase.d.ts",
  ]),
  {
    // Keep LAST so it wins the settings merge over eslint-config-next.
    settings: {
      react: {
        // Pin the React version so eslint-plugin-react skips auto-detection.
        // detectReactVersion() calls context.getFilename(), removed in ESLint 10.
        version: "19.2",
      },
    },
  },
]);
