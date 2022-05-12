# Gatsby Plugin for using ES-Build

This Gatsby Plugin replaces the Webpack `babel-loader` with `esbuild-loader`.

And there are almost too many thread offs:

- Babel is not supported anymore
- It can make the build process faster, but it may not
- Ideally – Babel and Webpack would rather use some low lever languages to make their AST parser faster. But that will not happen

💥 **So, do not use it in production.** 💥

It is experimental and not really mean to be used in production.

Know issues:

- [Emotion](https://emotion.sh) does not work properly.
- React v17+ jsx transform (Gatsby config: `jsxRuntime: 'automatic'`) does not work properly.

## How it works

It simply uses `esbuild-loader` and removes all GraphQL Queries.

## How to install and use

```bash
yarn add -D gatsby-plugin-esbuild
```

```js
// gatsby-config
module.exports = {
  plugins: ['gatsby-plugin-esbuild'],
}
```
