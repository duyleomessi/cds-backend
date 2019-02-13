const Datastore = require('nedb'),
      db = {};

db.teams = new Datastore({ filename: './data/teams.db', autoload: true });
db.rounds = new Datastore({ filename: './data/rounds.db', autoload: true });
db.semiFinalRounds = new Datastore({ filename: './data/semiFinalRounds.db', autoload: true });



db.getAllTeams = (cb) => {
  db.teams.find({}).sort({ id: 1 }).exec(cb);
};

db.getAllRounds = (cb) => {
  db.rounds.find({}).sort({ id: 1 }).exec(cb);
};

db.getAllSemiFinalRounds = (cb) => {
  db.semiFinalRounds.find({}).sort({ id: 1 }).exec(cb);
};

module.exports = db;
