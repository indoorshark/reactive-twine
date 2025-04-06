/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

const { merge } = require('webpack-merge');
const HtmlWebpackPlugin = require("html-webpack-plugin");
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'production',
  // devtool: 'source-map',
  plugins: [
    new HtmlWebpackPlugin({
      cache: false,
      template: "template.js",
      inject: false,
      minify: {
        collapseWhitespace: false,
      },
    }),
  ],
  optimization: {
    minimize: false,
    splitChunks: false,
    runtimeChunk: false,
  },
});
