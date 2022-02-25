const babyjubjub = require('../../dist/utils/babyjubjub')

const { error } = console;

function fuzz(buf) {
  try {
    babyjubjub.unpackPoint(buf);
    babyjubjub.packPoint([buf, buf]);
  } catch (e) {
    if (
      e.message.indexOf('Invalid') !== -1
      // eslint-disable-next-line no-empty
    ) { }
    else {
      error(buf.toString('hex'));
      throw e;
    }
  }
}

module.exports = {
  fuzz,
}
