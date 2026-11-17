const { readDeaths, readMeta } = require('../lib/store');

module.exports = (req, res) => {
  const deaths = readDeaths();
  const meta = readMeta();

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    meta,
    sync: { running: false },
    totalDeathsStored: deaths.length,
  });
};

