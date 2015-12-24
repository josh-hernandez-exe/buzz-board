var TEAM_LIST = [""];
var oldState = null;
var questionListening = false;
var currentTeam = null;
var operation = null;


function generateDropDownTeamTemplate(team){
    var template = "";

    template = '<li><a href="javascript:setTeam('+"'"+team+"'"+')">'+team+'</a></li>'
    return template
}


function setTeam(teamName){
    currentTeam = teamName;
    $('#score-team').text(teamName);
}

function clearScoreOptions(){
    var disabledClass = "waves-effect waves-light btn-large disabled";
    $('#score-add').attr('class',disabledClass);
    $('#score-sub').attr('class',disabledClass);
    $('#score-set').attr('class',disabledClass);
}

function enableButton(idName){
    var enabledClass = "waves-effect waves-light btn-large";
    $('#'+idName).attr('class',enabledClass);
}

function questionOn(){
    $("#question").attr("class","waves-effect waves-light btn-large teal");
    questionListening = true;
}

function questionOff(){
    $("#question").attr("class","waves-effect waves-light btn-large red");
    questionListening = false;
}


function initalizeQuestionStatus(){
    $.ajax({
        type: "GET",
        url: '/scoreboard_interactions.json'
    })
    .done(function(data){

        if(parseInt(data["question"]) == 0){
            questionOff();
        
        }else{
            questionOn();
        }
    });
}

function teamSetUp(TEAM_LIST){
    TEAM_LIST.forEach(function(element, index, array){
        $("#team-select-dropdown")
            .append($(generateDropDownTeamTemplate(element)));
    });
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

$(function(){
    console.log("Loading");

    initalizeQuestionStatus()
    getTeamList()

    $('#question').on("click",function(){
        if(questionListening){
            questionOff();
        }
        else{
            questionOn();
        }
        var listeningInt = 0;
        if(questionListening){
            listeningInt=1;
        }
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                team:currentTeam,
                userType:"admin",
                operation:"questionListening",
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
                team:currentTeam,
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
                team:currentTeam,
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

        if(currentTeam!=null){

            var value = $("#score-value").val();

            if(value==null||value===""){
                value = '0';
            }

            $.ajax({
                type: "POST",
                url: '/',
                data: JSON.stringify({
                    team:currentTeam,
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
                team:currentTeam,
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
                team:currentTeam,
                userType:"admin",
                operation:"redo",
                value:""
            }),
            success: function(){},
            dataType: "json"
        });
    });
})