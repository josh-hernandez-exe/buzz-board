## Future Features
* The scoreboard will use websockets.
	* If websockets are fully implemented, lengthen the auto refresh.
* Have an option to no use the score mechanism.
	* In most of the javascript files, there is a `teamSetup`, a boolean will have to be saved logic must follow on page load.
		* buzzer (`/`)
			* Nothing changes
		* scoreboard (`/scoreboard`)
			* Cards do not display point values.
		* admin (`/admin`)
			* UI elements related to modify score values should be hidden.
* In the future, the `null` team will auto select the teams who buzzed in and apply score changes to them.
	* Teams with the state `BUZZER_PRESSED_FAILED` will have their score removed from them.
	* The team with the state `BUZZER_PRESSED` will have their score increased.
* Buzzer will get a reply from server they they have buzzed in.
	* There should be timeout so that the buzzer returns to the normal color.
* Some refactoring can be done with the class changes done with jQuery.

## Completed
* ~~ Some refactoring can be done with the class changes done with jQuery. ~~

## No Longer Relevent
* Change how the team select dropdown works in mobile.
	* On the admin page, the current team select can be buggy.
		* If possible, only on the mobile, make the dropdown turn in the scroll dropdown.
* Remove dependency on redis.
	- Convient when server crashes
