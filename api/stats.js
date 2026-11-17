const { readDeaths, buildStats } = require('../lib/store');

module.exports = (req, res) => {
  const deaths = readDeaths();
  const stats = buildStats(deaths);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(stats));
};
