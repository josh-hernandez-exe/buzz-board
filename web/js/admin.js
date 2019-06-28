var buzzerConfig;
var oldState = null;
var isBuzzerListening = false;
var operation = null;
var teamSelected = {};
var curScaleFactor = 1.0;
var errorToastDisplayDuration = 4000 // ms

function generateTeamButton(team) {
    var teamButtonTemplate;

    teamButtonTemplate = '\
        <div class="col s4 m3 l2">\
            <p>\
                <a class="waves-effect waves-light btn disabled" id="button-team-select-'+team+'">'+team+'</a>\
            </p>\
        </div>\
    ';

    return teamButtonTemplate;
}

function buildSlider(sliderConfig) {
    if (!sliderConfig) return;
    var minValue = sliderConfig.min;
    var maxValue = sliderConfig.max;
    var incrementValue = sliderConfig.increment;

    if (typeof minValue !== 'number') return;
    if (typeof maxValue !== 'number') return;
    if (typeof incrementValue !== 'number') incrementValue = 5;

    if (minValue > maxValue) return;

    function generateSlider(minValue, maxValue, incrementValue) {
        return '<input class="col s12" id="score-slider" type="range" min="'+minValue+'" max="'+maxValue+'" step="'+incrementValue+'">';
    }

    $('#score-slider-section')
        .append([
            '<a class="waves-effect waves-light btn-large" id="button-score-decrement">-</a>'
        ].join(''))
        .append([
            '<a class="waves-effect waves-light btn-large" id="button-score-increment">+</a>'
        ].join(''))
        .append('<div class="row"></div>')
        .append(generateSlider(minValue, maxValue, incrementValue));

    $('#button-score-decrement').css('float','left');
    $('#button-score-increment').css('float','right');

    var scoreSlider = $('#score-slider');

    scoreSlider.on('input change',() => {
        changeInputScoreValue(scoreSlider.val())
    });
    $('#button-score-decrement').on('click',() => {
        changeInputScoreValue(getCurrentScoreValue() - incrementValue);
    });
    $('#button-score-increment').on('click',() => {
        changeInputScoreValue(getCurrentScoreValue() + incrementValue);
    });
}

function getCurrentScoreValue() {
    return Number($('#score-value').val());
}

function getCurrentScaledScoreValue() {
    return getCurrentScoreValue() * curScaleFactor;
}

function changeInputScoreValue(newValue) {
    $('#score-value').val(newValue)

    var sliderObject = $('#score-slider');
    var sliderExists = typeof buzzerConfig.admin.slider === 'object' && buzzerConfig.admin.slider !== null;
    if (sliderObject && sliderExists) {
        var newSliderValue = newValue;
        if (newSliderValue > buzzerConfig.admin.slider.max) newSliderValue = buzzerConfig.admin.slider.max
        if (newSliderValue < buzzerConfig.admin.slider.min) newSliderValue = buzzerConfig.admin.slider.min
        sliderObject.val(newSliderValue);
    }
}

function buildPresetScores(presetConfig) {
    if (!presetConfig) return;
    if (!Array.isArray(presetConfig)) return;

    var isValid = true;
    presetConfig.forEach((value) => {
        if(typeof value !== 'number') isValid = false;
    });

    if (!isValid) return;

    function generatePresetScoreButton(value) {
        return '<div class="col s3 m2"><a class="waves-effect waves-light btn orange button-padding" id="button-score-preset-'+value+'">'+value+'</a></div>'
    }

    presetConfig.forEach((value) => {
        var buttonID = 'button-score-preset-'+value
        $('#score-preset-section')
            .append(generatePresetScoreButton(value))

        $('#'+buttonID).on('click', () => {
            changeInputScoreValue(value)
        });
    });
}

function buildScaleFactorDropDown(scaleFactorConfig) {
    if (!scaleFactorConfig) return;
    if (!('values' in scaleFactorConfig)) return;
    if (!Array.isArray(scaleFactorConfig.values)) return;

    var isValid = true;
    var scaleFactorArray = scaleFactorConfig.values;
    scaleFactorArray.forEach((value) => {
        if(typeof value !== 'number') isValid = false;
    });

    if (!isValid) return;

    $('#score-select-scale-factor-section')
        // add dropdown trigger
        .append('<a class="dropdown-button btn" data-activates="score-scale-factor-dropdown-content" id="score-scale-factor-button">Scale Factor</a>')
        // add dropdown structure
        .append('\
          <ul id=\'score-scale-factor-dropdown-content\' class=\'dropdown-content\'>\
          </ul>\
        ')

    var scaleFactorButton = $('#score-scale-factor-button');

    // Initialization for dropdowns is only necessary if you create them dynamically.
    scaleFactorButton.dropdown({
        inDuration: 300,
        outDuration: 225,
        constrainWidth: false, // Does not change width of dropdown to that of the activator
        hover: false, // Activate on hover, makes mobile click twice
        gutter: 0, // Spacing from edge
        belowOrigin: false, // Displays dropdown below the button
        alignment: 'left', // Displays dropdown with edge aligned to the left of button
        stopPropagation: false // Stops event propagation
    });

    var dropDownObject = $('#score-scale-factor-dropdown-content');

    scaleFactorArray.forEach((value) => {
        var idStringValue = value.toString().replace('.','d');
        var scaleFactorDropdownItemID = 'score-scale-factor-trigger-'+idStringValue;
        var generatedDropdownContent = '<li><a id="'+scaleFactorDropdownItemID+'">'+value+'</a></li>';
        dropDownObject.append(generatedDropdownContent);
        $('#'+scaleFactorDropdownItemID).on('click', () => {
            changeScaleFactor(value);
            scaleFactorButton.dropdown('close');
        });
    });

    changeScaleFactor(1.0);
}

function changeScaleFactor(value) {
    var scaleFactorButton = $('#score-scale-factor-button');
    if(scaleFactorButton) scaleFactorButton.text('x '+value);
    curScaleFactor = Number(value);
}

function areAnySelected() {
    for (var teamName of Object.keys(teamSelected)) {
        if (teamSelected[teamName]) return true;
    }
    return false;
}


function selectedToArray() {
    var isSelected = [];
    Object.keys(teamSelected).forEach((teamID,index,array) => {
        if (teamSelected[teamID]) isSelected.push(teamID);
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
    .done((data) => {
        if(parseInt(data["question"]) == 0) questionOff();
        else questionOn();
    });
}

function teamSetUp(teamList){
    teamList.forEach((teamID, index, array) => {
        teamSelected[teamID] = false;
        var teamSelectButtonID = 'button-team-select-'+teamID;
        $("#team-select-grid")
            .append($(generateTeamButton(teamID)));
        $('#'+teamSelectButtonID).on('click', () => {
            if (teamSelected[teamID]) disableButton(teamSelectButtonID);
            else enableButton(teamSelectButtonID);
            teamSelected[teamID] = !teamSelected[teamID];
        });
    });
}

function teamSelection(teamID,isSelected) {
    var teamSelectButtonID = 'button-team-select-'+teamID;

    if (typeof isSelected !== 'boolean'){
        console.error('`isSelected` variable passed in is not a boolean.')
        return;
    }

    teamSelected[teamID] = isSelected;
    if(isSelected) enableButton(teamSelectButtonID)
    else disableButton(teamSelectButtonID);
}

function teamSelectAll(teamList) {
    teamList.forEach((teamID, index, array) => {
        if (!teamSelected[teamID]) teamSelection(teamID, true);
    });
}

function teamDeselectAll(teamList) {
    teamList.forEach((teamID, index, array) => {
        if (teamSelected[teamID]) teamSelection(teamID, false);
    });
}

function teamInvertAll(teamList) {
    teamList.forEach((teamID, index, array) => {
        teamSelection(teamID, !teamSelected[teamID]);
    });
}

function teamSelectBuzzedState(teamList,buzzerState){
    $.ajax({
        type: "GET",
        url: '/scoreboard/state'
    })
    .done((data) => {
        teamList.forEach((teamID, index, array) => {
            teamSelection(teamID, data[teamID]["buzzer"]===buzzerState);
        });
    })
    .fail((jqXHR, textStatus) => {
        console.log(jqXHR);
        console.log("Request failed: " + textStatus);
        setTimeout(updateState, pollPeriod);
    });
}

function getConfig(){
    response = $.ajax({
        type: "GET",
        url: '/buzzer_config'
    })
    .done((data) => {
        buzzerConfig = data
        teamSetUp(buzzerConfig.teams);
        buildSlider(buzzerConfig.admin.slider);
        buildPresetScores(buzzerConfig.admin.score_presets);
        buildScaleFactorDropDown(buzzerConfig.admin.score_scale_factors);

        if (buzzerConfig.admin.key === true) {
            buildKeyInput();
        }
    })
    .fail((jqXHR, textStatus) => {
        console.log(jqXHR);
        console.log("Request failed: " + textStatus);
    });
}

$(function() {
    console.log("Loading");

    initalizeQuestionStatus()
    getConfig()

    $('#buzzerListening').on("click", () =>{
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
                password: getBuzzBoardKey(buzzerConfig.admin.key),
                operation:"buzzerListening",
                value:listeningInt
            }),
            success: () => {},
            error: (request, error, errorThrown) => {
                if (request.status === 403) {
                    Materialize.toast("Authentication Failed", errorToastDisplayDuration);
                }
            },
            dataType: "json"
        });

    });

    $('#keepListening').on("click", () =>{
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                password: getBuzzBoardKey(buzzerConfig.admin.key),
                operation:"keepListening",
                value:""
            }),
            success: () => {},
            error: (request, error, errorThrown) => {
                if (request.status === 403) {
                    Materialize.toast("Authentication Failed", errorToastDisplayDuration);
                }
            },
            dataType: "json"
        });
    });

    $('#resetBuzzer').on("click", () =>{
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                password: getBuzzBoardKey(buzzerConfig.admin.key),
                operation:"resetBuzzer",
                value:""
            }),
            success: () => {},
            error: (request, error, errorThrown) => {
                if (request.status === 403) {
                    Materialize.toast("Authentication Failed", errorToastDisplayDuration);
                }
            },
            dataType: "json"
        });
    });

    $('#score-add').on("click", () => {
        clearScoreOptions();
        enableButton("score-add");
        operation = "add";
    });

    $('#score-sub').on("click", () => {
        clearScoreOptions();
        enableButton("score-sub");
        operation = "sub";
    });

    $('#score-set').on("click", () => {
        clearScoreOptions();
        enableButton("score-set");
        changeScaleFactor(1.0);
        operation = "set";
    });

    $('#score-update').on("click", () => {
        console.log("Updating Score");

        if(!areAnySelected()) {
            Materialize.toast("You have no teams selected", errorToastDisplayDuration);
            return;
        }

        if(operation === null) {
            Materialize.toast("You have not selected an operation", errorToastDisplayDuration);
            return;
        }

        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                password: getBuzzBoardKey(buzzerConfig.admin.key),
                operation:operation,
                value:getCurrentScaledScoreValue()
            }),
            success: () => {},
            error: (request, error, errorThrown) => {
                if (request.status === 403) {
                    Materialize.toast("Authentication Failed", errorToastDisplayDuration);
                }
            },
            dataType: "json"
        });
    });

    $('#score-undo').on("click", () => {
        console.log("Undoing Last Operation");
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                password: getBuzzBoardKey(buzzerConfig.admin.key),
                operation:"undo",
                value:""
            }),
            success: () => {},
            error: (request, error, errorThrown) => {
                if (request.status === 403) {
                    Materialize.toast("Authentication Failed", errorToastDisplayDuration);
                }
            },
            dataType: "json"
        });
    });

    $('#score-redo').on("click", () => {
        console.log("Redoing Last Operation");
        $.ajax({
            type: "POST",
            url: '/',
            data: JSON.stringify({
                teams:selectedToArray(),
                userType:"admin",
                password: getBuzzBoardKey(buzzerConfig.admin.key),
                operation:"redo",
                value:""
            }),
            success: () => {},
            error: (request, error, errorThrown) => {
                if (request.status === 403) {
                    Materialize.toast("Authentication Failed", errorToastDisplayDuration);
                }
            },
            dataType: "json"
        });
    });

    $('#team-select-all').on('click', () => {
        teamSelectAll(buzzerConfig.teams)
    });

    $('#team-select-none').on('click', () => {
        teamDeselectAll(buzzerConfig.teams)
    });

    $('#team-select-invert').on('click', () => {
        teamInvertAll(buzzerConfig.teams)
    });

    $('#team-select-buzzed-in').on('click', () => {
        teamSelectBuzzedState(buzzerConfig.teams,1);
    });

    $('#team-select-buzzed-wrong').on('click', () => {
        teamSelectBuzzedState(buzzerConfig.teams,2);
    });

})
