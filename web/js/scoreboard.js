var TEAM_LIST = [""];
var oldState = null;
var updateCount = 0;
var buzzInSound = new Audio("/buzzIn.mp3");
var inncorectAnswerSound = new Audio("/incorectAnswer.mp3");

function generateCard(team,score){
    var cardTemplate;
    cardTemplate = ' \
    <div class="col s12 m3"> \
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
    TEAM_LIST.forEach(function(element, index, array){
        $("#scoreboard-card-"+element).attr("class","card blue-grey")
    });
}

function setScore(team,value){
    $("#scoreboard-score-"+team).text(value)
}

function teamSetUp(TEAM_LIST){
    TEAM_LIST.forEach(function(element, index, array){
        $("#scoreboard-collection")
            .append($(generateCard(element,0)))
    });

    updateState();
}


function getTeamList(){
    response = $.ajax({
        type: "GET",
        url: '/team_list.json'
    })
    .done( function(data){
        TEAM_LIST = data;
        console.log(TEAM_LIST);
        teamSetUp(TEAM_LIST);
    })
    .fail(function( jqXHR, textStatus ) {
        console.log(jqXHR);
        console.log( "Request failed: " + textStatus );
    });
}

function updateState(){
    $.ajax({
        type: "GET",
        url: '/scoreboard_interactions.json'
    })
    .done( function(data){
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

        TEAM_LIST.forEach(function(element, index, array){
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
    })
    .fail(function( jqXHR, textStatus ) {
        console.log(jqXHR);
        console.log( "Request failed: " + textStatus );
    });

    updateCount+=1;
    if(updateCount>=1000){
        window.location.reload();
    }

    setTimeout(updateState,333);
}


$(function(){
    console.log("Loading");
    getTeamList();
});