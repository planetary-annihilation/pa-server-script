var main = require('main');
var server = require('server');
var sim = require('sim');
var utils = require('utils');
var _ = require('thirdparty/lodash');

var client_state = {
    armies: []
};

var players = {};
var armies = [];

var cleanup = [];

function updateArmyState(transmit) {
    if (transmit) {
        server.broadcast({
            message_type: 'army_state',
            payload: client_state.armies
        });
    }
}

function updateBeacon() {
    server.beacon = undefined;
}

function defeatArmy(army) {
    army.sim.defeated = true;
    army.defeated = true;
}

function updateGameOverState() {
    var aliveCount = _.reduce(armies, function(sum, army) { return sum + (army.defeated ? 0 : 1); }, 0);
    if (aliveCount > 1)
        return;

    server.exit();
}

function tickDefeatState() {
    _.forEach(armies, function(army) {
        if (army.defeated)
            return;
        if (army.commander.dead)
            defeatArmy(army);
    });
    updateGameOverState();
}

function spawnUnit(army, spec, planet, position, orientation) {
    var creationCheck = sim.units.length;
    sim.units.push({
        army: army.sim,
        spec: spec,
        planet: planet,
        position: position,
        orientation: orientation
    });
    if (creationCheck !== sim.units.length) {
        return _.last(sim.units);
    }
    else
        console.error("Failed spawning unit", spec);
}

// Note: Must be called after the armies have been filled in
function createLandingZones(config) {
    var planet_zones = {};
    _.forEach(sim.planets, function (planet, index) {
        var planetConfig = config.system.planets[index];
        var planetRadius = planetConfig.generator.radius;

        var maxZonesPerArmy = Math.min(Math.ceil(planetRadius / 300), 4);

        var zoneRadius = planetRadius / 5;
        var bufferRadius = planetRadius * 0.2;

        if (!!planetConfig.starting_planet)
            planet_zones[index] = planet.genMetalAndLandingSpots(maxZonesPerArmy, zoneRadius, bufferRadius, sim.armies.length);
        else
            planet.genMetalSpots();

        if(!!planet_zones[index])
            planet_zones[index].planet_index = index;
    });
    sim.navDebugEnabled = true;
    sim.initDropletTest(planet_zones[0].positions[0]);
    return planet_zones;
}

function assignZones(zones) {
    if (!armies.length)
        return;
    _.forEach(armies, function (army) {
        army.zones = [];
    });

    _.forEach(zones, function (zone) { 
        zone.positions = _.shuffle(zone.positions);
        while (zone.positions.length >= armies.length) {
            _.forEach(armies, function (army) {
                army.zones.push({
                    position: _.last(zone.positions),
                    planet_index: zone.planet_index,
                    radius: zone.radius
                });
                zone.positions.pop();
            });
        }
    });
}

exports.url = 'coui://ui/main/game/live_game/live_game.html';
exports.enter = function(config) {
    _.forEach(config.armies, function(army) {
        army = _.clone(army);
        army.ai = true;
        var armyCreateCheck = sim.armies.length;
        sim.armies.push(army);
        if (armyCreateCheck === sim.armies.length) {
            console.error("Failed creating army", JSON.stringify(army));
            return;
        }
        var simArmy = _.last(sim.armies);
        army.id = simArmy.id;
        client_state.armies.push(army);
        
        armies.push({
            id: simArmy.id,
            sim: simArmy,
            desc: army,
            zones: [],
            commander: army.commander
        });

        if (army.hasOwnProperty('econ_rate'))
            simArmy.econ_rate = army.econ_rate;
    });

    var landingZones = createLandingZones(config);
    assignZones(landingZones);
    
    _.forEach(armies, function(army) {
        var spawn = army.sim.aiSpawnLocation(army.zones);
        army.commander = spawnUnit(army, army.commander, sim.planets[spawn.planet_index], spawn.location);
        army.sim.finalizeEconomy();
    });
    
    sim.paused = !!config.paused;
    
    var defeatTimer = setInterval(tickDefeatState, 1000);
    cleanup.push(function() { clearInterval(defeatTimer); });
    
    if (main.time_limit)
        setTimeout(function() { server.exit(); }, main.time_limit * 1000);
    
    function handleNewConnection(client) {
        sim.armies.setVisionBits(client, true);
        sim.armies.setControlBits(client, false);
    }
    
    utils.pushCallback(server, 'onConnect', function(onConnect, client, reconnect) {
        updateBeacon();
        
        if (!reconnect)
            handleNewConnection(client);
        return onConnect;
    });
    cleanup.push(function() { server.onConnect.pop(); });
    
    _.forEach(server.clients, handleNewConnection);
    
    server.maxClients = config.hasOwnProperty('maxClients') ? config.maxClients : 16;
    updateBeacon();
    
    return client_state;
};

exports.exit = function(newState) {
    _.forEachRight(cleanup, function(c) { c(); });
    cleanup = [];
    return true;
};

