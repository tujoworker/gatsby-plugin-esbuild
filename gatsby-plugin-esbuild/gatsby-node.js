/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: http://www.gatsbyjs.org/docs/node-apis/
 */

const http = require('http')
const { performance } = require('perf_hooks')
const babel = require('@babel/core')
const esbuild = require('esbuild')
const { ESBuildMinifyPlugin } = require('esbuild-loader')

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
    // console.log('babel code_1', code)

    const babelStart = performance.now()

    const result = await babel.transform(code, babelConfig)
    code = result.code

    // console.log('babel code_2', code)

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

function useESBuildLoader({ target }) {
  return {
    loader,
    options: {
      loader: 'tsx',
      target,
      implementation: esbuildImplementation,
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

  if (typeof rule?.use === 'function') {
    const originalUseRule = rule.use

    rule = { ...rule }

    rule.use = (context) => {
      if (
        originalUseRule &&
        options.ignoreFiles &&
        new RegExp(options.ignoreFiles).test(context.resource)
      ) {
        return originalUseRule(context)
      }

      return useESBuildLoader(options)
    }
  } else {
    Object.assign(rule, useESBuildLoader(options))
  }

  return rule
}

/**
 * Update Webpack Config
 *
 */
module.exports.onCreateWebpackConfig = (
  { actions, getConfig, store },
  pluginOptions
) => {
  const config = getConfig()
  const target = pluginOptions?.esbuildOptions?.target || 'es2015'
  const ignoreFiles = pluginOptions?.ignoreFiles || null

  config.module.rules = config.module.rules.map((rule) => {
    if (Array.isArray(rule?.oneOf)) {
      rule.oneOf = rule.oneOf.map((sub) => {
        if (isJsLoader(sub)) {
          sub = replaceBabelLoader(sub, { target, ignoreFiles })
        }

        return sub
      })
    } else if (Array.isArray(rule?.use)) {
      if (isJsLoader(rule)) {
        rule.use = rule.use.map((sub) => {
          return replaceBabelLoader(sub, { target, ignoreFiles })
        })
      }
    } else if (isJsLoader(rule)) {
      rule = replaceBabelLoader(rule, { target, ignoreFiles })
    }

    return rule
  })

  /**
   * If enabled – Babel throws an error message that there is a too large chunk
   * But why Babel?
   */
  if (false && Array.isArray(config?.optimization?.minimizer)) {
    config.optimization.minimizer = config.optimization.minimizer.map(
      (plugin) => {
        if (plugin.constructor.name === 'TerserPlugin') {
          plugin = new ESBuildMinifyPlugin({
            target,
            implementation: esbuildImplementation,
          })
        }

        if (plugin.constructor.name === 'CssMinimizerPlugin') {
          plugin = new ESBuildMinifyPlugin({
            css: true,
            implementation: esbuildImplementation,
          })
        }

        return plugin
      }
    )
  }

  actions.replaceWebpackConfig(config)
}

module.exports.onPreInit = ({ store }) => {
  globalThis.__useJsxRuntime =
    store.getState().config.jsxRuntime === 'automatic'
}
module.exports.onCreateDevServer = ({ store, reporter }) => {
  waitForHost({ store, reporter })
}
module.exports.onPostBuild = ({ store, reporter }) => {
  reportPerf({ reporter })
}

function reportPerf({ reporter }) {
  reporter.info(
    `gatsby-plugin-esbuild: ${Number(perfMetrics.esbuild / 1e3).toFixed(
      3
    )}s and included Babel ${Number(perfMetrics.babel / 1e3).toFixed(3)}s`
  )
}

function waitForHost({ store, reporter }) {
  const state = store.getState()

  const waitForRequest = async () => {
    try {
      await httpAsync({
        hostname: state.program.host,
        port: state.program.p,
        path: '/',
        method: 'GET',
        timeout: 300000,
      })
    } catch (e) {
      reporter.error(e)
    }

    clearInterval(intervalId)

    if (intervalId) {
      reportPerf({ reporter })
    }

    intervalId = null
  }

  let intervalId = setTimeout(() => {
    waitForRequest()
  }, 5e3)
}

async function httpAsync(options) {
  return new Promise((resolve, reject) => {
    const request = http.request(options, (res) => {
      res.on('data', (chunk) => {
        if (chunk) {
          resolve()
        }
      })
      res.on('error', (error) => {
        reject(error)
      })
    })

    request.end()
  })
}
