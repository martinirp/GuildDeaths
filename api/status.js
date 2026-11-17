const { readDeaths, readMeta } = require('../lib/store');

module.exports = (req, res) => {
  const deaths = readDeaths();
  const meta = readMeta();

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify({
      meta,
      sync: { running: false },
      totalDeathsStored: deaths.length,
    })
  );
};
