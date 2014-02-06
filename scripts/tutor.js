function startTutor(id) {
    var allDialogs; // List of all dialog objects, populated from html automagically
    var nextDialogIndex;

    function closeDialog() {
        $(this).dialog("close");
    }

    function nextDialog() {
        if (nextDialogIndex < allDialogs.size()) {
            if (nextDialogIndex == allDialogs.size() - 1) {
                saveSetting("tutor-finished", true);
            }

            allDialogs.eq(nextDialogIndex).dialog("open");
            nextDialogIndex++;
        }
    }

    var commonOptions = {
        autoOpen: false,
        resizable: false,
        draggable: false,
        minHeight: 0,
        modal: false,
        width: "auto",
        show: "fade",
        hide: "fade",
        dialogClass: "tutor",
        buttons: [ {
            text: localize("Got it!"),
            click: closeDialog
        }, {
            text: localize("Skip tutor"),
            click: function() {
                nextDialogIndex = allDialogs.size() - 1;
                $(this).dialog("close");
            }
        }
        ],
        close: nextDialog
    };

    var specificOptions = {
        "welcome": {
            modal: true,
            position: {
                of: "#map-canvas-container"
            }
        },
        "dz-selection": {
            position: {
                of: "#dz-finder",
                my: "center top",
                at: "center bottom+10"
            }
        },
        "target": {
            position: {
                of: "#map-canvas-container",
                my: "left top",
                at: "center+10 center+10"
            }
        },
        "wind": {
            position: {
                of: $("#wind-direction-slider").parent().parent(),
                my: "right center",
                at: "left center"
            }
        },
        "reachset": {
            position: {
                of: "#display-ui-element-buttons",
                my: "right center",
                at: "left center"
            }
        },
        "pattern": {
            position: {
                of: $("#opening-altitude-slider").parent().parent(),
                my: "right center",
                at: "left center"
            }
        },
        "restart": {
            position: {
                of: "#tutor-button",
                my: "right top",
                at: "left bottom"
            }
        },
        "rightclick": {
            modal: false,
            buttons: [],
            position: {
                of: "#map-canvas-container",
                my: "center bottom",
                at: "center bottom-10"
            }
        }
    };
    
    var allDialogs = $(id).children("div");

    allDialogs.each(function(){
        var specific = specificOptions[$(this).attr("id").replace("tutor-","")];
        $(this).dialog(commonOptions).dialog("option", specific);
    });

    nextDialogIndex = readSetting("tutor-finished", false) ? allDialogs.size() - 1 : 0;
    nextDialog();

    $("#tutor-button").click(function() {
        nextDialogIndex = 0;
        var visible = allDialogs.filter(":visible").dialog("close");
        if (visible.size() == 0) {
            nextDialog();
        }
    });
}