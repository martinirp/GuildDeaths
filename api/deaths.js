const { readDeaths, filterDeaths } = require('../lib/store');

module.exports = (req, res) => {
  const { search = '', vocation = '', sort = 'recent' } = req.query || {};
  const deaths = readDeaths();
  const filtered = filterDeaths(deaths, { search, vocation, sort });

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    total: filtered.length,
    deaths: filtered,
  });
};

