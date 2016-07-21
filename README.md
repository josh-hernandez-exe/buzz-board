##Dependencies
* redis

##Setup
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

##Server start
* start redis
* start http
	* Starts the server inside the `web/` directory.

##Interfaces:
* player (`/`)
* scoreboard (`/scoreboard`)
* admin (`/admin`)

##How to use:
* Players access `/`
	* Then they select which team they are apart of.
	* They press the buzzer when they want to buzz in.
* The admin controls the state of the game. 
	* Can toggles the listening state with the [**QUESTION**] button.
		* When the question state is off (red), then no buzzer input is listened to.
		* When the question state is on (green), then the first buzzer input is listened to.
	* Can modify the score on the board.
		* They select which team they want to modify, and they can add/subtract/set the score.
			* Subtract is redundant, but there for convenience.
	* If someone gets the question wrong they can press the [**KEEP LISTENING**] near the bottom of the page.
		* This will cause the server to continue listening, but not listen to the people who got the question wrong.
		* When done so, the team state is of who ever is `BUZZER_PRESSED` is changed to `BUZZER_PRESSED_FAILED`.
		* You will only ever see one team who has the state `BUZZER_PRESSED`.
	* If they want to reset the buzzer states, they can press the [**RESET BUZZER**] button on the bottom of the page.
		* Every team will be set to `BUZZER_NOT_PRESSED`

##Security
* There is no security within this web application.
* It is assumed that players will truthfully select which team they are on
	* Since you can select which team you are on, you have the ability to pretend to buzz for someone else
		* If you are playing classic Jeopardy, then you can someone to buzz in when they don't want to.
	* Its up to you to tell people.
		* Note that people tend to want to do something when you specifically tell them not to!
* The admin page is not restricted in any way.
	* Anyone who knows the url, can access the admin page.

## Versions
### Version 1.0.0
* Initial Release

### Version 1.0.1
* Made the http server be threaded, note that the class `BaseHTTPServer.HTTPServer` is single threaded
