;
'use strict';
var bean_port = 11300,
    bean_host = 'localhost',
    mongo_conn_str = 'mongodb://localhost:27017/exchange_rates';

process.argv.slice(2).forEach(function (val) {
    if (val === '-h' || val === '--help') {
        console.log('usage: ');
        console.log('-h, --help - print this message');
        console.log('--mongo=<connection string> - mongo connection string, default value - mongodb://localhost:27017/exchange_rates, ' +
        'format: mongodb://[<login>@<password>]<host>:<port>/<database>');
        console.log('--beanstalkd=<host>:<port> - beanstalkd address, default value - localhost:11300');
        process.exit();
    }
    if (/^--mongo=/.test(val)) {
        mongo_conn_str = val.replace('--mongo=', '');
        console.log('mongo connection string: ' + mongo_conn_str);
        return;
    }
    if (/^--beanstalkd=/.test(val)) {
        val = val.replace('--beanstalkd=', '').split(':');
        bean_host = val[0];
        bean_port = parseInt(val[1], 10);
        console.log('beanstalkd host ' + val[0] + ', port ' + val[1]);
        return;
    }
    console.log('unparsed parameter: ' + val + ', use -h for help');
    process.exit();
});

(function(bean_port, bean_host, mongo_conn_str) {
	var host = bean_host,
		port = bean_port,
		tube = 'sometubename',
	    fivebeans = require('fivebeans'),
	    Beanworker = fivebeans.worker,
		http = require('http'),
        jsdom = require('jsdom'),
		mongoskin = require('mongoskin');

	//--------  EMITTER  --------
	
	var client = new fivebeans.client(host, port),
	    succeeded = 0,
		failed = 0,
		pending_jobs = [],
		pushing_interval,
		checking_interval;

	client
		.on('connect', function() {
			console.log('connected');
			client.use(tube, function(err, tubename) {
				if (err) {
					console.log('failed to connect to tube');
					console.log(err);
				} else {
					start();
				}
			});
		})
		.on('error', function(err)
		{
			console.log('error: ');
			console.log(err);
		})
		.on('close', function()
		{
			console.log('closing');
		})
		.connect();	

	function start() {
        start_emitting();
        client.watch(tube, function() {
            checking_interval = setInterval(check_buried, 100);
        });
	}

    function start_emitting() {
        pushing_interval = setInterval(emit, 1000 * 60);
        emit();
    }
	
	function terminate() {
		if (client) {
			try {
				client.stop();
			} catch (e) {}
			client = null;
		}
        if (worker) {
            worker.stop();
        }
        process.exit();
	}
	
	function emit() {
		var payload = {
				type: 'conversion_rate', 
				payload: ['USD', 'HKD']};
		client.put(1, 0, 10, JSON.stringify(payload), on_putting);
	}
	
	function on_putting(err, jobid) {
		if (err) {
			console.log('failed to put job to query');
			console.log(err);
		} else {
            console.log('created job ' + jobid);
			pending_jobs.push(jobid);
		}
	}
	
    function check_buried() {
        var i,
            job_id;
        client.peek_buried(function(err, jobid, payload) {
            if (err === 'NOT_FOUND') {
                return;
            }
            client.destroy(jobid, function(err) {
                on_buried_destroy(err, jobid);
            });
        });
        for (i = pending_jobs.length; i--; ) {
            job_id = pending_jobs[i];
            //client.watch(tube, function() {});
            client.peek(job_id, function(err) {
                peeking(err, job_id);
            });
        }
    }
	
	function peeking(err, jobid) {
		var index;
		if (err === 'NOT_FOUND') {
			index = pending_jobs.indexOf(jobid);
			if (index > -1) {
				pending_jobs.splice(index, 1);
			}

			succeeded += 1;
			if (succeeded >= 10) {
				console.log('found 10 successfull tasks, terminating');
				terminate();
			}
		}
	}
	
	function on_buried_destroy(err, job_id) {
		var index;
		if (err) {
			console.log('failed to destroy buried job');
			console.log(err);
			return;
		} else {
            console.log('destroyed job ' + job_id);
        }
		
		index = pending_jobs.indexOf(job_id);
		if (index > -1) {
			pending_jobs.splice(index, 1);
		} else {
            console.log('it seems we destroyed a job we did not create');
            return;
        }
		
		failed += 1;
		if (failed >= 3) {
			console.log('found 3 failed jobs, terminating');
			terminate();
		} else {
			clearInterval(pushing_interval);
			setTimeout(function() {
				// check if interval is already destroyed
				if (pushing_interval) {
                    start_emitting();
				}
			}, 3000);
		}
	}
	
	//--------  CONSUMER  --------
	
	function Scraper(payload, callback) {
		this.from_curr = payload[0];
		this.to_curr = payload[1];
		this.callback = callback;
		return this;
	}
	
	Scraper.prototype.scrape = function scrape() {
        var _this = this,
		    options = {
			host: 'www.xe.com',
			path: '/currencyconverter/convert/?Amount=1&From=' + this.from_curr + '&To=' + this.to_curr
		};
		// ex: http://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=GBP

		http.request(options, function(response) {
            _this.fetch_response(response);
		}).end();
	};
	
	Scraper.prototype.fetch_response = function fetch_response(response) {
		var _this = this,
            str = '';

		response.on('data', function (chunk) {
			str += chunk;
		});
		response.on('end', function () {
			_this.handle_response(str);
		});
	};
	
	Scraper.prototype.handle_response = function handle_response(response) {
		var _this = this,
			td,
			rate,
			data;

        jsdom.env(response, function (errors, window) {
            if (errors) {
                console.log('failed to parse page');
                _this.callback('bury');
                return;
            }
            td = window.document.querySelectorAll('.uccRes > .rightCol');
            if (td.length !== 1) {
                console.log("didn't find td, burying");
                _this.callback('bury');
                return;
            }
            rate = td[0].innerHTML;
            rate = /\d+\.\d+/.exec(rate);
            if (!rate || rate.length > 1) {
                console.log('failed to find rate in td, burying');
                _this.callback('bury');
                return;
            }
            rate = parseFloat(rate[0]).toFixed(2);

            data = {
                "from": _this.from_curr,
                "to": _this.to_curr,
                "created_at": new Date(),
                "rate": rate
            };
            db.collection('rates').insert(data, function(err, result) {
                if (err) {
                    console.log('failed to put to DB');
                    console.log(err);
                    _this.callback('bury');
                }
                console.log('saved rate ' + _this.from_curr + ' -> ' + _this.to_curr);
                _this.callback('success');
            });

            window.close();
        });
	};
	
	function scrape_rate(payload, callback) {
		new Scraper(payload, callback).scrape();
	}
	
	var options = {
			id: 'test_worker',
			host: host,
			port: port,
			handlers: {
				conversion_rate: {
					type: 'conversion_rate',
					work: scrape_rate
				}
			},
			ignoreDefault: true},
	    worker = new Beanworker(options),
		db = mongoskin.db(mongo_conn_str);
	worker.start([tube]);

})(bean_port, bean_host, mongo_conn_str);
