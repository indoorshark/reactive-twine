/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

const { merge } = require('webpack-merge');
const path = require('path');
const HtmlWebpackPlugin = require("html-webpack-plugin");
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  // devtool: 'eval-source-map',
  // eval source map will cause error when twine is parsing the script
  // might be solvable? or just use inline-source-map for now
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'),
    },
    compress: true,
    port: 8000,
  },
  plugins: [
    new HtmlWebpackPlugin({
      cache: false,
      template: "template.js",
      inject: false,
    }),
  ],
  optimization: {
    runtimeChunk: 'single',
    splitChunks: {
      cacheGroups: {
        webpack: {
          test: /[\\/]node_modules[\\/]webpack-dev-server[\\/]/,
          name: 'webpack',
          priority: -10,
          chunks: 'all',
        },
        commons: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: -20,
          chunks: 'all',
        },
      },
    },
  },
});
