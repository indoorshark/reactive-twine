'use strict';

const fs = require('fs');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const path = require('path');

const destination = path.resolve(__dirname, 'build/format.js');

const downloadFile = async () => {
  const res = await fetch(
    'https://raw.githubusercontent.com/tmedwards/sugarcube-2/v2.37.3/dist/format.js'
  );
  const fileStream = fs.createWriteStream(destination, { flags: 'wx' });
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
};

if (!fs.existsSync(destination)) downloadFile();

