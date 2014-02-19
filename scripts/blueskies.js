////// Parameters

// Canopy modes
var horizontalSpeeds = [0, 2.5, 5, 7.5, 10],
    verticalSpeeds = [10, 7, 5, 3, 5],
    reachSetSteps = (horizontalSpeeds.length - 1) * 2 + 1, // we need this kind of step to make sure that during interpolations into the above arrays we get the exact hits
    lastReachSetSteps = 3; // Experiments show that only the faster modes are efficient enough to be on the edge of reachability sets, so we only compute and draw those

// Dropzones
var dropzones = {
        "dz-uk-sibson" : new google.maps.LatLng(52.560706, -0.395692),
        "dz-uk-chatteris" :  new google.maps.LatLng(52.48866, 0.086044),
        "dz-ru-puschino" : new google.maps.LatLng(54.790046, 37.642547),
        "dz-ru-kolomna" : new google.maps.LatLng(55.091914, 38.917231),
        "dz-ru-vatulino" : new google.maps.LatLng(55.663505, 36.142181),
        "dz-other-dubai" : new google.maps.LatLng(25.090282, 55.135681),
        "dz-other-red-square": new google.maps.LatLng(55.754216, 37.620083),
        "dz-other-statue-of-liberty": new google.maps.LatLng(40.690531, -74.04575),
        "dz-custom" : readSetting("custom-dz-location", null, unpackLatLng)
    },
    lastCustomDzName = readSetting("custom-dz-name", ""),
    dzMarker;

// Time
var updateFrequency = 20.0,
    simulationSpeed = 1.0,
    oldSimulationSpeed = 1.0, // for instant pausing on "p" support
    headingUpdateSpeed = Math.PI / 4, // Radians __per second__
    canopyModeUpdateSpeed = 0.05, // Mode units __per keydown event__
    pressedKeys = {}; // Monitor which keys are pressed. To provide good control response.

////// Settings
var showSteadyPoint = readSetting("show-steady-point", true),
    useMetricSystem = readSetting("use-metric-system", true),
    showReachabilitySet = readSetting("show-reachability-set", false),
    showControllabilitySet = readSetting("show-controllability-set", false),
    showLandingPattern = readSetting("show-landing-pattern", false),
    lhsLandingPattern = readSetting("lhs-landing-pattern", false);
// We use the azimuth of the wind speed vector here, not the navigational wind direction (i.e. where wind is blowing, not where _from_)
var windDirection = Math.random() * Math.PI * 2,
    windSpeed = 5 + Math.random() * 2 - 1,
    intoTheWindLanding = true,
    landingDirection = 0,
    openingAltitude = readSetting("opening-altitude", 700),
    currentDropzoneId = readSetting("current-dropzone-id", "dz-uk-sibson"),
    defaultMapZoom = 15,
    minMapZoom = 12,
    maxMapZoom = 18;

////// State
var isSimulationRunning = false,
    canopyLocation,
    canopyAltitude,
    canopyHeading,
    canopyMode,
    steadyPointLocation,
    prevUpdateTime;

////// Constants
var eps = 1e-03, // Mostly used to compare altitude to zero
    altitudeSliderMax = 500,
    headingSliderOptions = { min: 0, max: Math.PI * 2, step: Math.PI / 180 * 5 };

////// UI objects
var map,
    canopyMarker,
    steadyPointMarker,
    landingPatternLine,

    reachabilitySetObjects = [],
    controllabilitySetObjects = [],

    dzFinderAutocomplete;

////// Persistence code
function readSetting(key, def, converter) {
    var converters = {
        'string': String,
        'number': Number,
        'boolean': parseBoolean
    };
    return defaultIfUndefined($.cookie(key, converter || converters[typeof def]), def);
}

function saveSetting(key, value) {
    var cookieOptions = {
        expires: 10
    };
    $.cookie(key, value, cookieOptions);
}

function wipeCookies() {
    var cookies = document.cookie.split(";");
    for (var i = 0; i < cookies.length; i++) {
        var equals = cookies[i].indexOf("="),
            name = equals > -1 ? cookies[i].substr(0, equals) : cookies[i];
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT";
    }
}

function packLatLng(latlng) {
    return JSON.stringify([latlng.lat(), latlng.lng()]);
}

function unpackLatLng(string) {
    var latlng = JSON.parse(string);
    return new google.maps.LatLng(latlng[0], latlng[1]);
}

////// Localization for javascript

var currentLanguage = "en",
    enResources = {
        "ms": "m/s",
        "paused": "(paused)"
    },
    ruResources = {
        "ms": "м/с",
        "mph": "миль/ч",
        "m": "м",
        "ft": "футов",
        "paused": "", // too long anyway :)
        "Choose another landing area": "Выберите другую площадку приземления",
        "Legend": "Легенда",
        "Got it!": "Дальше",
        "Skip tutor": "Пропустить введение",
        "Share a link": "Ссылка сюда"
    },
    langResources = {
        "en": enResources,
        "ru": ruResources
    };

function localize(id) {
    return defaultIfUndefined(langResources[currentLanguage][id], id);
}

function setLanguage(element, language) {
    if (!langResources[language]) {
        return;
    }

    saveSetting("language", language);
    currentLanguage = language;
    for (var lang in langResources) {
        $(element).find(":lang(" + lang + ")").toggle(lang == currentLanguage);
    }

//    updateSliderLabels();
//    updateLanguageRadio();

    $("#dz-finder").attr("placeholder", localize("Choose another landing area"));

    if (isDialogOpen("#legend-dialog")) {
        showLegendDialog("#legend-dialog");
    }

    var $rightclick = $("#tutor-rightclick");
    if (isDialogOpen("#tutor-rightclick")) {
        $rightclick.dialog("position", $rightclick.dialog("position"));
    }
}

function updateLanguageRadio() {
//    $("#select-lang-" + currentLanguage).prop('checked', true);
}

////// Helpers

// Get query string, from http://stackoverflow.com/a/979995/193903
function getQueryString() {
    var query_string = {},
        query = window.location.search.substring(1),
        vars = query.split("&");
    for (var i = 0; i < vars.length; i++) {
        var pair = vars[i].split("=");
        // If first entry with this name
        if (typeof query_string[pair[0]] === "undefined") {
            query_string[pair[0]] = pair[1];
        // If second entry with this name
        } else if (typeof query_string[pair[0]] === "string") {
            var arr = [ query_string[pair[0]], pair[1] ];
            query_string[pair[0]] = arr;
        // If third or later entry with this name
        } else {
            query_string[pair[0]].push(pair[1]);
        }
    }

    return query_string;
}

function degToRad(deg) {
    return deg * Math.PI / 180;
}

function radToDeg(rad) {
    return rad * 180 / Math.PI;
}

function normalizeAngle(angle) {
    while (angle > 2 * Math.PI) {
        angle -= 2 * Math.PI;
    }
    while (angle < 0) {
        angle += 2 * Math.PI;
    }
    return angle;
}

function reportedWindDirection(direction) {
    return normalizeAngle(direction + Math.PI);
}

function moveCoords(coords, dx, dy) {
    var earthRadius = 6378137,
        newLat = coords.lat() + radToDeg(dy / earthRadius),
        newLng = coords.lng() + radToDeg((dx / earthRadius) / Math.cos(degToRad(coords.lat())));
    return new google.maps.LatLng(newLat, newLng);
}

function moveInWind(coords, windSpeed, windDirection, speed, direction, time) {
    var dx = speed * Math.sin(direction) + windSpeed * Math.sin(windDirection),
        dy = speed * Math.cos(direction) + windSpeed * Math.cos(windDirection);
    return moveCoords(coords, dx * time, dy * time);
}

function rotateDiv(div, angle) {
    var style = "rotate(" + angle + "deg)";

    div.style.webkitTransform = style;
    div.style.mozTransform = style;
    div.style.msTransform = style;
    div.style.oTransform = style;
    div.style.transform = style;
}

function interpolate(arr, coeff) {
    if (coeff <= 0) {
        return arr[0];
    }

    if (coeff >= 1) {
        return arr[arr.length - 1];
    }

    scaledCoeff = coeff * (arr.length - 1);
    index1 = Math.floor(scaledCoeff);
    index2 = Math.ceil(scaledCoeff);
    mixCoeff = scaledCoeff - index1;
    return arr[index1] * (1 - mixCoeff) + arr[index2] * mixCoeff;
}

function getCanopyHorizontalSpeed(mode) {
    return interpolate(horizontalSpeeds, mode);
}

function getCanopyVerticalSpeed(mode) {
    return interpolate(verticalSpeeds, mode);
}

function getCurrentLandingPoint() {
    return dzMarker.getPosition();
}

// returns: canopy heading necessary to maintain desiredTrack ground track in given winds (not always possible, of course)
// Simple vector addition: wind + canopySpeed = groundTrack
//
//                              .>desiredTrack
//                            .
//                          .*
//                    beta. /
//                      .  /
//                    .   /H      Sine theorem:
//                  .    /d
//                .     /e        windSpeed       speedH
//              .      /e         ---------  =  -----------
//            .       /p          sin beta       sin alpha
//          .        /s
//        .         /               gamma = alpha + beta -- gamma is the external angle.
//      . alpha    /gamma
// ----*----------*--------------------->windDirection
//     |windSpeed |
function createGroundTrack(windSpeed, windDirection, speedH, desiredTrack) {
    var alpha = windDirection - desiredTrack,
        beta = Math.asin(windSpeed * Math.sin(alpha) / speedH),
        gamma = alpha + beta;
    return windDirection - gamma; // == desiredTrack + beta, but the code appears more straightforward that way.
}

function reachSet(windSpeed, windDirection, altitude, u) {
    var speedH = getCanopyHorizontalSpeed(u),
        speedV = getCanopyVerticalSpeed(u),
        time = altitude / speedV;
    return {
        c: [time * windSpeed * Math.sin(windDirection), time * windSpeed * Math.cos(windDirection)],
        radius: time * speedH
    };
}

function computeReachSet(objects, sourceLocation, altitude, reachability) {
    // Note that in the interface we forbid the stall mode. But still, in most cases it doesn't lead to the edge of the reach set
    for (var i = reachSetSteps - lastReachSetSteps; i < reachSetSteps; i++) {
        var u = 1 / (reachSetSteps - 1) * i,
            set = reachSet(windSpeed, windDirection, altitude, u),
            shiftFactor = reachability ? 1 : -1; // for reachability we shift downwind, for controllability -- upwind

        objects[i].setCenter(moveCoords(sourceLocation, shiftFactor * set.c[0], shiftFactor * set.c[1]));
        objects[i].setRadius(set.radius);
    }
}

function updateReachSetVisibility(objects, visible) {
    for (var i = 0; i < objects.length; i++) {
        objects[i].setVisible(visible);
    }
}

function updateReachabilitySet() {
    updateReachSetVisibility(reachabilitySetObjects, showReachabilitySet);

    if (showReachabilitySet && isSimulationRunning) {
        computeReachSet(reachabilitySetObjects, canopyLocation, canopyAltitude, true);
    }
}

function updateControllabilitySet() {
    updateReachSetVisibility(controllabilitySetObjects, showControllabilitySet);

    if (showControllabilitySet) {
        var altitude = canopyAltitude > eps ? canopyAltitude : openingAltitude;
        computeReachSet(controllabilitySetObjects, getCurrentLandingPoint(), altitude, false);
    }
}

function computeLandingPattern(location, wind, pattern) {
    var controlPointAltitudes = [100, 200, 300],
        patternMode = 0.85,
        speedH = getCanopyHorizontalSpeed(patternMode),
        speedV = getCanopyVerticalSpeed(patternMode),
        rotationFactor = pattern.lhs() ? 1 : -1,

        timeToPoint1 = controlPointAltitudes[0] / speedV,
        timeToPoint2 = (controlPointAltitudes[1] - controlPointAltitudes[0]) / speedV,
        timeToPoint3 = (controlPointAltitudes[2] - controlPointAltitudes[1]) / speedV,

        heading,

        windSpeed = wind.speed(),
        windDirection = wind.direction(),
        landingDirection = pattern.landingDirection();

    // For now, strong winds imply into-the wind landing no matter what landing direction is given. This needs further thought.
    heading = windSpeed() < speedH ?
        createGroundTrack(windSpeed, windDirection, speedH, landingDirection):
        Math.PI + windDirection; // Into the wind

    var point1 = moveInWind(location, windSpeed, windDirection, speedH, heading, -timeToPoint1); // Note that we specify the wind speed and canopy heading as though we're flying the pattern. But we give negative time, so we get the point where we need to start to arrive where we need.

    heading = windSpeed < speedH ?
        createGroundTrack(windSpeed, windDirection, speedH, landingDirection + rotationFactor * Math.PI / 2): // In ordinary winds we hold perpendicular ground track
        Math.PI + windDirection + rotationFactor * Math.PI / 8; // in strong winds we move backwards with some arbitrary low angle to the wind

    var point2 = moveInWind(point1, windSpeed, windDirection, speedH, heading, -timeToPoint2);

    heading = windSpeed < speedH ?
        createGroundTrack(windSpeed, windDirection, speedH, landingDirection + Math.PI):
        Math.PI + windDirection; // Into the wind
    var point3 = moveInWind(point2, windSpeed, windDirection, speedH, heading, -timeToPoint3);

    return [point3, point2, point1, location];
}

function createCanopyMarkerIcon(canopyHeading) {
    return {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 5,
        fillColor: '#FF0000',
        fillOpacity: 1,
        strokeWeight: 2,
        rotation: radToDeg(canopyHeading) - defaultIfUndefined(map.getHeading(), 0)
    };
}

function metersToFeet(meters) {
    return meters * 3.2808399;
}

function metersPerSecToMilesPerHour(metersPerSec) {
    return metersPerSec * 2.23693629;
}

function getLandingDirection() {
    return viewModel.pattern.landingDirection();
}

function formatSpeed(metersPerSec, significantDigits) {
    significantDigits = significantDigits || 0;
    return useMetricSystem
        ? $.number(metersPerSec, significantDigits) + " " + localize("ms")
        : $.number(metersPerSecToMilesPerHour(metersPerSec), significantDigits) + " " + localize("mph");
}

function formatAltitude(meters, significantDigits) {
    significantDigits = significantDigits || 0;
    return useMetricSystem
        ? $.number(meters, significantDigits) + " " + localize("m")
        : $.number(metersToFeet(meters), significantDigits) + " " + localize("ft");
}

function formatHeading(angle, significantDigits) {
    significantDigits = significantDigits || 0;
    return $.number(radToDeg(angle), significantDigits) + "&deg;";
}

function formatSimulationSpeed(speed, significantDigits) {
    significantDigits = significantDigits || 1;
    return $.number(speed, significantDigits) + "x" + (speed == 0 ? " " + localize("paused") : "");
}

function setPatternType(type) {
    switch (type) {
        case "pattern-hide":
            showLandingPattern = false;
            break;

        case "pattern-rhs":
            showLandingPattern = true;
            lhsLandingPattern = false;
            break;

        case "pattern-lhs":
            showLandingPattern = true;
            lhsLandingPattern = true;
            break;
    }
    saveSetting("show-landing-pattern", showLandingPattern);
    saveSetting("lhs-landing-pattern", lhsLandingPattern);
    updateLandingPattern();
    landingPatternLine.setVisible(showLandingPattern);
}

function setDz(dz) {
    if (!dropzones[dz]) {
        return;
    }

    $("#dz-finder").val(dz == "dz-custom" ? lastCustomDzName : "");

    currentDropzoneId = dz;
    $('#selected-dz').html($('#' + currentDropzoneId + "> a").html());
    saveSetting("current-dropzone-id", currentDropzoneId);
    map.setCenter(dropzones[currentDropzoneId]);
    map.setZoom(defaultMapZoom);
    dzMarker.setPosition(dropzones[currentDropzoneId]);
    updateLandingPattern();
}

function setCustomDz(name, latlng) {
    dropzones["dz-custom"] = latlng;
    lastCustomDzName = name;
    setDz("dz-custom");

    saveSetting("custom-dz-name", lastCustomDzName);
    saveSetting("custom-dz-location", packLatLng(latlng));

    $("#dz-custom").show();
}

function defaultIfUndefined(x, def) {
    return (typeof x === 'undefined') ? def : x;
}

function parseBoolean(str) {
    return str == "true";
}

function isDialogOpen(id) {
    var $id = $(id);
    return $id.data("ui-dialog") && $id.dialog("isOpen");
}

function getFullPath(location) {
    return location.protocol + '//' + location.host + location.pathname;
}

function generateGETForLocation() {
    var result = "?";
    if (currentDropzoneId != "dz-custom") {
        result += "dz=" + currentDropzoneId.replace("dz-","");
    } else {
        var latlng = dropzones["dz-custom"];
        result += "lat=" + latlng.lat() + "&lng=" + latlng.lng();
    }

    return result;
}

////// UI update logic

function updateCanopyControls() {
    canopyMarker.setPosition(canopyLocation);
    canopyMarker.setIcon(createCanopyMarkerIcon(canopyHeading));
    steadyPointMarker.setPosition(steadyPointLocation);

    updateReachabilitySet();
    updateControllabilitySet();
}

function updateCanopyStatus() {
    $("#altitude-value").html(formatAltitude(canopyAltitude, 0));
    $("#horizontal-speed-value").html(formatSpeed(getCanopyHorizontalSpeed(canopyMode), 1));
    $("#vertical-speed-value").html(formatSpeed(getCanopyVerticalSpeed(canopyMode), 1));
    $("#canopy-heading-value").html(formatHeading(canopyHeading, 0));

    $("#mode-progressbar").progressbar("option", "value", canopyMode);
    $("#altitude-progressbar").progressbar("option", "value", canopyAltitude);
}

function updateLandingPattern() {
//    landingPatternLine.setPath(computeLandingPattern(getCurrentLandingPoint(), getLandingDirection()));

    updateControllabilitySet();
}

////// Event handlers

function onKeyDown(e) {
    if (37 <= e.which && e.which <= 40) {
        e.preventDefault(); // Disable page scrolling with arrows
        pressedKeys[e.which] = true;
    }

    if (isSimulationRunning && canopyAltitude > eps) {
        if (e.which == $.ui.keyCode.UP) {
            canopyMode += canopyModeUpdateSpeed;
        }
        else if (e.which == $.ui.keyCode.DOWN) {
            canopyMode -= canopyModeUpdateSpeed;
        }
    }

    // Clip canopy mode
    var minMode = 0.1; // We don't allow flying in the stall
    if (canopyMode < minMode) {
        canopyMode = minMode;
    } else if (canopyMode > 1) {
        canopyMode = 1;
    }
}

function onKeyUp(e) {
    if (37 <= e.which && e.which <= 40) {
        e.preventDefault(); // Disable page scrolling with arrows
        pressedKeys[e.which] = false;
    }

    if (String.fromCharCode(e.which) == "P") {
        viewModel.simulation.togglePause();
    }
}

function onShareLinkClick() {
    var shareDialogOptions = {
        title: localize("Share a link"),
        autoOpen: true,
        resizable: true,
        draggable: true,
        minHeight: 0,
        modal: true,
        width: "auto",
        show: "fade",
        hide: "fade",
        position: {
            of: "#dz-finder",
            my: "center top",
            at: "center bottom+10"
        },
        buttons: {
            "Ok": function() { $(this).dialog("close") }
        }
    };
    $("#share-dialog")
        .dialog(shareDialogOptions)
        .children("input")
            .val(getFullPath(window.location) + generateGETForLocation())
            .focus()
            .get(0)
                .select();
}

function onMapRightClick(event) {
    canopyLocation = event.latLng;
    canopyAltitude = openingAltitude;
    canopyHeading = windDirection + Math.PI; // Into the wind
    canopyMode = 0.6;
    prevUpdateTime = new Date().getTime();

    $("#mode-progressbar").progressbar({value: canopyMode, max: 1});
    $("#altitude-progressbar").progressbar({value: canopyAltitude, max: Math.max(openingAltitude, altitudeSliderMax)});
    $("#tutor-rightclick").dialog("close");

    if (!isSimulationRunning) {
        initializeCanopyImage();
        $("#status").show();
        isSimulationRunning = true;
    }
    tuneRuler("#altitude-progressbar", "#altitude-ruler");
}

function onLandingSpotPositionChanged() {
    if (currentDropzoneId == "dz-custom") {
        dropzones["dz-custom"] = getCurrentLandingPoint();
        saveSetting("custom-dz-location", packLatLng(dropzones["dz-custom"]));
    }

    updateLandingPattern();
}

function onTimeTick() {
    if (isSimulationRunning && canopyAltitude > eps) {
        var currentUpdateTime = new Date().getTime(),
            dt = (currentUpdateTime - prevUpdateTime) / 1000.0;
        prevUpdateTime = currentUpdateTime;

        if (pressedKeys[37]) { // left arrow
            canopyHeading -= headingUpdateSpeed * dt;
        }
        else if (pressedKeys[39]) { // right arrow
            canopyHeading += headingUpdateSpeed * dt;
        }

        // Normalize canopy heading
        canopyHeading = normalizeAngle(canopyHeading);

        var speedH = getCanopyHorizontalSpeed(canopyMode),
            speedV = getCanopyVerticalSpeed(canopyMode);

        dt *= simulationSpeed; // Only do it here because we don't want the responsiveness to be affected by the simulationSpeed, only the descent. Or do we?
        dt = Math.min(dt, canopyAltitude / speedV); // We don't want to go below ground

        canopyLocation = moveInWind(canopyLocation, windSpeed, windDirection, speedH, canopyHeading, dt);
        canopyAltitude -= dt * speedV;

        if (canopyAltitude < eps) {
            var distance = google.maps.geometry.spherical.computeDistanceBetween(canopyLocation, getCurrentLandingPoint());
            ga('send', 'event', 'simulation', 'finished');
            ga('send', 'event', 'simulation', 'finished', 'distance', Math.floor(distance));
            ga('send', 'event', 'simulation', 'finished', 'angle-into-wind', Math.floor(radToDeg(normalizeAngle(Math.abs(canopyHeading - normalizeAngle(windDirection - Math.PI))))));
        }

        if (showSteadyPoint) {
            var timeToLanding = canopyAltitude / speedV;
            steadyPointLocation = moveInWind(canopyLocation, windSpeed, windDirection, speedH, canopyHeading, timeToLanding);
        }

        updateCanopyControls();
        updateCanopyStatus();
    }
}

function onWindDirectionSliderValueChange(event, ui) {
    windDirection = degToRad(ui.value);
    updateLandingDirectionValue();

    updateLandingPattern();
}

function onWindSpeedSliderValueChange(event, ui) {
    windSpeed = ui.value;

    updateLandingPattern();
}

function onOpeningAltitudeSliderValueChange(event, ui) {
    openingAltitude = ui.value;
    $("#opening-altitude-value").html(formatAltitude(openingAltitude));
    saveSetting("opening-altitude", openingAltitude);

    updateLandingPattern();
}

function onSelectSystem() {
    useMetricSystem = $(this).attr('id') == "select-metric";
    saveSetting("use-metric-system", useMetricSystem);

    updateSliderLabels();
    updateCanopyStatus();
}

function onDzMenuItemSelected(event, ui) {
    ga('send', 'event', 'dz', 'selected', ui.item.attr('id'));
    setDz(ui.item.attr('id'));
}

function onShowSteadyPointCheckboxToggle() {
    showSteadyPoint = !showSteadyPoint;
    saveSetting("show-steady-point", showSteadyPoint);

    steadyPointMarker.setVisible(showSteadyPoint);
}

function onShowControllabilitySetCheckboxToggle() {
    showControllabilitySet = !showControllabilitySet;

    saveSetting("show-controllability-set", showControllabilitySet);

    updateControllabilitySet();
}

function onShowReachabilitySetCheckboxToggle() {
    showReachabilitySet = !showReachabilitySet;
    saveSetting("show-reachability-set", showReachabilitySet);

    updateReachabilitySet();
}

function onPatternSelect() {
    setPatternType($(this).attr('id'));
}

function onFindNewDz() {
    var place = dzFinderAutocomplete.getPlace();
    if (!place.geometry) {
        ga('send', 'event', 'dz', 'autocomplete', 'failed');
        return;
    }

    ga('send', 'event', 'dz', 'autocomplete', 'success');
    setCustomDz($("#dz-finder").val(), place.geometry.location);
}

////// Initialization

function parseParameters() {
    var queryString = getQueryString(),

        lang = defaultIfUndefined(queryString.lang, readSetting("language", "en")),
        dz = defaultIfUndefined(queryString.dz, currentDropzoneId.replace("dz-", "")),
        lat = queryString.lat,
        lng = queryString.lng;

    if (lang) {
//        setLanguage(lang);
    }

    if (dz) {
        setDz("dz-" + dz);
    }

    if (lat && lng) {
        var latlng = new google.maps.LatLng(lat, lng);
        setCustomDz("", latlng);
    }
}

function initializeCanopyImage() {
    var canopyMarkerOptions = {
        map: map,
        icon: createCanopyMarkerIcon(canopyHeading),
        zIndex: 4
    };
    canopyMarker = new google.maps.Marker(canopyMarkerOptions);
}

function initializeReachSet(objects, color) {
    for (var i = 0; i < reachSetSteps; i++) {
        var circleOptions = {
            strokeColor: color,
            strokeOpacity: 0.0,
            fillColor: color,
            fillOpacity: 0.15,
            map: map,
            zIndex: 0
        };
        var circle = new google.maps.Circle(circleOptions)
        objects.push(circle);
        google.maps.event.addListener(circle, "rightclick", onMapRightClick);
    }
}

function tuneRuler(id, ruler) {
    var $id = $(id),
        width = $id.width(),
        max = $id.progressbar("option", "max"),
        prevOffset = 0;
    $(ruler).children("li").each(function() {
        var $this = $(this),
            value = Number($this.text()),
            offset = value * width / max;
        $this.css("padding-left", offset - prevOffset);
        prevOffset = offset;
    });
}

function showLegendDialog(id) {
    var options = {
        title: localize("Legend"),
        autoOpen: true,
        resizable: true,
        draggable: true,
        minHeight: 0,
        modal: false,
        width: "35em",
        show: "fade",
        hide: "fade",
        position: {
            of: "#map-canvas-container",
            my: "left bottom",
            at: "left+50 bottom-50"
        }
    };
    $(id).dialog(options);
}

function showAboutDialog(id) {
    var $id = $(id);
    if ($id.children().size() == 0) {
        $('<iframe>', {src: "about.html"}).appendTo($id);
    }
    var options = {
        title: localize("About"), // Only localized on startup, oops. The same happens to tutor anyway.
        resizable: true,
        draggable: true,
        modal: false,
        width: "50%",
        height: $(window).height() * 0.7,
        show: "fade",
        hide: "fade",
        position: {
            of: "#map-canvas-container"
        }
    };
    $id.dialog(options);
}

function initializeAnalyticsEvents() {
    $(".legend-button").click(function() {
        ga('send', 'event', 'button', 'click', 'legend');
    });

    google.maps.event.addListener(map, "rightclick", function() {
        ga('send', 'event', 'simulation', 'started');
        ga('send', 'event', 'simulation', 'started', 'altitude', openingAltitude);
    });

    $("input").change(function() {
        ga('send', 'event', 'button', 'click', $(this).attr("id"));
    });
}

function initialize() {
    var mapOptions = {
        zoom: defaultMapZoom,
        minZoom: minMapZoom,
        maxZoom: maxMapZoom,
        streetViewControl: false,
        center: dropzones[currentDropzoneId],
        keyboardShortcuts: false,
        mapTypeId: google.maps.MapTypeId.SATELLITE
    };
    map = new google.maps.Map($("#map-canvas").get(0), mapOptions);

    var $dzMenu = $("#dz-selection-menu"),
        firstLevelPosition = { my: "left top", at: "left bottom" };
    $dzMenu.menu({
            select: onDzMenuItemSelected,
            position: firstLevelPosition,
            blur: function() {
                $(this).menu("option", "position", firstLevelPosition);
            },
            focus: function(e, ui) {
                if (!ui.item.parent().is($dzMenu)) {
                    $(this).menu("option", "position", { my: "left top", at: "right top" });
                }
            }
        });
    var $shareButton = $("#share-location");
    $shareButton.button().click(onShareLinkClick);

    var dzFinder = $("#dz-finder").get(0);
    map.controls[google.maps.ControlPosition.TOP_CENTER].push($dzMenu.get(0));
    map.controls[google.maps.ControlPosition.TOP_CENTER].push(dzFinder);
    map.controls[google.maps.ControlPosition.TOP_CENTER].push($shareButton.get(0));
    map.controls[google.maps.ControlPosition.RIGHT_TOP].push($("#wind-arrow").get(0));
    map.controls[google.maps.ControlPosition.RIGHT_TOP].push($("#landing-direction-arrow").get(0));
    dzFinderAutocomplete = new google.maps.places.Autocomplete(dzFinder);
    google.maps.event.addListener(dzFinderAutocomplete, 'place_changed', onFindNewDz);

    landingPatternLine = new google.maps.Polyline({
        map: map,
        geodesic: false,
        strokeColor: '#00FFFF',
        strokeOpacity: 1.0,
        strokeWeight: 2,
        zIndex: 1,
        visible: showLandingPattern
    });

    var steadyPointMarkerOptions = {
        visible: showSteadyPoint,
        map: map,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: '#FF00FF',
            fillOpacity: 1,
            strokeWeight: 0
        },
        zIndex: 3
    };
    steadyPointMarker = new google.maps.Marker(steadyPointMarkerOptions);

    var markerOptions = {
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            strokeColor: 'yellow',
            scale: 8
        },
        position: dropzones[currentDropzoneId],
        draggable: true,
        map: map,
        zIndex: 2
    }

    dzMarker = new google.maps.Marker(markerOptions);
    google.maps.event.addListener(dzMarker, 'position_changed', onLandingSpotPositionChanged);

    // We initialize this early so UI events have something to update
    initializeReachSet(controllabilitySetObjects, '#0000FF');
    initializeReachSet(reachabilitySetObjects, '#FF0000');

    $("#mode-progressbar").progressbar();
    $("#altitude-progressbar").progressbar();

    $("#dz-custom").toggle(dropzones["dz-custom"] != null);

    var accordionOptions = { collapsible: true, heightStyle: "content" };
    $("#right-panel > div").accordion(accordionOptions);
    $("#status").hide();

    $(".legend-button").click(function() {
        showLegendDialog("#legend-dialog");
    });
    $(".about-button").click(function() {
        showAboutDialog("#about-dialog");
    });

    parseParameters();

    google.maps.event.addListener(map, "rightclick", onMapRightClick);
    $(document)
        .keydown(onKeyDown)
        .keyup(onKeyUp);
    window.setInterval(onTimeTick, updateFrequency);

    startTutor("#tutor-dialogs");

    initializeAnalyticsEvents();
}

google.maps.event.addDomListener(window, 'load', initialize);
