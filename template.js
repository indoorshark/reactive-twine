/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

const fs = require('fs');
const sugarcubeFormat = require("sugarcube-storyformat").format;
const { parseStoryFormat, compileTwine2HTML, parseTwee, Passage } = require(
  'extwee'
);

let patchedSugarcubeFormat = sugarcubeFormat;
if (process.env.NODE_ENV === 'development') {
  patchedSugarcubeFormat = patchedSugarcubeFormat
    .replace(
      // we also want to hide the debugview by default,
      '_hasSession()||DebugView.enable()',
      '1/*_hasSession()||DebugView.enable()*/'
    )
    // .replace(
    //   // sugarcube automatically focus on load, which isn't desirable
    //   // for stackblitz editing side by side
    //   'jQuery(document.documentElement).focus()',
    //   '1/*jQuery(document.documentElement).focus()*/'
    // )
}

const sugarCubeHtml = JSON.parse(patchedSugarcubeFormat.slice(
  patchedSugarcubeFormat.indexOf('{'),
  patchedSugarcubeFormat.lastIndexOf('}') + 1
)).source;
const sugarCubeHtmlPieces = sugarCubeHtml.split(
  /(?<name>{{STORY_NAME}})|(?<data>{{STORY_DATA}})/gm
);
function compileSugarCubeHtml(story) {
  const name = story.name;
  let storyData = story.toTwine2HTML();
  if (process.env.NODE_ENV === 'development') {
    storyData = storyData.replace(
      // we would want to enable debug view, but extwee don't allow
      // us to set storydata options,
      // good old string replacement it is then...
      'options hidden>\n',
      'options="debug" hidden>\n'
    );
  }
  return (
    sugarCubeHtmlPieces
      .map(content => content === "{{STORY_NAME}}" ? name : content)
      .map(content => content === "{{STORY_DATA}}" ? storyData : content)
      .join('')
  );
}

const license = fs.readFileSync(
  'ALL-LICENSES',
  { encoding: "utf8", flag: "r" }
);

module.exports = function (templateParams) {
  const passagesString = require('./src/main.twee').default;
  const story = parseTwee(passagesString);

  const libAsset = templateParams.compilation.getAsset('reactive-twine.js');

  const libPassage = new Passage(
    'ReactiveTwine-library',
    // `<<script>>` + license + convertSourceToString(libAsset.source.source()) + `<</script>>`,
    `<<script>>` + convertSourceToString(libAsset.source.source()) + `<</script>>`,
    // iifeImportScriptTemplate(['reactive-twine.js']),
    ['init']
  );
  story.addPassage(libPassage);

  const tags = (
    templateParams.htmlWebpackPlugin
      .tags
      .headTags
      .filter(tag =>
        !(tag.tagName === "script"
          && tag.attributes.src === 'reactive-twine.js'
        )
      )
      .join('')
  );

  // if (process.env.NODE_ENV === 'development') {
    return compileSugarCubeHtml(story).replace('</title>', '</title>' + tags);
  // } else {
  //   return compileSugarCubeHtml(story);
  // }
};

const convertSourceToString = (source) => {
  if (typeof source === 'string') {
    return source;
  } else {
    return new TextDecoder().decode(source);
  }
};

// function iifeImportScriptTemplate(urls) {
//   const joinedUrls = urls.map(str => `'${str}'`).join(',');
//   return (
//     `<<script>>!(` +
//       `function (lockId){` +
//         `importScripts(` +
//           joinedUrls +
//         `).then(` +
//           `() => { /*LoadScreen.unlock(lockId)*/ }` +
//         `)` +
//       `}(LoadScreen.lock())` +
//     `)<</script>>`
//   );
// }
