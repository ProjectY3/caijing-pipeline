const fs = require('node:fs');

function validateDataFile(dataPath) {
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(raw);
    const errors = [];
    if (!data.date) errors.push('missing date field');
    if (!data.stocks || typeof data.stocks !== 'object') errors.push('missing or invalid stocks');
    if (!data.indices || typeof data.indices !== 'object') errors.push('missing or invalid indices');
    if (!data.sectors || typeof data.sectors !== 'object') errors.push('missing or invalid sectors');
    return { ok: errors.length === 0, errors };
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
}

module.exports = { validateDataFile };
