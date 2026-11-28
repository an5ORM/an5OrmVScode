const fs = require('node:fs');

function linkOrCopy(target, destination, type = 'file') {
  try {
    fs.symlinkSync(target, destination, type);
    return true;
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    if (type === 'file') {
      fs.copyFileSync(target, destination);
      return false;
    }
    fs.cpSync(target, destination, { recursive: true });
    return false;
  }
}

module.exports = { linkOrCopy };
