// Minimal market data schema validator
// Validates daily JSON structure has required fields

function validateDailyMarketData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('market data must be an object');
  }
  if (!data.date) {
    throw new Error('market data missing date field');
  }
  if (!data.market && !data.indices) {
    throw new Error('market data missing market or indices');
  }
}

module.exports = { validateDailyMarketData };
