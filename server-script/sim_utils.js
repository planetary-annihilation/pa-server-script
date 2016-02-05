var Q = require('thirdparty/q');
var _ = require('thirdparty/lodash');

exports.MAX_PLANETS = 16;

function validatePlanet(planet)
{
    if (!planet.generator)
        return "No generator";

    //normalize generator values
    function normalizeNumber(val, min, max, dflt) {
        if (typeof val == 'number')
            return Math.min(Math.max(val, min), max);
        return dflt;
    }

    planet.generator.seed = normalizeNumber(planet.generator.seed, 0, Number.MAX_VALUE, 12345);
    planet.generator.heightRange = normalizeNumber(planet.generator.heightRange, 0, 100, 50);
    planet.generator.biomeScale = normalizeNumber(planet.generator.biomeScale, 0, 100, 50);
    planet.generator.waterHeight = normalizeNumber(planet.generator.waterHeight, 0, 100, 50);
    planet.generator.waterDepth = normalizeNumber(planet.generator.waterDepth, 0, 100, 0);
    planet.generator.temperature = normalizeNumber(planet.generator.temperature, 0, 100, 50);
    planet.generator.metalDensity = normalizeNumber(planet.generator.metalDensity, 0, 100, 50);
    planet.generator.metalClusters = normalizeNumber(planet.generator.metalClusters, 0, 100, 50);
    if (planet.generator.biome === "moon")
        planet.generator.waterHeight = -1;

    var d = Q.defer();

    file.load('/pa/terrain/' + planet.generator.biome + '.json', function(data) {
        var data = JSON.parse(data);
        if (typeof data.radius_range === "undefined")
            data.radius_range = [100, 1300]; // default value

        planet.generator.radius = normalizeNumber(planet.generator.radius, data.radius_range[0], data.radius_range[1],
                (data.radius_range[0] + data.radius_range[1]) / 2.0);

        d.resolve(true);
    });

    return d;
}

exports.validateSystemConfig = function(systemConfig) {
    var planets = systemConfig.planets;
    if (!planets || !planets.length)
        return "No planets.";

    if (planets.length > 16)
        return "Too many planets.  (Current limit = " + exports.MAX_PLANETS + ")";

    var hasStartingPlanet = false;
    for (var p = 0; p < planets.length; ++p)
    {
        if (planets[p].starting_planet)
        {
            hasStartingPlanet = true;
            break;
        }
    }
    if (!hasStartingPlanet)
        return "No starting planets.";

    var validationPromises = [];

    for (var p = 0; p < planets.length; ++p)
    {
        var retVal = validatePlanet(planets[p]);
        if (_.isString(retVal))
            return "Planet " + p + " invalid: " + retVal;
        else
            validationPromises.push(retVal);
    }

    return Q.all(validationPromises).then( function() {
        var starting_planets = 0;
        for (var p = 0; p < planets.length; ++p) {
            if (!!planets[p].starting_planet)
                starting_planets++;
        }

        if (starting_planets < 1)
            planets[0].starting_planet = true;

        systemConfig.planets = planets;
    });
};

exports.waitUntil = function(time) {
    var result = Q.defer();
    var maybeResolve = function() {
        var now = sim.time;
        if (now >= time)
            result.resolve();
        else
            setTimeout(maybeResolve, (time - now) * 1000);
    };
    maybeResolve();
    return result.promise;
};

exports.waitForSeconds = function(duration) {
    return exports.waitUntil(sim.time + duration);
};
