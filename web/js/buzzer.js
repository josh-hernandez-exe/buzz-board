var buzzerConfig;
var currentTeam = null;

function generateTeamSelectorTemplate(team){
    var template = "";

    template = '<li><a href="javascript:setTeam('+"'"+team+"'"+')">'+team+'</a></li>'
    return template
}

function setTeam(team){
    currentTeam = team;
    $('#logo-container').text(team);
    $('.button-collapse').sideNav('hide');
    document.location.hash=team;
}

function teamSetUp(teamList){
       teamList.forEach(function(element, index, array){
        $("#slide-out")
            .append($(generateTeamSelectorTemplate(element)));
    });
    // After the teams are added, add a link to the score board.
    $("#slide-out")
        .append($('<li><a href="scoreboard.html">Scoreboard</a></li>'));
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
    getConfig();

    $('#buzzer').on("click",function(){
        console.log("Buzzing In");

        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                team:currentTeam,
                userType:"player",
                operation:"buzzer",
                value:""
            }),
            success: function(){},
            dataType: "json"
        });
    })

    if(document.location.hash!=""){
        setTeam(
            document.location.hash.substring(
                1,
                document.location.hash.length
            )
        );
    }

    // Initalize the side bar
    $('.button-collapse').sideNav();

})
