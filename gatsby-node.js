/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/node-apis/
 */

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
  presets: [],
  plugins: [
    require.resolve('@babel/plugin-syntax-jsx'),
    require.resolve('@babel/plugin-transform-runtime'),
    require.resolve('babel-plugin-remove-graphql-queries'),
  ],
  babelrc: false,
  babelrcRoots: false,
  configFile: false,
  caller: {
    name: 'remove-graphql-queries',
    supportsStaticESM: true,
  },
}
const loader = require.resolve('esbuild-loader')

const esbuildImplementation = {
  ...esbuild,
  transform: (code, options) => {
    if (code.includes('graphql')) {
      babelConfig.filename = options.sourcefile
      code = babel.transformSync(code, babelConfig).code
    }

    return esbuild.transform(code, options)
  },
}

function isJsLoader(rule) {
  return (
    rule.test &&
    new RegExp(rule.test).test('file.js') &&
    new RegExp(rule.test).test('file.ts') &&
    new RegExp(rule.test).test('file.tsx')
  )
}

function useESBuildLoader(rule, { target }) {
  rule.loader = loader
  rule.options = {
    loader: 'tsx',
    target,
    implementation: esbuildImplementation,
  }

  return rule
}

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
      return useESBuildLoader(rule, options)
    }
  } else {
    rule = useESBuildLoader(rule, options)
  }

  return rule
}

/**
 * Update Webpack Config
 *
 */
module.exports.onCreateWebpackConfig = (
  { actions, getConfig },
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
