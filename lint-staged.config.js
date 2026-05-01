export default {
  "*.{ts,tsx,js,jsx,mjs,cjs}": ["oxlint --fix"],
  "*": ["oxfmt --write"],
};
