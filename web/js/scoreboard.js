var buzzerConfig;
var oldState = null;
var updateCount = 0;
var buzzInSound = new Audio("/buzzIn.mp3");
var inncorectAnswerSound = new Audio("/incorectAnswer.mp3");

function generateCard(team,score){
    var cardTemplate;
    cardTemplate = ' \
    <div class="col s12 m4 l3"> \
        <div class="card blue-grey" id="scoreboard-card-'+team+'"> \
            <div class="card-content white-text"> \
              <span class="card-title">'+team+'</span> \
              <h2 id="scoreboard-score-'+team+'">'+score+'</h2> \
            </div> \
        </div> \
    </div> \
    '
    return cardTemplate;
}

function questionOn(){
    $("#logo-header").attr("class","green");
    resetBuzzer();
}

function questionOff(){
    $("#logo-header").attr("class","light-blue lighten-1");
}

function gotBuzzer(team){
    $("#scoreboard-card-"+team).attr("class","card green");
}

function failedBuzzer(team){
    $("#scoreboard-card-"+team).attr("class","card red");
}


function resetBuzzer(){
    buzzerConfig.teams.forEach((element, index, array) => {
        $("#scoreboard-card-"+element).attr("class","card blue-grey")
    });
}

function setScore(team,value){
    $("#scoreboard-score-"+team).text(value)
}

function teamSetUp(){
    buzzerConfig.teams.forEach((element, index, array) => {
        $("#scoreboard-collection")
            .append($(generateCard(element,0)))
    });

    updateState();
}


function getConfig(){
    response = $.ajax({
        type: "GET",
        url: '/buzzer_config'
    })
    .done((data) => {
        buzzerConfig = data
        teamSetUp();
    })
    .fail((jqXHR, textStatus) => {
        console.log(jqXHR);
        console.log("Request failed: " + textStatus);
    });
}

function updateState(){
    var pollPeriod = buzzerConfig.scoreboard.poll;
    var refreashThreshold = buzzerConfig.scoreboard.refresh_threshold;

    if(typeof pollPeriod !== 'number'){
        pollPeriod = 500; // default value
    }

    $.ajax({
        type: "GET",
        url: '/scoreboard/state'
    })
    .done((data) => {
        // Remember that this is a callback asynchronously executed!
        // Deep copy
        var copyOldState = null;
        if(oldState!=null){
            copyOldState = jQuery.extend(true, {}, oldState);
        }

        if(parseInt(data["question"]) == 0){
            questionOff();
        }else{
            questionOn();
        }

        buzzerConfig.teams.forEach((element, index, array) => {
            var score = data[element]["score"];
            var buzzer = data[element]["buzzer"];
            setScore(element,score);
            if(buzzer==1){

                if(copyOldState!=null){
                    if(copyOldState[element]["buzzer"]==0){
                        // play sound
                        if(buzzInSound!=null){
                            buzzInSound.play();
                        }
                    }
                }
                gotBuzzer(element);

            } else if (buzzer==2){
                if(copyOldState!=null){
                    if(copyOldState[element]["buzzer"]==1){
                        // play sound
                        if(inncorectAnswerSound!=null){
                            inncorectAnswerSound.play();
                        }
                    }
                }
                failedBuzzer(element);
            }
            oldState = data;
        });

        setTimeout(updateState,pollPeriod);
    })
    .fail((jqXHR, textStatus) => {
        console.log(jqXHR);
        console.log("Request failed: " + textStatus);
        setTimeout(updateState, pollPeriod);
    });

    updateCount+=1;
    if(typeof refreashThreshold === 'number' && updateCount>=refreashThreshold){
        window.location.reload();
    }
}

$(function(){
    console.log("Loading");
    getConfig();
});
