const { readDeaths, buildStats } = require('../lib/store');

module.exports = (req, res) => {
  const deaths = readDeaths();
  const stats = buildStats(deaths);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(stats);
};

