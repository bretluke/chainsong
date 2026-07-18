const { clearAuthCookies } = require('../lib/cookies');

module.exports = function handler(req, res) {
  clearAuthCookies(res);
  res.status(200).json({ ok: true });
};
