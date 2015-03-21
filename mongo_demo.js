;
var db = require('mongoskin').db('mongodb://localhost:27017/exchange_rates');

var data = {
    "from": "HKD",
    "to": "USD",
    "created_at": new Date(),
    "rate": "0.13"
};
db.collection('rates').insert(data, function(err, result) {
    if (err) throw err;
    if (result) console.log('Added!');
});

setTimeout(function(){
	db.collection('rates').find().toArray(function(err, result) {
		if (err) throw err;
		console.log(result);
})}, 1000);
