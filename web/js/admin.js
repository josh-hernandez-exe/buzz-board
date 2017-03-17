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
            '<div class="left-align col s1">',
            '<a class="waves-effect waves-light btn" id="button-score-decrement">-</a>',
            '</div>'
        ].join(''))
        .append([
            '<div class="right-align col s1 push-m10 push-s8">',
            '<a class="waves-effect waves-light btn" id="button-score-increment">+</a>',
            '</div>'
        ].join(''))
        .append(generateSlider(minValue, maxValue, incrementValue));

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
    if (sliderObject) {
        var newSliderValue = newValue;
        if (newSliderValue > buzzerConfig.slider.max) newSliderValue = buzzerConfig.slider.max
        if (newSliderValue < buzzerConfig.slider.min) newSliderValue = buzzerConfig.slider.min
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
        return '<div class="col s3 m2"><a class="waves-effect waves-light btn orange" id="button-score-preset-'+value+'">'+value+'</a></div>'
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

    function changeScaleFactor(value) {
        scaleFactorButton.text('x '+value);
        curScaleFactor = Number(value);
    }

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

function areAnySelected() {
    for (var teamName of Object.keys(teamSelected)) {
        if (teamSelected[teamName]) return true;
    }
    return false;
}


function selectedToArray() {
    var isSelected = [];
    Object.keys(teamSelected).forEach((element,index,array) => {
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
    .done((data) => {
        if(parseInt(data["question"]) == 0) questionOff();
        else questionOn();
    });
}

function teamSetUp(teamList){
    teamList.forEach((element, index, array) => {
        teamSelected[element] = false;
        var teamSelectButtonID = 'button-team-select-'+element;
        $("#team-select-grid")
            .append($(generateTeamButton(element)));
        $('#'+teamSelectButtonID).on('click', () => {
            if (teamSelected[element]) disableButton(teamSelectButtonID);
            else enableButton(teamSelectButtonID);
            teamSelected[element] = !teamSelected[element];
        });
    });
}

function teamSelectAll(teamList) {
    teamList.forEach((element, index, array) => {
        var teamSelectButtonID = 'button-team-select-'+element;
        if (!teamSelected[element]) enableButton(teamSelectButtonID);
        teamSelected[element] = true;
    });
}

function teamDeselectAll(teamList) {
    teamList.forEach((element, index, array) => {
        var teamSelectButtonID = 'button-team-select-'+element;
        if (teamSelected[element]) disableButton(teamSelectButtonID);
        teamSelected[element] = false;
    });
}

function teamInvertAll(teamList) {
    teamList.forEach((element, index, array) => {
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
    .done((data) => {
        buzzerConfig = data
        teamSetUp(buzzerConfig.teams);
        buildSlider(buzzerConfig.slider)
        buildPresetScores(buzzerConfig.score_presets)
        buildScaleFactorDropDown(buzzerConfig.score_scale_factors)
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
                operation:"buzzerListening",
                value:listeningInt
            }),
            success: () => {},
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
                operation:"keepListening",
                value:""
            }),
            success: () => {},
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
                operation:"resetBuzzer",
                value:""
            }),
            success: () => {},
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
        enableButton("score-set")
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
                operation:operation,
                value:getCurrentScaledScoreValue()
            }),
            success: () => {},
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
                operation:"undo",
                value:""
            }),
            success: () => {},
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
                operation:"redo",
                value:""
            }),
            success: () => {},
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


})
