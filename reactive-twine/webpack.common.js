/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

const path = require('path');

module.exports = {
  cache: false,
  entry: {
     'reactive-twine': './src/main.ts',
  },
  output: {
    iife: true,
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    environment: {
      module: true,
      arrowFunction: true,
      const: true,
      destructuring: true,
      document: true,
    }
  },
  optimization: {
    runtimeChunk: 'single',
    splitChunks: false,
  },
  module: {
    rules: [
      {
        test: /\.twee$/,
        use: [ { loader: 'raw-loader' } ],
      },
      {
        test: /\.tsx?$/,
        loader: 'esbuild-loader',
        exclude: /node_modules/,
      }

    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  node: {
    __dirname: true,
  },
};
