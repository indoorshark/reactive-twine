'use strict';

const fs = require('fs');
const path = require('path');

const filepath = path.resolve(__dirname, './build/format.js');

console.log('dir', __dirname, filepath)

module.exports = {
  format: fs.readFileSync(filepath, {
    encoding: 'utf8',
    flag: 'r',
  }),
};

