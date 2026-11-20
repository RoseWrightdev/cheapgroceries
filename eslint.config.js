import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      '.vite/**',
      '.deepspace/**',
      'src/router.ts',
      '**/._*',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/actions/**/*.ts', 'src/lib/**/*.ts', 'src/jobs.ts', 'src/cron.ts'],
    rules: {
      'max-len': ['error', { code: 100, ignoreUrls: true, ignoreRegExpLiterals: true }],
      'max-lines-per-function': ['error', { max: 70, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      curly: ['error', 'all'],
      'no-nested-ternary': 'error',
      complexity: ['error', 15],
    },
  },
  {
    files: ['prerender.ts', 'src/server/action-routes.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]
