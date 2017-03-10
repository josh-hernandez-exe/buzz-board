var TEAM_LIST = [""];
var oldState = null;
var isBuzzerListening = false;
var operation = null;
var teamSelected = {};

function generateTeamButton(team) {
    var teamButtonTemplate;
    // teamButtonTemplate = '<a class="waves-effect waves-light btn-large disabled" id="team-select-'+team+'">'+team+'</a>'

    teamButtonTemplate = '\
        <div class="col s4 m3 l2">\
            <p>\
            <a class="waves-effect waves-light btn-large disabled" id="team-select-'+team+'">'+team+'</a>\
            </p>\
        </div>\
    ';

    return teamButtonTemplate;
}

function setTeam(teamName){
    Object.keys(teamSelected).forEach(function(element,index,array) {
        teamSelected[element] = false;
    });
    teamSelected[teamName] = true;
    $('#score-team').text(teamName);
}

function selectedToArray() {
    var isSelected = [];
    Object.keys(teamSelected).forEach(function(element,index,array) {
        if (teamSelected[element]) isSelected.push(element);
    });
    return isSelected;
}

function clearScoreOptions(){
    var disabledClass = "waves-effect waves-light btn-large disabled";
    $('#score-add').attr('class',disabledClass);
    $('#score-sub').attr('class',disabledClass);
    $('#score-set').attr('class',disabledClass);
}

function enableButton(idName){
    $('#'+idName).removeClass('disabled');
}

function disableButton(idName) {
    $('#'+idName).addClass('disabled');
}

function questionOn(){
    $("#buzzerListening").attr("class","waves-effect waves-light btn-large teal");
    isBuzzerListening = true;
}

function questionOff(){
    $("#buzzerListening").attr("class","waves-effect waves-light btn-large red");
    isBuzzerListening = false;
}


function initalizeQuestionStatus(){
    $.ajax({
        type: "GET",
        url: '/scoreboard/state'
    })
    .done(function(data){

        if(parseInt(data["question"]) == 0){
            questionOff();
        
        }else{
            questionOn();
        }
    });
}

function teamSetUp(teamList){
    teamList.forEach(function(element, index, array){
        teamSelected[element] = false;
        var teamSelectButtonID = 'team-select-'+element;
        $("#team-select-grid")
            .append($(generateTeamButton(element)));
        $('#'+teamSelectButtonID).on("click",function(){
            if (teamSelected[element]) disableButton(teamSelectButtonID);
            else enableButton(teamSelectButtonID);
            teamSelected[element] = !teamSelected[element]
        });
    });
}

function getConfig(){
    response = $.ajax({
        type: "GET",
        url: '/buzzer_config'
    })
    .done( function(data){
        buzzerConfig = data
        teamSetUp(buzzerConfig.teams);
    })
    .fail(function( jqXHR, textStatus ) {
        console.log(jqXHR);
        console.log( "Request failed: " + textStatus );
    });
}

$(function(){
    console.log("Loading");

    initalizeQuestionStatus()
    getConfig()

    $('#buzzerListening').on("click",function(){
        if(isBuzzerListening){
            questionOff();
        }
        else{
            questionOn();
        }
        var listeningInt = 0;
        if(isBuzzerListening){
            listeningInt=1;
        }
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                operation:"buzzerListening",
                value:listeningInt
            }),
            success: function(){},
            dataType: "json"
        });

    });

    $('#keepListening').on("click",function(){
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                operation:"keepListening",
                value:""
            }),
            success: function(){},
            dataType: "json"
        });
    });

    $('#resetBuzzer').on("click",function(){
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                operation:"resetBuzzer",
                value:""
            }),
            success: function(){},
            dataType: "json"
        });
    });



    $('#score-add').on("click",function(){
        clearScoreOptions();
        enableButton("score-add");
        operation = "add";
    });

    $('#score-sub').on("click",function(){
        clearScoreOptions();
        enableButton("score-sub");
        operation = "sub";
    });

    $('#score-set').on("click",function(){
        clearScoreOptions();
        enableButton("score-set")
        operation = "set";
    });


    $('#score-update').on("click",function(){
        console.log("Updating Score");

        if(selectedToArray()!=null){

            var value = $("#score-value").val();

            if(value==null||value===""){
                value = '0';
            }

            $.ajax({
                type: "POST",
                url: '/',
                data: JSON.stringify({
                    teams:selectedToArray(),
                    userType:"admin",
                    operation:operation,
                    value:value
                }),
                success: function(){},
                dataType: "json"
            });
        }
    });

    $('#score-undo').on("click",function(){
        console.log("Undoing Last Operation");
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                operation:"undo",
                value:""
            }),
            success: function(){},
            dataType: "json"
        });
    });

    $('#score-redo').on("click",function(){
        console.log("Redoing Last Operation");
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                operation:"redo",
                value:""
            }),
            success: function(){},
            dataType: "json"
        });
    });
})
