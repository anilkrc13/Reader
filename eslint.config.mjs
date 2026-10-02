import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
export default [
  {ignores:['**/node_modules/**','**/dist/**','build/**','src/reader/web/vendor/**']},
  {files:['**/*.{js,mjs,cjs,ts}'], languageOptions:{globals:{...globals.browser,...globals.node,marked:'readonly',DOMPurify:'readonly',hljs:'readonly',mermaid:'readonly',__READER_VERSION__:'readonly'}}, rules:{'no-undef':'error','no-unreachable':'error','no-dupe-args':'error','no-dupe-keys':'error','no-constant-condition':['error',{checkLoops:false}],'no-unused-vars':['error',{args:'none',caughtErrors:'none',varsIgnorePattern:'^_'}]}},
  {files:['**/*.ts'],languageOptions:{parser:tsParser},plugins:{'@typescript-eslint':tsPlugin},rules:{'no-undef':'off','no-unused-vars':'off','@typescript-eslint/no-unused-vars':['error',{args:'none',caughtErrors:'none',varsIgnorePattern:'^_'}]}},
];
