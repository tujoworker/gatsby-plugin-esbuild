/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: http://www.gatsbyjs.org/docs/node-apis/
 */

const { performance } = require('perf_hooks')
const babel = require('@babel/core')
const esbuild = require('esbuild')
const { ESBuildMinifyPlugin } = require('esbuild-loader')

const excludeRule = /\/src\//
const includeRule = /\/src\/.*\.(js|jsx|tsx)$/
const isDev = process.env.NODE_ENV === 'development'

/**
 * Defines the options schema
 *
 */
module.exports.pluginOptionsSchema = ({ Joi }) => {
  return Joi.object({
    esbuildOptions: Joi.string().optional(),
    ignoreFiles: Joi.string().optional(),
  })
}

const babelConfig = {
  plugins: [
    require.resolve('@babel/plugin-syntax-jsx'),
    require.resolve('@babel/plugin-transform-runtime'),
    require.resolve('babel-plugin-remove-graphql-queries'),
  ],
  sourceMaps: false,
  babelrc: false,
  babelrcRoots: false,
  configFile: false,
}
const loader = require.resolve('esbuild-loader')

const perfMetrics = {
  babel: 0,
  esbuild: 0,
}

async function transform(code, options) {
  if (code.includes('graphql')) {
    babelConfig.filename = options.sourcefile

    const babelStart = performance.now()

    const result = await babel.transform(code, babelConfig)
    code = result.code

    const babelEnd = performance.now()
    perfMetrics.babel += babelEnd - babelStart
  }

  if (globalThis.__useJsxRuntime && !code.includes('from "react"')) {
    code = `import React from "react";` + code
  }

  const esbuildStart = performance.now()

  const result = await esbuild.transform(code, options)

  const esbuildEnd = performance.now()
  perfMetrics.esbuild += esbuildEnd - esbuildStart

  return result
}

const esbuildImplementation = {
  ...esbuild,
  transform,
}

function isJsLoader(rule) {
  return (
    rule.test &&
    (new RegExp(rule.test).test('file.js') ||
      new RegExp(rule.test).test('file.ts') ||
      new RegExp(rule.test).test('file.tsx'))
  )
}

function useESBuildLoader(options) {
  const target = options?.target || (isDev ? 'es2017' : 'es2015')
  return {
    loader,
    options: {
      loader: 'tsx',
      target,
      implementation: esbuildImplementation,
      ...options,
    },
  }
}

/**
 * TODO: Gatsby babel-loader packages/gatsby/src/utils/babel-loader.js
 * has very good caching capabilities. We not use them yet.
 */
function replaceBabelLoader(rule, options) {
  // To bypass the new loader, simply return:
  // return rule;

  const exclude = rule.exclude

  if (typeof rule?.use === 'function') {
    const originalUseRule = rule.use

    rule.use = (context) => {
      if (
        originalUseRule &&
        options.ignoreFiles &&
        new RegExp(options.ignoreFiles).test(context.resource)
      ) {
        return originalUseRule(context)
      }

      return useESBuildLoader(options?.esbuildOptions)
    }
    if (isDev) {
      rule.exclude = (file) => {
        if (file) {
          if (excludeRule.test(file)) {
            return true
          }
          if (typeof exclude === 'function') {
            return exclude(file)
          } else if (exclude) {
            return exclude.test(file)
          }
        }
        return false
      }
    }
  } else {
    Object.assign(rule, useESBuildLoader(options?.esbuildOptions))
  }

  return rule
}

/**
 * Update Webpack Config
 *
 */
module.exports.onCreateWebpackConfig = (
  { actions, getConfig, loaders },
  pluginOptions
) => {
  const webpackConfig = getConfig()
  const target = pluginOptions?.esbuildOptions?.target || 'es2015'

  if (!global.__originalLoader) {
    global.__originalLoader = loaders.js
  }

  if (loaders.js !== globalThis.makeUseESBuildLoader) {
    loaders.js = globalThis.makeUseESBuildLoader =
      function makeUseESBuildLoader() {
        return useESBuildLoader(pluginOptions?.esbuildOptions)
      }
  }

  // Only for the fast refresh we still use the original loader
  if (isDev) {
    webpackConfig.module.rules.push({
      ...global.__originalLoader(),
      test: includeRule,
    })
  }

  webpackConfig.module.rules = webpackConfig.module.rules.map((rule) => {
    if (Array.isArray(rule?.oneOf)) {
      rule.oneOf = rule.oneOf.map((sub) => {
        if (isJsLoader(sub)) {
          sub = replaceBabelLoader(sub, pluginOptions)
        }

        return sub
      })
    } else if (Array.isArray(rule?.use)) {
      if (isJsLoader(rule)) {
        rule.use = rule.use.map((sub) => {
          return replaceBabelLoader(sub, pluginOptions)
        })
      }
    } else if (isJsLoader(rule)) {
      rule = replaceBabelLoader(rule, pluginOptions)
    }

    return rule
  })

  /**
   * If enabled – Babel throws an error message that there is a too large chunk
   * But why Babel?
   */
  if (Array.isArray(webpackConfig?.optimization?.minimizer)) {
    webpackConfig.optimization.minimizer =
      webpackConfig.optimization.minimizer.map((plugin) => {
        if (plugin.constructor.name === 'TerserPlugin') {
          plugin = new ESBuildMinifyPlugin({
            target,
            implementation: esbuild,
          })
        }

        if (plugin.constructor.name === 'CssMinimizerPlugin') {
          plugin = new ESBuildMinifyPlugin({
            css: true,
            implementation: esbuild,
          })
        }

        return plugin
      })
  }

  actions.replaceWebpackConfig(webpackConfig)
}

module.exports.onPreInit = ({ store }) => {
  globalThis.__useJsxRuntime =
    store.getState().config.jsxRuntime === 'automatic'
}

module.exports.onPostBuild = ({ reporter }) => {
  reporter.info(
    `gatsby-plugin-esbuild: ${Number(perfMetrics.esbuild / 100).toFixed(
      3
    )}s with Babel ${Number(perfMetrics.babel / 100).toFixed(3)}s`
  )
}
