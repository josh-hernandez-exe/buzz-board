Dependencies
* redis

Setup
* `server_conf.py` (using `server_conf.py.example`)
	* currently web sockets are not used
* Get your own audio files for `/web/buzzin.mp3` and `/web/incorectAnswer.mp3`
	* if you don't want audio then change the following lines in `/web/js/scoreboard.js`
		* from:
			`var buzzInSound = new Audio("/buzzIn.mp3");`
			`var inncorectAnswerSound = new Audio("/incorectAnswer.mp3");`
		* to:
			`var buzzInSound = null;`
			`var inncorectAnswerSound = null;`

Server start:
* start redis
* start http

Interfaces:
* player 
* scoreboard
* admin

How to use:
* Note the question listening / not listening states
* Fill in later