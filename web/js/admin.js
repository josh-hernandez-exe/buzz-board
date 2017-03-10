var buzzerConfig;
var oldState = null;
var isBuzzerListening = false;
var operation = null;
var teamSelected = {};

function generateTeamButton(team) {
    var teamButtonTemplate;

    teamButtonTemplate = '\
        <div class="col s4 m3 l2">\
            <p>\
                <a class="waves-effect waves-light btn-large disabled" id="button-team-select-'+team+'">'+team+'</a>\
            </p>\
        </div>\
    ';

    return teamButtonTemplate;
}

function areAnySelected() {
    for (var teamName of Object.keys(teamSelected)) {
        if (teamSelected[teamName]) return true;
    }
    return false;
}

function selectedToArray() {
    var isSelected = [];
    Object.keys(teamSelected).forEach(function(element,index,array) {
        if (teamSelected[element]) isSelected.push(element);
    });
    return isSelected;
}

function clearScoreOptions(){
    disableButton('score-add')
    disableButton('score-sub')
    disableButton('score-set')
}

function enableButton(idName){
    var buttonObject = $('#'+idName);
    if (buttonObject.hasClass('disabled')) buttonObject.removeClass('disabled');
}

function disableButton(idName) {
    var buttonObject = $('#'+idName);
    if (!buttonObject.hasClass('disabled')) buttonObject.addClass('disabled');
}

function questionOn(){
    isBuzzerListening = true;
    var buttonObject = $("#buzzerListening");
    if (buttonObject.hasClass('disabled')) buttonObject.removeClass('disabled');
    if (buttonObject.hasClass('red')) buttonObject.removeClass('red');
    if (!buttonObject.hasClass('teal')) buttonObject.addClass('teal');
}

function questionOff(){
    isBuzzerListening = false;
    var buttonObject = $("#buzzerListening");
    if (buttonObject.hasClass('disabled')) buttonObject.removeClass('disabled');
    if (buttonObject.hasClass('teal')) buttonObject.removeClass('teal');
    if (!buttonObject.hasClass('red')) buttonObject.addClass('red');
}


function initalizeQuestionStatus(){
    $.ajax({
        type: "GET",
        url: '/scoreboard/state'
    })
    .done(function(data){
        if(parseInt(data["question"]) == 0) questionOff();
        else questionOn();
    });
}

function teamSetUp(teamList){
    teamList.forEach(function(element, index, array){
        teamSelected[element] = false;
        var teamSelectButtonID = 'button-team-select-'+element;
        $("#team-select-grid")
            .append($(generateTeamButton(element)));
        $('#'+teamSelectButtonID).on("click",function(){
            if (teamSelected[element]) disableButton(teamSelectButtonID);
            else enableButton(teamSelectButtonID);
            teamSelected[element] = !teamSelected[element];
        });
    });
}

function teamSelectAll(teamList) {
    teamList.forEach(function(element, index, array){
        var teamSelectButtonID = 'button-team-select-'+element;
        if (!teamSelected[element]) enableButton(teamSelectButtonID);
        teamSelected[element] = true;
    });
}

function teamDeselectAll(teamList) {
    teamList.forEach(function(element, index, array){
        var teamSelectButtonID = 'button-team-select-'+element;
        if (teamSelected[element]) disableButton(teamSelectButtonID);
        teamSelected[element] = false;
    });
}

function teamInvertAll(teamList) {
    teamList.forEach(function(element, index, array){
        var teamSelectButtonID = 'button-team-select-'+element;
        if (teamSelected[element]) disableButton(teamSelectButtonID);
        else enableButton(teamSelectButtonID);
        teamSelected[element] = !teamSelected[element];
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

        if(areAnySelected()){
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
        } else {
            window.alert("You have no teams selected");
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

    $('#team-select-all').on('click', function(){
        teamSelectAll(buzzerConfig.teams)
    });

    $('#team-select-none').on('click', function(){
        teamDeselectAll(buzzerConfig.teams)
    });

    $('#team-select-invert').on('click', function(){
        teamInvertAll(buzzerConfig.teams)
    });


})
