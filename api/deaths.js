const { readDeaths, filterDeaths } = require('../lib/store');

module.exports = (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const search = (req.query && req.query.search) || url.searchParams.get('search') || '';
  const vocation = (req.query && req.query.vocation) || url.searchParams.get('vocation') || '';
  const sort = (req.query && req.query.sort) || url.searchParams.get('sort') || 'recent';

  const deaths = readDeaths();
  const filtered = filterDeaths(deaths, { search, vocation, sort });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify({
      total: filtered.length,
      deaths: filtered,
    })
  );
};
