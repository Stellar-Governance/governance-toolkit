import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist', 'node_modules', 'coverage', 'src/contract']),
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.config.js', 'scripts/*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
);
