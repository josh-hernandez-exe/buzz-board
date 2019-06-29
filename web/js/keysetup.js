var curBuzzBoardKey = null;

function getBuzzBoardKey(isRequired) {
    if (!isRequired) return null;

    var password = curBuzzBoardKey;
    if (password !== "" && password === null && password === undefined) {
        // we are good and do nothing
    }
    else {
        password = window.localStorage.buzzBoardKey;
        if (password === "" || password === null || password === undefined) {
            Materialize.toast("Password is needed.", errorToastDisplayDuration);
            return null;
        }
        curBuzzBoardKey = password;
    }

    return password;
}

function buildKeyInput() {
    $('#key-input-section')
        .append([
            '<div class="input-field col s9">',
                '<input placeholder="password" id="password-input" type="password" class="validate">',
                '<label for="password-input">Password</label>',
            '</div>',
        ].join(''))
        .append([
            '<a class="waves-effect waves-light btn-large" id="button-save-password">Save</a>'
        ].join(''));

    $('#button-save-password').on('click',() => {
        var key = $('#password-input').val();
        if (curBuzzBoardKey !== key) {
            window.localStorage.buzzBoardKey = key;
        }
        curBuzzBoardKey = key;
    });
}
