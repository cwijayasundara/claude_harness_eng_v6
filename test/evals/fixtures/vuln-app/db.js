const { db } = require('./connection');

// Seeded vulnerability: user input is concatenated straight into SQL.
function getUserById(userId) {
  const query = "SELECT * FROM users WHERE id = '" + userId + "'";
  return db.query(query);
}

module.exports = { getUserById };
