var fivebeans = require('fivebeans');

var host = '192.168.1.50',
    port = 11300,
	tube = 'sometubename';

(function emitter() {
	var client = new fivebeans.client(host, port);
	client
		.on('connect', function()
		{
			console.log('connected');
			client.watch(tube, function(err, numwatched) {
				console.log('watching');
				console.log(err);
				console.log(numwatched);
			});
			main();
			/*
			client.peek(11, function(err, jobid, payload) {
				console.log(err);
				console.log(jobid);
				console.log(payload);
			});
			*/
		})
		.on('error', function(err)
		{
			console.log('error');
			console.log(err);
		})
		.on('close', function()
		{
			console.log('closing');
		})
		.connect();
	
	function main() {
		client.use(tube, function(err, tubename) {
			console.log('using tube: ');
			console.log(tubename);
			console.log(err);

			client.list_tube_used(function(err, tubename) {
				console.log('tube used: ');
				console.log(tubename);
				console.log(err);
			});
			
			client.put(123, 0, 10, JSON.stringify({
					type: 'test_ok', 
					payload: 'ok_payload'
				}), function(err, jobid) {
					console.log('putting job to pass: ');
					console.log(jobid);
					console.log(err);
			});
			
			setTimeout(function() {
				client.put(321, 0, 10, JSON.stringify({type: 'test_fail', payload: 'fail_payload'}), function(err, jobid) {
					console.log('putting job to fail: ');
					console.log(jobid);
					console.log(err);
				});
			}, 5000);
			
			setInterval(function peek() {
				/*
				client.peek_ready(function(err, jobid, payload) {
					if (err === 'NOT_FOUND') {
						return;
					}
					console.log('found ready job ' + jobid + ', destroying');
					client.destroy(jobid, function(err) {
						console.log(err);
					});
				});
				*/
				
				client.peek_buried(function(err, jobid, payload) {
					if (err === 'NOT_FOUND') {
						return;
					}
					console.log('found buried job ' + jobid + ', destroying');
					client.destroy(jobid, function(err) {
						console.log(err);
					});
				});
				//client.destroy(jobid, function(err) {});
			}, 500);
		});
	}
})();
//});

var options =
{
    id: 'test_worker',
    host: host,
    port: port,
    handlers: {
        test_ok: {
			type: 'test_ok',
			work: function(payload, callback) {
				console.log('test_ok, data: ');
				console.log(payload);
				callback('success');
			}
		},
		test_fail: {
			type: 'test_fail',
			work: function(payload, callback) {
				console.log('test_fail, data: ');
				console.log(payload);
				callback('bury');
			}
		}
    },
    ignoreDefault: true
};

var Beanworker = require('fivebeans').worker;
var worker = new Beanworker(options);
worker.start([tube]);
