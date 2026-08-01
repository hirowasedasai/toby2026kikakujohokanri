import js from '@eslint/js';
import globals from 'globals';

const appsScriptGlobals = {
  Browser: 'readonly',
  console: 'readonly',
  LockService: 'readonly',
  PropertiesService: 'readonly',
  ScriptApp: 'readonly',
  Session: 'readonly',
  SpreadsheetApp: 'readonly',
  Utilities: 'readonly'
};

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      '.clasp*.json',
      'config/*.json'
    ]
  },
  js.configs.recommended,
  {
    files: ['apps-script/**/*.gs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: appsScriptGlobals
    },
    rules: {
      // Apps Script resolves declarations across separate .gs files at runtime.
      'no-undef': 'off',
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node
    }
  }
];
